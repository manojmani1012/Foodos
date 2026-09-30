-- Support tickets, platform settings, delivery zones and the system activity log.
-- Covers admin "Support & Tickets", "Settings & Configuration" and "System Activity Logs".

create sequence ticket_number_seq start 105000;

create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique default ('TCK' || nextval('ticket_number_seq')),
  raised_by uuid not null references users(id),
  raised_by_role text not null check (raised_by_role in ('customer', 'restaurant_owner', 'delivery_partner')),
  order_id uuid references orders(id),
  subject text not null,                    -- "Order not received", "Refund not received"
  description text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  assigned_to uuid references users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index support_tickets_status_idx on support_tickets (status, priority, created_at desc);
create index support_tickets_user_idx on support_tickets (raised_by, created_at desc);

create trigger support_tickets_set_updated_at before update on support_tickets
  for each row execute function set_updated_at();

create table ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  sender_id uuid not null references users(id),
  body text not null,
  is_internal boolean not null default false,   -- admin-only note
  created_at timestamptz not null default now()
);

create index ticket_messages_ticket_idx on ticket_messages (ticket_id, created_at);

-- "Zones & Areas: manage delivery zones". boundary is a GeoJSON polygon; move to
-- PostGIS if zone-matching becomes a hot path.
create table delivery_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null,
  boundary jsonb,
  base_delivery_fee_paise integer not null default 0 check (base_delivery_fee_paise >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (city, name)
);

create trigger delivery_zones_set_updated_at before update on delivery_zones
  for each row execute function set_updated_at();

-- General, Commission & Fees, Payment, SMS & Email, App Configuration.
-- Never store provider secrets here; those live in Secrets Manager / env.
create table app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

-- "Cancellation Reasons" setting, per actor.
create table cancellation_reasons (
  id uuid primary key default gen_random_uuid(),
  actor text not null check (actor in ('customer', 'restaurant', 'delivery_partner', 'admin')),
  label text not null,
  is_active boolean not null default true,
  unique (actor, label)
);

-- "System Activity Logs": date, user, action, module, IP.
create table audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references users(id),
  action text not null,               -- "Updated order status"
  module text not null,               -- "Orders", "Restaurants", "Settings"
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}',
  ip inet,
  created_at timestamptz not null default now()
);

create index audit_logs_created_idx on audit_logs (created_at desc);
create index audit_logs_module_idx on audit_logs (module, created_at desc);
create index audit_logs_actor_idx on audit_logs (actor_user_id, created_at desc);
