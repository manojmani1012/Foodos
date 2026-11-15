-- Test accounts, so the client's staff can run a whole order from home or the
-- office: an order placed by a test customer is a test order. Test orders go
-- only to test riders, at any distance, without the "be at the pin" check, and
-- stay out of payouts. Real orders never go to a test rider.

alter table users add column is_test boolean not null default false;
alter table orders add column is_test boolean not null default false;
