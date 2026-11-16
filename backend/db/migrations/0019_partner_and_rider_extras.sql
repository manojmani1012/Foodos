-- Partner and Delivery app extras, Swiggy/Zomato style.

-- The kitchen says how long this order will take when it accepts it, and can
-- ask for more time while cooking. Null on older orders: the restaurant's
-- usual prep time applies.
alter table orders add column accepted_at timestamptz;
alter table orders add column prep_minutes integer check (prep_minutes between 5 and 120);
alter table orders add column prep_extensions smallint not null default 0;

-- Fake GPS seen on a rider's phone: how many times (one per ten minutes of
-- use, not one per location update) and when last.
alter table delivery_partners add column mock_location_count integer not null default 0;
alter table delivery_partners add column mock_location_at timestamptz;

-- Cash a rider has handed over to Foodos. Cash still in their pocket counts
-- towards the cash-in-hand limit; a deposit brings it down, and the rider's
-- payout for that day adds it back so it is not taken off twice.
create table rider_cash_deposits (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references delivery_partners(user_id),
  amount_paise integer not null check (amount_paise > 0),
  reference text,
  recorded_by uuid references users(id),
  created_at timestamptz not null default now()
);

create index rider_cash_deposits_partner_idx on rider_cash_deposits (partner_id, created_at desc);

-- Daily targets ("Complete 15 trips, earn ₹250 extra") are read every time a
-- rider opens the app.
create index incentive_rules_active_idx on incentive_rules (is_active, starts_at);
