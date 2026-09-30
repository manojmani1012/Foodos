-- Orders. Covers the customer Cart / Order Tracking / My Orders, the restaurant app
-- New / Preparing / Ready queues, and the admin Orders Management table.

-- Human-friendly ids shown in every app: #FD125487
create sequence order_number_seq start 125000;

create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('FD' || nextval('order_number_seq')),
  customer_id uuid not null references users(id),
  restaurant_id uuid not null references restaurants(id),
  -- Snapshot of the address at order time; the saved address may change later.
  delivery_address jsonb not null,
  status text not null default 'pending' check (status in (
    'pending',      -- placed, awaiting payment / restaurant acceptance
    'confirmed',    -- "Order Confirmed"
    'preparing',    -- "Preparing Your Food"
    'ready',        -- ready for pickup
    'picked_up',    -- "Picked Up"
    'on_the_way',   -- "On the Way"
    'delivered',
    'cancelled'     -- includes restaurant rejection; see cancelled_by
  )),
  subtotal_paise integer not null check (subtotal_paise >= 0),
  delivery_fee_paise integer not null default 0 check (delivery_fee_paise >= 0),
  packaging_fee_paise integer not null default 0 check (packaging_fee_paise >= 0),
  tax_paise integer not null default 0 check (tax_paise >= 0),
  tip_paise integer not null default 0 check (tip_paise >= 0),
  discount_paise integer not null default 0 check (discount_paise >= 0),
  total_paise integer not null check (total_paise >= 0),
  offer_id uuid references offers(id),
  payment_method text not null check (payment_method in ('upi', 'card', 'wallet', 'cod')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'failed', 'refunded')),
  special_instructions text,
  estimated_delivery_at timestamptz,
  placed_at timestamptz not null default now(),
  confirmed_at timestamptz,
  ready_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by in ('customer', 'restaurant', 'delivery_partner', 'admin', 'system')),
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_total_matches_parts check (
    total_paise = subtotal_paise + delivery_fee_paise + packaging_fee_paise + tax_paise + tip_paise - discount_paise
  )
);

create index orders_customer_idx on orders (customer_id, placed_at desc);
create index orders_restaurant_idx on orders (restaurant_id, status, placed_at desc);
create index orders_status_idx on orders (status, placed_at desc);

create trigger orders_set_updated_at before update on orders
  for each row execute function set_updated_at();

-- Line items keep a name/price snapshot so menu edits never rewrite history.
create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  menu_item_id uuid references menu_items(id) on delete set null,
  name text not null,
  is_veg boolean not null default false,
  unit_price_paise integer not null check (unit_price_paise >= 0),
  quantity integer not null check (quantity > 0),
  line_total_paise integer not null check (line_total_paise >= 0)
);

create index order_items_order_idx on order_items (order_id);

create table order_item_addons (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references order_items(id) on delete cascade,
  name text not null,
  price_paise integer not null check (price_paise >= 0)
);

create index order_item_addons_item_idx on order_item_addons (order_item_id);

-- Drives the customer tracking timeline and the admin audit trail for an order.
create table order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references orders(id) on delete cascade,
  status text not null,
  actor_user_id uuid references users(id),
  note text,
  created_at timestamptz not null default now()
);

create index order_status_history_order_idx on order_status_history (order_id, created_at);

create table offer_redemptions (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references offers(id),
  user_id uuid not null references users(id),
  order_id uuid not null unique references orders(id) on delete cascade,
  discount_paise integer not null check (discount_paise >= 0),
  created_at timestamptz not null default now()
);

create index offer_redemptions_offer_idx on offer_redemptions (offer_id);
create index offer_redemptions_user_idx on offer_redemptions (user_id, offer_id);

-- "Reviews (1.2k)" tab on the Restaurant screen; one review per delivered order.
create table restaurant_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id) on delete cascade,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  user_id uuid not null references users(id),
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create index restaurant_reviews_restaurant_idx on restaurant_reviews (restaurant_id, created_at desc);
