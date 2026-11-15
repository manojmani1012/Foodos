-- Fixes from the first round of user testing (UAT, October 2026).

-- The bill rounds to whole rupees, so every app shows the same amount and the
-- rider never has to collect 50 paise. The difference is kept as its own line
-- (at most 50 paise either way), so the total still adds up from its parts.
alter table orders
  add column round_off_paise integer not null default 0 check (round_off_paise between -50 and 50);

alter table orders drop constraint orders_total_matches_parts;

alter table orders add constraint orders_total_matches_parts check (
  total_paise = subtotal_paise + delivery_fee_paise + packaging_fee_paise + tax_paise + tip_paise
                - discount_paise + round_off_paise
);

-- How far a restaurant delivers. Null means the platform default.
alter table restaurants
  add column delivery_radius_km numeric(4, 1) check (delivery_radius_km is null or delivery_radius_km between 1 and 30);

-- A landmark for the rider ("opposite the temple"), optional.
alter table customer_addresses add column landmark text;

-- The code the customer gives the rider at the door. The rider cannot mark an
-- order delivered without it, so a wrong tap can no longer finish an order.
alter table orders add column delivery_code text check (delivery_code ~ '^[0-9]{4}$');

alter table deliveries
  add column code_attempts integer not null default 0,
  add column code_locked_until timestamptz;

-- Dispatch offers a delivery to one rider at a time. These find the live offer
-- for a delivery, and whether a rider is already holding one.
create index delivery_requests_live_idx on delivery_requests (delivery_id, status, expires_at);
create index delivery_requests_partner_live_idx on delivery_requests (partner_id, status, expires_at);

-- Unanswered orders are found by how long ago they reached the restaurant.
create index orders_confirmed_waiting_idx on orders (confirmed_at) where status = 'confirmed';
create index orders_unpaid_idx on orders (placed_at) where status = 'pending';
