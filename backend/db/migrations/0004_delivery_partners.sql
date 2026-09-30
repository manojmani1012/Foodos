-- Delivery partners: profile, vehicle, documents and incentive rules.
-- Covers admin Delivery Partners Management (rating, status, joined) and the partner
-- app Profile menu (Vehicle Details, Documents, Earnings & Payouts).

create table delivery_partners (
  user_id uuid primary key references users(id),
  vehicle_type text not null default 'bike' check (vehicle_type in ('bike', 'scooter', 'bicycle', 'ev')),
  vehicle_number text,
  license_number text,
  city text,
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended', 'rejected')),
  is_online boolean not null default false,     -- Online / Offline toggle on the partner Home
  current_latitude numeric(9, 6),
  current_longitude numeric(9, 6),
  last_location_at timestamptz,
  rating numeric(3, 2) not null default 0 check (rating between 0 and 5),
  rating_count integer not null default 0,
  -- Payout destination. Store only masked/tokenised data here; real bank details
  -- belong with the payment provider or in an encrypted store.
  payout_upi_id text,
  payout_account_masked text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index delivery_partners_available_idx on delivery_partners (city) where is_online and status = 'active';

create trigger delivery_partners_set_updated_at before update on delivery_partners
  for each row execute function set_updated_at();

create table delivery_partner_documents (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references delivery_partners(user_id) on delete cascade,
  doc_type text not null check (doc_type in ('driving_license', 'vehicle_rc', 'aadhaar', 'pan', 'photo', 'insurance')),
  file_url text not null,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  rejection_reason text,
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (partner_id, doc_type)
);

-- "Incentive Zone: Complete 15 trips to earn ₹250 extra".
create table incentive_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_trips integer not null check (target_trips > 0),
  bonus_paise integer not null check (bonus_paise > 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
