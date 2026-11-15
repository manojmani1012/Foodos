-- GST invoices: each delivered order gets one invoice number when its invoice
-- is first opened. Numbers count up within a financial year (April to March)
-- and are never reused, as the GST invoice rules require.
create table invoice_counters (
  financial_year text primary key,       -- "2627" for April 2026 to March 2027
  last_number integer not null check (last_number > 0)
);

alter table orders add column invoice_number text unique;

-- Rider documents (licence, RC, Aadhaar) are identity papers: they are kept
-- with the other uploads but never served by the public /media/ link, only to
-- admins through a signed-in request.
alter table media add column is_private boolean not null default false;
