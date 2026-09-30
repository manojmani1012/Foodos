-- Checkout must be safe to retry.
--
-- A double-tap on "Place Order", or a retry after the network dropped between
-- the order being written and the response arriving, must not create a second
-- order. The client generates a key per checkout attempt and sends it with the
-- request; a repeat of the same key returns the original order instead of
-- placing another one.

alter table orders add column idempotency_key text;

-- Scoped to the customer, so two people cannot collide on the same key.
create unique index orders_idempotency_key_idx
  on orders (customer_id, idempotency_key)
  where idempotency_key is not null;
