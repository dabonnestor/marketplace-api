# PRD: Stripe Payment Processing

## Problem Statement

The marketplace API currently has no real payment processing. Orders progress through a manual status machine where the `paid` transition is just a database update — no money changes hands, no actual charges are made, and sellers have no way to receive payouts. Buyers can mark orders as paid without ever providing payment, and sellers ship goods on trust. The platform's 10% commission is calculated but never collected.

## Solution

Integrate Stripe Connect using the separate charges and transfers model. Buyers pay with credit/debit cards via Stripe at a dedicated pay endpoint, funds land in the platform's Stripe balance, and sellers receive payouts via Stripe Connect transfers when the buyer confirms delivery. Sellers must complete Stripe onboarding before creating listings. Stripe webhooks handle async events like disputes. The order state machine is updated to model real payment states (expired reservations, refunds) and to prevent financially-invalid transitions.

## User Stories

1. As a buyer, I want to pay for my order with a credit or debit card, so that the seller knows they can ship the item.
2. As a buyer, I want to see the full order breakdown (subtotal, shipping, platform fee, total) before I commit to payment, so that I know exactly what I'll be charged.
3. As a buyer, I want my card details to be handled securely by Stripe without ever touching the platform's servers, so that my payment information stays private.
4. As a buyer, I want to cancel an order before I've paid, so that I can back out of a purchase without financial consequences.
5. As a buyer, I want to request a full refund on a paid order, so that I can get my money back if something goes wrong.
6. As a buyer, I want my refund to cover the full order total, so that I'm not penalized for Stripe processing fees.
7. As a buyer, I want to file a dispute (chargeback) through my bank, so that I have recourse if the platform can't resolve my issue.
8. As a buyer, I want the order to automatically reflect when my bank dispute is created and resolved, so that I don't need to manually update the order status.
9. As a buyer, I want to be prevented from paying for an order after the 30-minute reservation window expires, so that I don't pay for an item that may have been re-listed.
10. As a buyer, I want a clear error message when my card is declined, so that I know why payment failed and can try a different card.
11. As a buyer, I want a clear error message when the Stripe service is temporarily unavailable, so that I know to try again later rather than assuming my payment failed.
12. As a seller, I want to complete Stripe Connect onboarding before I can create listings, so that I'm ready to receive payouts when my items sell.
13. As a seller, I want to check my Stripe onboarding status, so that I know whether I'm cleared to start selling.
14. As a seller, I want my payout to be automatically transferred when the buyer confirms delivery, so that I don't have to manually request payment.
15. As a seller, I want the transfer to be rejected (and the order kept in `delivered`) if my Stripe account can't receive payouts, so that the platform operator can resolve the issue without the order appearing finalized.
16. As a seller, I want a listing to be reserved when a buyer creates an order on it, so that I don't have two buyers fighting over the same item.
17. As a seller, I want a reserved listing to automatically become available again if the buyer doesn't pay within 30 minutes, so that another buyer can purchase it.
18. As a seller, I want a reserved listing to become available again if the buyer explicitly cancels the order, so that I can sell to someone else.
19. As a platform operator, I want the 10% platform fee to be retained in the platform's Stripe balance when payouts are sent, so that the platform earns its commission.
20. As a platform operator, I want all Stripe objects linked to their corresponding orders via Stripe IDs stored in the database, so that I can reconcile transactions and debug payment issues.
21. As a platform operator, I want Stripe webhooks to serve as a safety net for payment confirmation and to handle inherently async events like disputes, so that edge cases don't leave orders in inconsistent states.
22. As a platform operator, I want webhook handlers to be idempotent (replaying an already-processed event is a no-op), so that Stripe's at-least-once delivery doesn't corrupt order state.
23. As a platform operator, I want the webhook endpoint to verify Stripe's signature, so that only legitimate Stripe events can trigger state transitions.
24. As a platform operator, I want raw Stripe errors logged in full for debugging, but never exposed to API clients, so that sensitive payment information isn't leaked.
25. As a platform operator, I want the app to refuse to start if Stripe environment variables are missing, so that misconfiguration is caught immediately.
26. As a developer, I want integration tests that exercise the full payment flow against Stripe's test mode, so that I can verify payment behavior without real charges.

## Implementation Decisions

