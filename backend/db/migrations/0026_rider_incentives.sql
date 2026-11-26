-- Rider login hours, the shift rule for the per-order incentive, extra
-- earning offers for particular days, and thanking a customer for a tip.

-- One row per stretch a rider was online and heard from. A stretch ends when
-- they go offline, or when the phone stops reporting for a while.
create table rider_online_sessions (
  id bigint generated always as identity primary key,
  partner_id uuid not null references delivery_partners(user_id) on delete cascade,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  check (last_seen_at >= started_at)
);

create unique index rider_online_sessions_one_open on rider_online_sessions (partner_id) where ended_at is null;
create index rider_online_sessions_partner_idx on rider_online_sessions (partner_id, started_at);

-- Under the shift rule the per-order incentive waits for the day to end:
-- this is what the trip would earn. Null: not waiting.
alter table deliveries add column deferred_incentive_paise integer check (deferred_incentive_paise > 0);

-- One row per rider and day once the rule has been applied, so it is applied once.
create table rider_incentive_days (
  partner_id uuid not null references delivery_partners(user_id) on delete cascade,
  day date not null,
  eligible boolean not null,
  trips integer not null,
  amount_paise integer not null,
  detail jsonb not null default '{}',
  settled_at timestamptz not null default now(),
  primary key (partner_id, day)
);

alter table earnings_entries drop constraint earnings_entries_kind_check;
alter table earnings_entries add constraint earnings_entries_kind_check check (
  kind in ('order', 'delivery', 'incentive', 'cash_collected', 'cash_deposit', 'refund', 'adjustment')
);

-- Extra earning offers: a trip target can be for every day, weekdays, weekends,
-- or particular festival dates.
alter table incentive_rules
  add column day_type text not null default 'every_day'
    check (day_type in ('every_day', 'weekday', 'weekend', 'festival')),
  add column festival_from date,
  add column festival_to date,
  add constraint incentive_rule_festival_dates check (
    (day_type = 'festival' and festival_from is not null and festival_to is not null and festival_to >= festival_from)
    or (day_type <> 'festival' and festival_from is null and festival_to is null)
  );

-- "Say thanks" for a tip.
alter table deliveries add column tip_thanked_at timestamptz;
