-- Restaurants and menus. Covers the admin Restaurant Management table
-- (owner, status, joined), the restaurant app profile and the customer Restaurant screen.

create table restaurants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id),
  name text not null,
  description text,
  cuisines text[] not null default '{}',   -- "Biryani, North Indian, Chinese"
  phone text,
  image_url text,
  is_veg boolean not null default false,    -- "Pure Veg" badge
  address_line text not null,
  city text not null,
  pincode text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  fssai_number text,
  gst_number text,
  avg_prep_minutes integer not null default 30,
  commission_pct numeric(5, 2) not null default 20 check (commission_pct between 0 and 100),
  rating numeric(3, 2) not null default 0 check (rating between 0 and 5),
  rating_count integer not null default 0,
  -- Admin lifecycle: Active / Pending / Suspended.
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended', 'rejected')),
  -- Restaurant app dashboard "accepting orders" toggle.
  is_accepting_orders boolean not null default true,
  opens_at time,
  closes_at time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index restaurants_owner_idx on restaurants (owner_id);
create index restaurants_status_idx on restaurants (status);
create index restaurants_city_idx on restaurants (city) where status = 'active';
create index restaurants_cuisines_idx on restaurants using gin (cuisines);

create trigger restaurants_set_updated_at before update on restaurants
  for each row execute function set_updated_at();

-- Sidebar on the Restaurant screen: Biryani, Starters, Main Course, Combos, Breads...
create table menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (restaurant_id, name)
);

create table menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  category_id uuid references menu_categories(id) on delete set null,
  name text not null,
  description text,
  price_paise integer not null check (price_paise >= 0),
  image_url text,
  is_veg boolean not null default false,
  is_available boolean not null default true,   -- "availability" switch on Add Menu Item
  rating numeric(3, 2) check (rating between 0 and 5),
  rating_count integer not null default 0,
  sort_order integer not null default 0,
  deleted_at timestamptz,                        -- soft delete: past orders keep their snapshot
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index menu_items_restaurant_idx on menu_items (restaurant_id) where deleted_at is null;
create index menu_items_category_idx on menu_items (category_id);

create trigger menu_items_set_updated_at before update on menu_items
  for each row execute function set_updated_at();

-- Food Detail screen add-ons: "Extra Chicken (2 pcs) +₹90", "Raita +₹30".
create table menu_item_addons (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  name text not null,
  price_paise integer not null check (price_paise >= 0),
  is_available boolean not null default true,
  sort_order integer not null default 0
);

create index menu_item_addons_item_idx on menu_item_addons (menu_item_id);

create table favourites (
  user_id uuid not null references users(id) on delete cascade,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, restaurant_id)
);
