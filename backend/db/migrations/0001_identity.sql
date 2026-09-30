-- Identity: users, roles, OTP codes, social logins, sessions, saved addresses.
-- Money is stored everywhere as integer paise (₹1 = 100 paise) to match Razorpay.

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table users (
  id uuid primary key default gen_random_uuid(),
  phone text unique,            -- E.164, e.g. +919876543210
  email text unique,            -- lower-case; used by admin login
  full_name text,
  avatar_url text,
  password_hash text,           -- admin / super admin only; customers and partners use OTP
  status text not null default 'active' check (status in ('active', 'blocked')),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_contact_required check (phone is not null or email is not null),
  constraint users_phone_e164 check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint users_email_lower check (email is null or email = lower(email))
);

create trigger users_set_updated_at before update on users
  for each row execute function set_updated_at();

-- One person can hold several roles (e.g. customer and delivery partner on the same phone).
create table user_roles (
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('customer', 'restaurant_owner', 'delivery_partner', 'admin', 'super_admin')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- "Continue with Google / Apple / Facebook" on the customer login screen.
create table auth_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('google', 'apple', 'facebook')),
  provider_user_id text not null,
  created_at timestamptz not null default now(),
  unique (provider, provider_user_id)
);

create index auth_identities_user_idx on auth_identities (user_id);

-- Only a hash of the OTP is stored. `attempts` caps brute-forcing of the 4-digit code.
create table otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  purpose text not null default 'login',
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index otp_codes_phone_idx on otp_codes (phone, created_at desc);

-- Rotating refresh tokens. All tokens issued from one login share a family_id so a
-- replayed (already rotated) token can revoke the whole family.
create table refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  role text not null,
  family_id uuid not null,
  token_hash text not null unique,
  user_agent text,
  ip inet,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index refresh_tokens_user_idx on refresh_tokens (user_id);
create index refresh_tokens_family_idx on refresh_tokens (family_id);

-- Profile > Saved Addresses, and the "Deliver now" location on Home.
create table customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  label text not null default 'Home',
  line1 text not null,
  line2 text,
  city text not null,
  pincode text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customer_addresses_user_idx on customer_addresses (user_id);
create unique index customer_addresses_one_default_idx on customer_addresses (user_id) where is_default;

create trigger customer_addresses_set_updated_at before update on customer_addresses
  for each row execute function set_updated_at();