### Stripe Connect Model
- **Separate charges and transfers.** The platform charges the buyer's card, funds settle to the platform's Stripe balance, and a transfer to the seller's connected account is executed on `completed`. This is the only model that allows the platform to hold funds between payment and delivery.

### Payment Flow
- **Two-step: create order, then pay.** `createOrder` creates the order in `pending` status and creates a Stripe PaymentIntent for the full order total. The buyer reviews the breakdown, then calls `POST /orders/:id/pay` to confirm. Card details are handled by Stripe.js on the client; the server confirms the PaymentIntent.
- The PaymentIntent is created with: `amount` = order total in cents, `currency` from config (default `usd`), `capture_method: "automatic"`, `payment_method_types: ["card"]`, and metadata including `order_id`, `buyer_id`, `seller_id`, `listing_id`. The idempotency key is the order ID.

### Listing Reservation
- When an order is created (`pending`), the listing transitions to `reserved`. Only one pending order can exist per listing. The listing reverts to `active` if the order is cancelled or expires (30-minute TTL). Cleanup is lazy — the pay, cancel, and listing-access paths all check for expired pending orders.

### Refunds
- Full refund only for this iteration. The buyer initiates via `POST /orders/:id/refund`. The platform absorbs the Stripe processing fee. `refunded` is terminal.

### Disputes
- Detected via webhook (`charge.dispute.created`). The order transitions to `disputed` and stores `pre_dispute_status`. If the dispute is won (`charge.dispute.closed` + won), the order reverts to `pre_dispute_status`. If lost, the order transitions to `refunded`. The `disputed -> cancelled` transition is removed.

### Order State Machine
Final transition table:

```
pending     → paid, cancelled, expired
paid        → shipped, disputed, refunded
shipped     → delivered, disputed, refunded
delivered   → completed, disputed, refunded
completed   → (terminal)
disputed    → <pre_dispute_status>, refunded
cancelled   → (terminal)
expired     → (terminal)
refunded    → (terminal)
```

Role restrictions: `paid` (buyer only), `shipped` (seller only), `delivered` (seller only), `completed` (buyer only), `cancelled` (buyer only, only from `pending`), `refunded` (buyer only, from `paid`/`shipped`/`delivered`). `expired` has no role restriction (lazy/system cleanup). `disputed` has no role restriction (webhook-triggered). New timestamps: `refundedAt`.

### Seller Onboarding
- Sellers must complete Stripe Connect onboarding before creating their first listing. `POST /seller/onboard` creates a Stripe Express connected account and returns an account link URL. `GET /seller/onboard/status` returns `onboarded`, `charges_enabled`, and `payouts_enabled`. `POST /listings` checks that the seller has completed onboarding before allowing creation.

### Transfer to Seller
- Executed at `completed` (buyer confirms delivery). The transfer amount is the pre-calculated `sellerPayout`. If the transfer fails, the `completed` transition is rejected (returns 502), keeping the order in `delivered` for manual resolution. No automatic retry infrastructure.

