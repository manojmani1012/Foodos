-- Cash on delivery can be switched off, and riders can pay in the cash they
-- hold online ("Deposit now") as well as hand it over to staff.

-- What a payment with no order was for. Null is a wallet top-up, as before.
alter table payments add column purpose text check (purpose in ('rider_cash_deposit'));

-- An online deposit is tied to its payment, so the app confirming and the
-- webhook arriving can only record it once.
alter table rider_cash_deposits add column payment_id uuid unique references payments(id);
