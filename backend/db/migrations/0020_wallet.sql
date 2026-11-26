-- Foodos wallet: top-ups through Razorpay, paying for an order from the
-- balance, and cancelled wallet orders going straight back to it.
-- The wallets and wallet_transactions tables came with 0006; this ties each
-- ledger row to what caused it, so nothing can be credited or refunded twice.

alter table wallet_transactions
  add column payment_id uuid references payments(id),
  add column note text,
  add column created_by uuid references users(id);

-- One credit per top-up payment: the app confirming and the webhook arriving
-- are two routes to the same credit, and only one may land.
create unique index wallet_transactions_topup_once
  on wallet_transactions (payment_id) where reason = 'topup';

-- One debit and at most one refund per order.
create unique index wallet_transactions_order_payment_once
  on wallet_transactions (order_id) where reason = 'order_payment';

create unique index wallet_transactions_order_refund_once
  on wallet_transactions (order_id) where reason = 'refund';

-- An adjustment from the admin panel always says why.
alter table wallet_transactions
  add constraint wallet_adjustment_has_note check (reason <> 'adjustment' or note is not null);
