-- Payout fixes from the client's answers: commission on food + packaging plus a
-- payment-gateway fee, who pays for a coupon, bank-only restaurant accounts,
-- rider bank accounts that staff verify, and whole-batch holds.

-- --- Who pays for a discount --------------------------------------------------

-- A coupon comes off the restaurant's payout; a bank or card offer is paid by
-- the bank and is only recorded. The order keeps its own copy, so editing the
-- offer later never changes what an old order paid.
alter table offers
  add column funded_by text not null default 'restaurant' check (funded_by in ('restaurant', 'bank'));

alter table orders
  add column discount_funded_by text not null default 'restaurant' check (discount_funded_by in ('restaurant', 'bank'));

-- --- Commission: standard is now 20% (the 2% gateway fee is separate) --------

alter table restaurants alter column commission_pct set default 20;

update restaurants set commission_pct = 20 where commission_plan = 'standard';

-- --- Restaurants are paid to a bank account only -----------------------------

-- A UPI-only account has nothing to pay to any more: the owner must add bank
-- details. The column stays (always null for restaurants).
delete from restaurant_payout_accounts
where not (account_holder_name is not null and account_number is not null and ifsc is not null);

alter table restaurant_payout_accounts drop constraint payout_account_has_destination;
update restaurant_payout_accounts set upi_id = null;
alter table restaurant_payout_accounts add constraint payout_account_has_bank check (
  account_holder_name is not null and account_number is not null and ifsc is not null
);

-- --- Rider bank accounts -----------------------------------------------------

-- Bank account or UPI, verified by staff like a restaurant's. Replaces the
-- unchecked delivery_partners.payout_upi_id for payouts.
create table rider_payout_accounts (
  partner_id uuid primary key references delivery_partners(user_id) on delete cascade,
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
  constraint rider_payout_account_has_destination check (
    (account_holder_name is not null and account_number is not null and ifsc is not null)
    or upi_id is not null
  )
);

insert into rider_payout_accounts (partner_id, upi_id)
select user_id, payout_upi_id from delivery_partners where payout_upi_id is not null and btrim(payout_upi_id) <> '';

-- --- Whole-batch holds -------------------------------------------------------

alter table payout_batches add column hold_reason text;
