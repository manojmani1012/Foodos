-- Bulk bank payments: staff download one file of due payouts, upload it to the
-- bank (NEFT / RTGS), then upload the bank's result to mark each one paid or
-- failed. Each file keeps its own copy of what it asked the bank to send, so a
-- later change to a bank account never rewrites history.

create table payout_bank_files (
  id uuid primary key default gen_random_uuid(),
  number integer generated always as identity unique,
  payment_count integer not null check (payment_count > 0),
  total_paise bigint not null check (total_paise > 0),
  cancelled_at timestamptz,
  cancelled_by uuid references users(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- One line of a file. `reference` is what the bank sends back in its result.
create table payout_bank_file_items (
  file_id uuid not null references payout_bank_files(id) on delete cascade,
  line integer not null,
  payout_id uuid not null references payouts(id) on delete cascade,
  reference text not null unique,
  mode text not null check (mode in ('NEFT', 'RTGS')),
  beneficiary_name text not null,
  account_number text not null,
  ifsc text not null,
  amount_paise integer not null check (amount_paise > 0),
  primary key (file_id, line)
);

create index payout_bank_file_items_payout_idx on payout_bank_file_items (payout_id);

-- The file a payout is waiting on (or was last sent in).
alter table payouts add column bank_file_id uuid references payout_bank_files(id) on delete set null;

-- One bank transfer pays one payout.
create unique index payouts_bank_reference_once on payouts (lower(payout_reference))
  where payout_reference is not null and bank_file_id is not null;
