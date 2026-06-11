# ADR 0002: Store PaymentIntent Secrets in Database

## Status

Accepted (2026-06-10)

## Context

When a buyer creates an order, the platform creates a Stripe PaymentIntent and returns the `client_secret` to the frontend so Stripe's PaymentElement can collect card details. The buyer may reload the page or navigate away before paying. On a subsequent `GET /orders/:id`, the frontend needs the `client_secret` to re-mount the PaymentElement.

The initial implementation called `stripe.paymentIntents.create()` on every `GET /orders/:id`, relying on Stripe's idempotency key (set to the order ID) to return the same PaymentIntent without creating a duplicate. This approach:

- Made an unnecessary Stripe API call on every order read
- Depended on idempotency behavior that, while reliable, is an implicit contract rather than an explicit one
- Introduced a latent problem if the idempotency key were ever lost or misconfigured

## Decision

Store `stripePaymentIntentId` and `stripeClientSecret` directly in the `orders` table at PaymentIntent creation time. `GET /orders/:id` returns the stored `clientSecret` for pending orders without calling Stripe.

## Alternatives Considered

### Re-create PaymentIntent on every getOrder (status quo)

Rejected because it wastes a Stripe API round-trip on every read, depends on idempotency behavior that is not the primary purpose of the idempotency key, and offers no benefit — the PaymentIntent ID and client secret are stable after creation.

### Re-create only when clientSecret is missing

Rejected as a half-measure. It still depends on the idempotency key for correctness and adds branching logic to a read path that should be simple.

## Consequences

- `GET /orders/:id` for pending orders returns the stored `clientSecret` with zero Stripe API calls
- PaymentIntent creation is truly one-shot — happens at order creation, never again
- The `orders` table gains two Stripe columns: `stripe_payment_intent_id` and `stripe_client_secret`
- The `payOrder` flow includes a lazy fallback: if `stripePaymentIntentId` is null on a legacy order (pre-migration), it calls `createOrGetPaymentIntent` to backfill
- If Stripe rotates or expires client secrets in the future, stored secrets would need rehydration — but currently client secrets are stable for the lifetime of the PaymentIntent