### Webhook
- Single endpoint: `POST /api/v1/webhooks/stripe`. Events handled: `payment_intent.succeeded` (safety net), `payment_intent.payment_failed`, `charge.dispute.created`, `charge.dispute.closed`, `account.updated`. Signature verified via `STRIPE_WEBHOOK_SECRET`. Idempotency via state machine validation (replaying a stale event produces an invalid transition, which is logged and 200'd).

### API Surface
| Endpoint | Change |
|---|---|
| `POST /api/v1/orders` | Modified: creates PaymentIntent, sets listing to `reserved`, returns `clientSecret` |
| `POST /api/v1/orders/:id/pay` | New: confirms PaymentIntent, transitions `pending -> paid` |
| `POST /api/v1/orders/:id/cancel` | New: cancels PaymentIntent, transitions `pending -> cancelled`, releases listing |
| `POST /api/v1/orders/:id/refund` | New: creates Stripe refund, transitions to `refunded` |
| `PATCH /api/v1/orders/:id/status` | Kept for `shipped`, `delivered`, `completed` (no Stripe side effects) |
| `POST /api/v1/webhooks/stripe` | New: Stripe event receiver |
| `POST /api/v1/seller/onboard` | New: creates Stripe Connect account + returns onboarding URL |
| `GET /api/v1/seller/onboard/status` | New: checks onboarding status |
| `GET /api/v1/orders/:id` | Unchanged |
| `GET /api/v1/orders/buyer/purchases` | Unchanged |
| `GET /api/v1/orders/seller/sales` | Unchanged |

### Schema Changes
- `users`: add `stripe_account_id` (nullable varchar)
- `orders`: add `stripe_payment_intent_id` (nullable varchar), `stripe_transfer_id` (nullable varchar), `stripe_refund_id` (nullable varchar), `pre_dispute_status` (nullable, same enum type), `refunded_at` (nullable timestamp)
- `listings`: `status` gains value `reserved` (joining existing `active` and `sold`)
- `order_status` enum: add `expired`, `refunded`

### Error Handling
- Card declines: `402 Payment Required`, code `PAYMENT_FAILED`, message includes decline reason
- Stripe API errors: `502 Bad Gateway`, code `PAYMENT_SERVICE_UNAVAILABLE`
- Raw Stripe errors logged (including `stripeRequestId`, `stripeStatusCode`, `stripeType`), never returned to client
- A thin error-mapping function in the payments service converts `StripeError` to `AppError`

### Environment Variables
- `STRIPE_SECRET_KEY` (required) — platform Stripe secret key
- `STRIPE_WEBHOOK_SECRET` (required) — webhook signing secret
- Existing `PLATFORM_FEE_PERCENT` constant stays in `orders.schemas.ts`

### Module Structure
- **`payments/`** — Stripe client singleton and webhook signature verification (infrastructure, consumed by other modules)
- **`seller/`** — Onboarding routes and service for Stripe Connect account management
- **`orders/`** — Gets pay/cancel/refund endpoints, updated state machine, and order-payments orchestration service that bridges order lifecycle with Stripe operations. This is the deep module: it encapsulates all Stripe interaction behind simple async functions (`confirmPayment`, `refundOrder`, `transferToSeller`, `cancelPaymentIntent`).

### Database Write Order
- `createOrder`: begin with DB insert (order + listing reservation), then create Stripe PaymentIntent with order ID as idempotency key, then update order with the PaymentIntent ID. If Stripe fails, the order exists without a PaymentIntent — the pay endpoint lazily creates one if missing.

## Testing Decisions

- **Strategy**: Integration tests only — supertest against the full Express app with a real PostgreSQL test database and Stripe test mode (`sk_test_*` keys).
- **What makes a good test**: every test exercises the full request-response lifecycle. Verify HTTP status codes, response body shapes, order status transitions, listing status side effects, and Stripe object state (via Stripe API, not mocks). Tests do not inspect implementation details.
- **Test organization**: one test file for payment flows (`__tests__/payments.test.ts`), plus updates to the existing `orders.test.ts` for the new status transitions. Shared test helper manages DB lifecycle and Stripe test credentials.
- **Stripe test cards**: `4242 4242 4242 4242` for success, `4000 0000 0000 0002` for decline, etc. Webhook tests use `stripe.webhooks.generateTestHeaderString()`.
- **Prior art**: existing `__tests__/orders.test.ts` — tests the full HTTP → service → DB lifecycle with real database, no mocks.

## Out of Scope

- Partial refunds (full refund only)
- Partial disputes or dispute evidence submission via API
- ACH / bank transfer payment methods (cards only)
- Automatic retry of failed transfers (manual resolution)
- Stripe tax calculation or Stripe shipping rates
- Seller dashboard for viewing their Stripe balance or transfer history
- Background job processing for reservation expiry (lazy cleanup only)
- Idempotent event store for webhook events (state machine validation is sufficient)
- Stripe Connect onboarding via OAuth (account links only)

## Further Notes

- All decimal amounts continue to be returned as strings from the API. Stripe amounts (in cents) are converted to/from decimal strings at the boundary of the payments service.
- The platform fee is an application-level calculation, not a Stripe application fee. The platform simply transfers less than it collected.
- The reservation TTL (30 minutes) is not configurable per environment in this iteration — it's a constant.
- Stripe webhook signatures require the raw request body as a buffer. The webhook route must use `express.raw({ type: "application/json" })` rather than `express.json()`.
- The state machine is the idempotency guard for webhook replays. If an event would cause an invalid transition, it's logged and 200'd.
