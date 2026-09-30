-- Delivery operations: one delivery per order, the request sent to partners, and the
-- numbers behind the partner Earnings screens.

create table deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id) on delete cascade,
  partner_id uuid references delivery_partners(user_id),   -- null while searching
  status text not null default 'searching' check (status in (
    'searching',
    'accepted',            -- "Order Accepted" -> Go to Restaurant
    'reached_restaurant',  -- "I've Reached Restaurant"
    'picked_up',           -- "Order Picked"
    'arrived',             -- "Arrived at Customer"
    'delivered',           -- "Order Delivered"
    'cancelled'
  )),
  pickup_distance_km numeric(6, 2),
  drop_distance_km numeric(6, 2),
  total_distance_km numeric(6, 2),
  base_earning_paise integer not null default 0 check (base_earning_paise >= 0),
  incentive_paise integer not null default 0 check (incentive_paise >= 0),
  tip_paise integer not null default 0 check (tip_paise >= 0),
  accepted_at timestamptz,
  reached_restaurant_at timestamptz,
  picked_up_at timestamptz,
  arrived_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Partner Earnings (daily / weekly / monthly) groups by partner and delivery date.
create index deliveries_partner_idx on deliveries (partner_id, delivered_at desc);
create index deliveries_open_idx on deliveries (status) where status not in ('delivered', 'cancelled');

create trigger deliveries_set_updated_at before update on deliveries
  for each row execute function set_updated_at();

-- "New Delivery Request" card with the 15 s countdown. A delivery may be offered to
-- several partners in turn; the first accept wins.
create table delivery_requests (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references deliveries(id) on delete cascade,
  partner_id uuid not null references delivery_partners(user_id),
  status text not null default 'sent' check (status in ('sent', 'accepted', 'rejected', 'expired')),
  expected_earning_paise integer not null check (expected_earning_paise >= 0),
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  unique (delivery_id, partner_id)
);

create index delivery_requests_partner_idx on delivery_requests (partner_id, status, expires_at);

-- Bonus actually paid out for an incentive rule on a given day.
create table incentive_awards (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references incentive_rules(id),
  partner_id uuid not null references delivery_partners(user_id),
  award_date date not null,
  amount_paise integer not null check (amount_paise > 0),
  created_at timestamptz not null default now(),
  unique (rule_id, partner_id, award_date)
);
