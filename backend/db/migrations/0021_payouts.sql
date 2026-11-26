-- Payouts, phase 1: automatic payout schedules, an earnings ledger, payment
-- settings the admin panel can change, restaurant bank details, commission
-- plans, the new rider pay formula and partial refunds.
--
-- The money itself is still sent by Foodos staff by hand and marked paid with
-- the bank reference. Phase 2 plugs Cashfree Payouts into the same rows.

-- --- Settings the admin panel edits ----------------------------------------

-- One JSON document per key. 'payments' holds the payment settings (absent
-- means the defaults in app/components/payouts/settings.py);
-- 'payouts_started_on' is the day automatic payouts began. Earnings from
-- before it were settled the old way (or not at all) and are never batched
-- unless an admin includes them.
create table platform_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

insert into platform_settings (key, value)
values ('payouts_started_on', to_jsonb(((now() at time zone 'Asia/Kolkata')::date)::text));

-- A payout due on one of these days (or a Sunday) moves to the next working day.
create table payout_holidays (
  day date primary key,
  name text not null
);

-- The business day an earning belongs to. With a 04:00 cutoff, a delivery at
-- 2 am on Tuesday still counts for Monday, as the kitchen's night runs on.
-- India time, whatever the session's clock says.
create function business_date(moment timestamptz, cutoff interval) returns date
language sql immutable as $$
  select ((moment at time zone 'Asia/Kolkata') - cutoff)::date
$$;

-- --- Restaurant commission plans --------------------------------------------

-- standard (22%) and subscription (10%) follow the payment settings; custom
-- keeps whatever an admin set. Restaurants still on the old default of 20%
-- move to the standard plan; any other rate was a deal, so it stays custom.
alter table restaurants
  add column commission_plan text not null default 'standard'
    check (commission_plan in ('standard', 'subscription', 'custom'));

update restaurants set commission_plan = 'custom' where commission_pct <> 20;
update restaurants set commission_pct = 22 where commission_plan = 'standard';

alter table restaurants alter column commission_pct set default 22;

-- --- Restaurant bank details -------------------------------------------------

create table restaurant_payout_accounts (
  restaurant_id uuid primary key references restaurants(id) on delete cascade,
  account_holder_name text,
  account_number text,
  ifsc text,
  bank_name text,
  upi_id text,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  reject_reason text,
  verified_by uuid references users(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payout_account_has_destination check (
    (account_holder_name is not null and account_number is not null and ifsc is not null)
    or upi_id is not null
  )
);

-- --- Rider pay ---------------------------------------------------------------

-- The parts of base_earning_paise (null on trips from before the split), and
-- the per-order incentive, which is also counted in incentive_paise so every
-- existing sum stays right.
alter table deliveries
  add column base_pay_paise integer check (base_pay_paise >= 0),
  add column distance_pay_paise integer check (distance_pay_paise >= 0),
  add column order_incentive_paise integer not null default 0 check (order_incentive_paise >= 0);

-- --- Payout batches and payouts ----------------------------------------------

-- One batch per schedule period (Mon-Tue, Wed-Thu, Fri-Sun by default).
create table payout_batches (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  pay_date date not null,
  created_at timestamptz not null default now(),
  unique (period_start, period_end),
  check (period_end >= period_start)
);

alter table payouts drop constraint payouts_status_check;
alter table payouts add constraint payouts_status_check check (
  status in ('pending', 'scheduled', 'on_hold', 'processing', 'paid', 'failed', 'cancelled')
);
alter table payouts alter column status set default 'scheduled';

alter table payouts
  add column batch_id uuid references payout_batches(id),
  add column scheduled_for date,
  add column hold_reason text,
  add column failure_reason text,
  add column method text not null default 'manual' check (method in ('manual', 'cashfree')),
  add column notified_scheduled_at timestamptz,
  add column reminded_at timestamptz,
  add column updated_at timestamptz not null default now(),
  add column paid_by uuid references users(id),
  add constraint payouts_batch_restaurant_once unique (batch_id, restaurant_id),
  add constraint payouts_batch_partner_once unique (batch_id, partner_id);

create index payouts_scheduled_idx on payouts (status, scheduled_for);

-- --- The earnings ledger -----------------------------------------------------

-- One row per thing that changes what Foodos owes a restaurant or a rider: an
-- order earned, cash collected or handed over, a refund charged to them, an
-- admin adjustment. Separate from customer payments. `source` names what the
-- row came from, so writing it twice (the delivered step and the sweeper) is
-- harmless.
create table earnings_entries (
  id bigint generated always as identity primary key,
  party_type text not null check (party_type in ('restaurant', 'delivery_partner')),
  restaurant_id uuid references restaurants(id) on delete cascade,
  partner_id uuid references delivery_partners(user_id) on delete cascade,
  order_id uuid references orders(id) on delete cascade,
  kind text not null check (kind in ('order', 'delivery', 'cash_collected', 'cash_deposit', 'refund', 'adjustment')),
  amount_paise integer not null,
  breakdown jsonb not null default '{}',
  business_date date not null,
  payout_id uuid references payouts(id) on delete set null,
  excluded_reason text,
  source text not null unique,
  note text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  constraint earnings_entry_party check (
    (party_type = 'restaurant' and restaurant_id is not null and partner_id is null)
    or (party_type = 'delivery_partner' and partner_id is not null and restaurant_id is null)
  )
);

create index earnings_entries_restaurant_idx on earnings_entries (restaurant_id, business_date) where restaurant_id is not null;
create index earnings_entries_partner_idx on earnings_entries (partner_id, business_date) where partner_id is not null;
create index earnings_entries_payout_idx on earnings_entries (payout_id);
create index earnings_entries_unpaid_idx on earnings_entries (party_type, business_date)
  where payout_id is null and excluded_reason is null;

-- --- Partial refunds ---------------------------------------------------------

-- Who bears a partial refund, and where the money went: back to the card or
-- UPI account it came from, or into the customer's Foodos wallet (wallet and
-- cash orders). A cash order has no payment row, so payment_id may be empty.
alter table refunds
  add column charged_to text check (charged_to in ('restaurant', 'rider', 'foodos')),
  add column destination text not null default 'original' check (destination in ('original', 'wallet'));

alter table refunds alter column payment_id drop not null;

update refunds f set destination = 'wallet'
from payments p
where p.id = f.payment_id and p.provider = 'wallet';

-- A cancellation is still refunded at most once per payment. Partial refunds
-- (which always say who bears them) can be several, up to the order total.
drop index refunds_one_live_per_payment;

create unique index refunds_one_live_per_payment
  on refunds (payment_id)
  where status <> 'failed' and charged_to is null;

-- A wallet refund is tied to its refund row instead of to the order, so an
-- order can have a cancellation refund or several partial ones.
drop index wallet_transactions_order_refund_once;

alter table wallet_transactions add column refund_id uuid unique references refunds(id);

update wallet_transactions w set refund_id = f.id
from refunds f
join payments p on p.id = f.payment_id and p.provider = 'wallet'
where w.reason = 'refund' and w.order_id = f.order_id and f.status <> 'failed';
