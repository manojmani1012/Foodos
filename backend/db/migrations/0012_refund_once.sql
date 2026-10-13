-- A payment is refunded at most once.
--
-- The order lock already stops two cancellations of the same order, but a
-- capture that lands after a cancellation is a second route to the refund
-- code. This makes "refund it twice" impossible rather than merely unlikely.
-- A failed attempt does not count, so it can be retried.

create unique index refunds_one_live_per_payment
  on refunds (payment_id)
  where status <> 'failed';
