-- Partial refunds with photo proof and a stated problem, and refunds a
-- restaurant asks for, which Foodos checks before any money moves.

-- What went wrong: food (the restaurant's), delivery (the rider's) or the app
-- (Foodos's). Older refunds have none.
alter table refunds add column issue text check (issue in ('food', 'delivery', 'app'));

create table refund_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  amount_paise integer not null check (amount_paise > 0),
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason text,
  requested_by uuid references users(id) on delete set null,
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  refund_id uuid references refunds(id) on delete set null,
  created_at timestamptz not null default now()
);

-- One waiting request per order at a time.
create unique index refund_requests_one_pending on refund_requests (order_id) where status = 'pending';
create index refund_requests_status_idx on refund_requests (status, created_at);
create index refund_requests_order_idx on refund_requests (order_id);

-- The photos behind a refund or a request. The images themselves are private
-- media: only signed-in staff can open them.
create table refund_photos (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  media_id uuid not null references media(id) on delete cascade,
  uploaded_by uuid references users(id) on delete set null,
  refund_id uuid references refunds(id) on delete set null,
  request_id uuid references refund_requests(id) on delete set null,
  created_at timestamptz not null default now()
);

create index refund_photos_order_idx on refund_photos (order_id);
