-- Phones that can receive push notifications.
--
-- A token identifies one app install on one phone, as issued by Expo's push
-- service (which passes messages on to Google or Apple). The same person can
-- have the customer app and the delivery app on one phone, so the app is part
-- of each row: a rider's "new delivery" must not appear in their customer app.

create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  app text not null check (app in ('customer', 'restaurant', 'delivery')),
  -- One install, one row: signing in to another account on the same phone
  -- moves the token to that account.
  token text not null unique,
  platform text check (platform in ('android', 'ios')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_tokens_user_app_idx on push_tokens (user_id, app);
