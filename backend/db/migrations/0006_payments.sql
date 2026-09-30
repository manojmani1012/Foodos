-- Payments, wallet, refunds and payouts. Covers the customer Payment screen
-- (UPI / Card / Foodos Wallet / Cash on Delivery) and the admin Payments & Settlements
-- tabs: Transactions, Settlements, Refunds.

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id),               -- null for wallet top-ups
  user_id uuid not null references users(id),
  provider text not null check (provider in ('razorpay', 'wallet', 'cod')),
  method text not null check (method in ('upi', 'card', 'wallet', 'cod', 'netbanking')),
  amount_paise integer not null check (amount_paise > 0),
  currency text not null default 'INR',
  status text not null default 'created' check (status in ('created', 'authorized', 'captured', 'failed', 'refunded')),
  provider_order_id text,
  provider_payment_id text unique,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_order_idx on payments (order_id);
create index payments_user_idx on payments (user_id, created_at desc);
create index payments_provider_order_idx on payments (provider_order_id);

create trigger payments_set_updated_at before update on payments
  for each row execute function set_updated_at();

-- Razorpay retries webhooks; the unique event id makes handling idempotent.
create table payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, event_id)
);

create table refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id),
  order_id uuid references orders(id),
  amount_paise integer not null check (amount_paise > 0),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'processed', 'failed')),
  provider_refund_id text unique,
  requested_by uuid references users(id),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index refunds_payment_idx on refunds (payment_id);

-- "Foodos Wallet: Available Balance ₹250".
create table wallets (
  user_id uuid primary key references users(id),
  balance_paise integer not null default 0 check (balance_paise >= 0),
  updated_at timestamptz not null default now()
);

create trigger wallets_set_updated_at before update on wallets
  for each row execute function set_updated_at();

-- Append-only ledger; wallets.balance_paise must always equal the sum of this ledger.
create table wallet_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references users(id),
  type text not null check (type in ('credit', 'debit')),
  reason text not null check (reason in ('topup', 'refund', 'order_payment', 'cashback', 'adjustment')),
  amount_paise integer not null check (amount_paise > 0),
  balance_after_paise integer not null check (balance_after_paise >= 0),
  order_id uuid references orders(id),
  created_at timestamptz not null default now()
);

create index wallet_transactions_user_idx on wallet_transactions (user_id, created_at desc);

-- Money owed to a restaurant or a delivery partner for a period ("Settlements" tab,
-- and the "Restaurant Payout" / "Delivery Partner Payout" rows in Transactions).
create table payouts (
  id uuid primary key default gen_random_uuid(),
  party_type text not null check (party_type in ('restaurant', 'delivery_partner')),
  restaurant_id uuid references restaurants(id),
  partner_id uuid references delivery_partners(user_id),
  period_start date not null,
  period_end date not null,
  gross_paise integer not null default 0,
  commission_paise integer not null default 0,
  adjustments_paise integer not null default 0,
  net_paise integer not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'paid', 'failed')),
  payout_reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  constraint payouts_party_matches_type check (
    (party_type = 'restaurant' and restaurant_id is not null and partner_id is null)
    or (party_type = 'delivery_partner' and partner_id is not null and restaurant_id is null)
  ),
  constraint payouts_period_valid check (period_end >= period_start)
);

create index payouts_restaurant_idx on payouts (restaurant_id, period_end desc) where restaurant_id is not null;
create index payouts_partner_idx on payouts (partner_id, period_end desc) where partner_id is not null;
create index payouts_status_idx on payouts (status);
