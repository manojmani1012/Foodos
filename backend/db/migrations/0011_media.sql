-- Uploaded images: dish photos now, restaurant covers and rider documents later.
--
-- Stored in the database rather than on disk on purpose. The API runs in a
-- container whose filesystem is wiped on every deploy, so a file written there
-- would vanish the next time code shipped. Postgres survives deploys and is
-- already backed up. When volume grows this table is the one thing to move to
-- object storage (S3 or similar); the URLs the apps hold, /media/<id>, do not
-- have to change.

create table media (
  id uuid primary key default gen_random_uuid(),
  -- Whoever uploaded it. Deleting the account removes their images.
  owner_id uuid not null references users(id) on delete cascade,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size > 0),
  data bytea not null,
  created_at timestamptz not null default now()
);

create index media_owner_idx on media (owner_id);
