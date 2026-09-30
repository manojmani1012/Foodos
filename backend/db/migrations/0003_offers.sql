-- Offers and coupons. Admin "Offers & Promotions" table (name, type, discount, code,
-- used, status) and the customer cart "Apply Coupon" / Home "Top Offers" cards.

create table offers (
  id uuid primary key default gen_random_uuid(),
  name text not null,                         -- "First Order", "Free Delivery", "Weekend Special"
  code text not null,
  type text not null check (type in ('percent', 'flat', 'free_delivery')),
  percent_off numeric(5, 2) check (percent_off > 0 and percent_off <= 100),
  flat_off_paise integer check (flat_off_paise > 0),
  max_discount_paise integer check (max_discount_paise > 0),   -- "upto ₹160"
  min_order_paise integer not null default 0,                   -- "on orders above ₹199"
  first_order_only boolean not null default false,
  restaurant_id uuid references restaurants(id) on delete cascade, -- null = platform-wide
  usage_limit integer,                                          -- total redemptions, null = unlimited
  per_user_limit integer not null default 1,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  is_active boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offers_value_matches_type check (
    (type = 'percent' and percent_off is not null)
    or (type = 'flat' and flat_off_paise is not null)
    or (type = 'free_delivery')
  ),
  constraint offers_valid_window check (valid_until is null or valid_until > valid_from)
);

-- Codes are matched case-insensitively.
create unique index offers_code_idx on offers (upper(code));

create trigger offers_set_updated_at before update on offers
  for each row execute function set_updated_at();
