# PRD: Two-Sided Marketplace API

## Problem Statement

The user needs a backend API for a two-sided marketplace where buyers and sellers transact physical goods. The platform must handle real payments via Stripe Connect, hold funds between payment and delivery, take a flat commission, and enforce a structured order lifecycle with refunds, disputes, and seller onboarding. The API must be secure, testable, well-documented, and built on a stack that balances developer velocity with production readiness.

## Solution

A RESTful Express API written in TypeScript with PostgreSQL as the database. Users have a single account that supports both buying and selling. Sellers create listings (after completing Stripe Connect onboarding), buyers place orders and pay via Stripe, and orders progress through a state machine from pending through to completed. The platform takes a 10% commission on each transaction, retained when payouts are sent to sellers' Stripe Connect accounts. Stripe webhooks serve as a safety net for async events (payment confirmation, disputes). Full-text search on listings is handled via PostgreSQL tsvector. Authentication uses email/password with bcrypt-hashed passwords and JWT access + refresh tokens. The API is documented via OpenAPI 3.0 with Swagger UI.

## User Stories

### Authentication

1. As a new user, I want to register with my email, name, and password, so that I can start buying and selling.
2. As a registered user, I want to log in and receive access tokens, so that I can make authenticated requests.
3. As a logged-in user, I want to refresh my access token with a long-lived refresh token, so that I don't have to log in again when my session expires.
4. As a logged-in user, I want to view my profile, so that I can confirm my identity.

### Listings

5. As a seller, I want to create a listing with a title, description, price, category, condition, shipping cost, and images, so that buyers can discover my item.
6. As a seller, I want to update any field of my listing, so that I can correct mistakes or change pricing.
7. As a seller, I want to delete my listing, so that it is no longer visible to buyers.
8. As a buyer, I want to browse active listings with pagination, so that I can discover items without overwhelming page loads.
9. As a buyer, I want to filter listings by category, so that I can narrow my search to relevant items.
10. As a buyer, I want to filter listings by price range, so that I can find items within my budget.
11. As a buyer, I want to search listings by keyword matching on title and description, so that I can find specific items quickly.
12. As a buyer, I want to view the full details of a single listing with the seller's name, so that I can make an informed purchase decision.
13. As a seller, I want to view all my listings (both active and sold) with pagination, so that I can manage my inventory.

### Ordering & Payments

14. As a buyer, I want to place an order on a listing, so that I can purchase an item.
15. As a buyer, I want the platform to prevent me from buying my own listing, so that obvious errors are caught before checkout.
16. As a buyer, I want to see the full order breakdown (subtotal, shipping, platform fee, total) and seller payout before I commit to payment, so that I know exactly what I'll be charged.
17. As a buyer, I want to pay for my order with a credit or debit card, so that the seller knows they can ship the item.
18. As a buyer, I want my card details to be handled securely by Stripe without ever touching the platform's servers, so that my payment information stays private.
19. As a buyer, I want to cancel an order before I've paid, so that I can back out of a purchase without financial consequences.
20. As a buyer, I want to be prevented from paying for an order after the 30-minute reservation window expires, so that I don't pay for an item that may have been re-listed.
21. As a buyer, I want a clear error message when my card is declined, so that I know why payment failed and can try a different card.
22. As a buyer, I want a clear error message when the Stripe service is temporarily unavailable, so that I know to try again later.

### Order Lifecycle

23. As a seller, I want to mark an order as shipped, so that the buyer knows the item is on the way.
24. As a seller, I want to mark an order as delivered, so that the buyer knows the item has arrived.
25. As a buyer, I want to confirm delivery and mark the order as completed, so that the transaction is finalized and the seller receives their payout.
26. As a participant in an order, I want invalid status transitions to be rejected, so that order state stays consistent.
27. As a participant in an order, I want unauthorized role transitions to be rejected, so that only the buyer can mark paid/cancel/complete/refund and only the seller can mark shipped/delivered.
28. As a completed order participant, I want further status changes to be rejected, so that finalized orders stay finalized.

### Refunds & Disputes

29. As a buyer, I want to request a full refund on a paid order, so that I can get my money back if something goes wrong.
30. As a buyer, I want my refund to cover the full order total, so that I'm not penalized for Stripe processing fees.
31. As a buyer, I want to file a dispute (chargeback) through my bank, so that I have recourse if the platform can't resolve my issue.
32. As a buyer, I want the order to automatically reflect when my bank dispute is created and resolved, so that I don't need to manually update the order status.

### Seller Payouts

33. As a seller, I want to complete Stripe Connect onboarding before I can create listings, so that I'm ready to receive payouts when my items sell.
34. As a seller, I want to check my Stripe onboarding status, so that I know whether I'm cleared to start selling.
35. As a seller, I want my payout to be automatically transferred when the buyer confirms delivery, so that I don't have to manually request payment.
36. As a seller, I want the transfer to be rejected (and the order kept in `delivered`) if my Stripe account can't receive payouts, so that the platform operator can resolve the issue.
37. As a seller, I want a listing to be reserved when a buyer creates an order on it, so that I don't have two buyers fighting over the same item.
38. As a seller, I want a reserved listing to automatically become available again if the buyer doesn't pay within 30 minutes, so that another buyer can purchase it.
39. As a seller, I want a reserved listing to become available again if the buyer explicitly cancels the order, so that I can sell to someone else.

### Order History

40. As a buyer, I want to view all my purchases with pagination, optional status filtering, listing title, and listing image, so that I can track my order history.
41. As a seller, I want to view all my sales with pagination, optional status filtering, listing title, and listing image, so that I can manage my fulfillment pipeline.

### Platform Operations

42. As a platform operator, I want the 10% platform fee to be retained in the platform's Stripe balance when payouts are sent, so that the platform earns its commission.
43. As a platform operator, I want Stripe webhooks to serve as a safety net for payment confirmation and to handle inherently async events like disputes, so that edge cases don't leave orders in inconsistent states.
44. As a platform operator, I want webhook handlers to be idempotent, so that Stripe's at-least-once delivery doesn't corrupt order state.
45. As a platform operator, I want the webhook endpoint to verify Stripe's signature, so that only legitimate Stripe events can trigger state transitions.
46. As a platform operator, I want raw Stripe errors logged in full for debugging, but never exposed to API clients, so that sensitive payment information isn't leaked.
47. As a platform operator, I want the app to refuse to start if required environment variables are missing, so that misconfiguration is caught immediately.

### Developer Experience

48. As an API consumer, I want a health check endpoint, so that I can monitor service availability.
49. As a developer integrating with the API, I want an OpenAPI spec served at a documentation endpoint, so that I can explore and test the API interactively.
50. As an operator, I want structured JSON logs for every request and error, so that I can monitor and debug the service in production.
51. As a developer, I want integration tests covering the full request-response lifecycle, so that I can refactor with confidence.

## Implementation Decisions

### Stack

- **Runtime**: Node.js with Express 4, TypeScript (strict mode), ES2022 target with NodeNext module resolution
- **Database**: PostgreSQL accessed via Drizzle ORM with Drizzle Kit for migrations
- **Authentication**: bcrypt (cost factor 12) for password hashing; jsonwebtoken for signing access tokens (15min expiry) and refresh tokens (7 day expiry)
- **Validation**: Zod — schemas shared across request validation, DB insertion types, and OpenAPI schema generation
- **Logging**: Pino for structured JSON logging; pino-http for automatic request/response logging
- **API Documentation**: OpenAPI 3.0.3 spec generated from Zod schemas via zod-to-json-schema; served with swagger-ui-express

### Architecture

- **Hybrid folder structure**: features co-locate routes, schemas, and service logic (e.g., `features/orders/` contains `orders.routes.ts`, `orders.schemas.ts`, `orders.service.ts`). Shared infrastructure lives in `shared/` — config, error classes, logger, auth middleware, validation middleware, OpenAPI spec.
- **Centralized error handling**: typed error classes (`AppError`, `NotFoundError`, `UnauthorizedError`, `ForbiddenError`, `ValidationError`, `ConflictError`) thrown from service layer, caught by a single Express error middleware that serializes them to a consistent JSON shape: `{ error: { code, message, details? } }`.
- **API versioning**: URL-based (`/api/v1/...`) for explicit contract visibility.
- **Security**: Helmet (with CSP relaxed for Swagger UI inline scripts), CORS, express-rate-limit (1000 req/15min global, 20 req/15min on auth endpoints), 1MB request body limit.

### Database Schema

- **users**: `id` (uuid PK, default random), `email` (unique, varchar 255), `passwordHash` (varchar 255), `name` (varchar 255), `stripeAccountId` (nullable varchar), `createdAt`, `updatedAt`
- **listings**: `id` (uuid PK), `sellerId` (FK → users), `title`, `description`, `price` (decimal 12,2), `category`, `condition`, `shippingCost` (decimal 10,2), `images` (text array), `status` (varchar, values: `active`, `reserved`, `sold`), timestamps. Indexes on sellerId, category, status. GIN index on tsvector of title + description for full-text search.
- **orders**: `id` (uuid PK), `buyerId` (FK → users), `sellerId` (FK → users), `listingId` (FK → listings), `status` (enum: pending, paid, shipped, delivered, completed, disputed, cancelled, expired, refunded), `subtotal`, `shippingCost`, `platformFee`, `total`, `sellerPayout` (all decimals), `stripePaymentIntentId`, `stripeClientSecret`, `stripeTransferId`, `stripeRefundId`, `preDisputeStatus` (nullable, same enum type), `paidAt`, `shippedAt`, `deliveredAt`, `completedAt`, `refundedAt` (timestamps). Indexes on buyerId, sellerId, status.
- **User model**: single account, dual role. No separate buyer/seller tables. The user simply performs whichever role is appropriate for the action.

### Order State Machine

```
pending    → paid, cancelled, expired
paid       → shipped, disputed, refunded
shipped    → delivered, disputed, refunded
delivered  → completed, disputed, refunded
completed  → (terminal)
disputed   → <preDisputeStatus>, refunded
cancelled  → (terminal)
expired    → (terminal)
refunded   → (terminal)
```

- Role restrictions: `paid` (buyer), `shipped` (seller), `delivered` (seller), `completed` (buyer), `cancelled` (buyer, only from `pending`), `refunded` (buyer, from `paid`/`shipped`/`delivered`)
- `expired` has no role restriction (system cleanup via lazy expiry check)
- `disputed` has no role restriction (webhook-triggered)
- The `disputed` status stores the previous status (`preDisputeStatus`). If the dispute is won, the order reverts; if lost, it moves to `refunded`.
- Timestamp fields (`paidAt`, `shippedAt`, `deliveredAt`, `completedAt`, `refundedAt`) are set automatically on the corresponding transition.
- Terminal states: `completed`, `cancelled`, `expired`, `refunded`.

### Commission

- Flat 10% platform fee calculated on the listing subtotal at order creation
- `platformFee = round(subtotal * 0.10, 2)`
- `total = subtotal + shippingCost`
- `sellerPayout = total - platformFee`
- The platform fee is an application-level calculation, not a Stripe application fee. The platform transfers less than it collected.

### Stripe Connect Model

- **Separate charges and transfers.** The platform charges the buyer's card, funds settle to the platform's Stripe balance, and a transfer to the seller's connected account is executed on `completed`.
- Seller accounts are Stripe Express Connect accounts.
- All Stripe object IDs (`payment_intent`, `transfer`, `refund`) are stored on the order for reconciliation.

### Payment Flow

- **Two-step: create order, then pay.** `createOrder` creates the order in `pending` status, creates a Stripe PaymentIntent for the full order total, reserves the listing, and returns the PaymentIntent's `clientSecret` for client-side confirmation. The buyer reviews the breakdown, then calls `POST /orders/:id/pay` to confirm.
- The PaymentIntent is created with: `amount` = order total in cents, `currency` = `usd`, `capture_method: "automatic"`, `payment_method_types: ["card"]`, and metadata including `order_id`, `buyer_id`, `seller_id`, `listing_id`. The idempotency key is the order ID.
- `database first`: insert order + reserve listing, then create Stripe PaymentIntent, then update order with the PaymentIntent ID. If Stripe fails, the order exists without a PaymentIntent — the pay endpoint lazily creates one if missing.

### Listing Reservation

- When an order is created (`pending`), the listing transitions to `reserved`. Only one pending order can exist per listing.
- The listing reverts to `active` if the order is cancelled or expires (30-minute TTL). Cleanup is lazy — the pay, cancel, and listing-access paths all check for expired pending orders.
- The 30-minute expiry uses database-side `now()` to avoid clock-skew issues between the API server and the database.

### Refunds

- Full refund only. The buyer initiates via `POST /orders/:id/refund`. The platform absorbs the Stripe processing fee. `refunded` is terminal.

### Disputes

- Detected via webhook (`charge.dispute.created`). The order transitions to `disputed` and stores `preDisputeStatus`. If the dispute is won (`charge.dispute.closed` + won), the order reverts to `preDisputeStatus`. If lost, the order transitions to `refunded`.

### Seller Onboarding

- Sellers must complete Stripe Connect onboarding before creating their first listing. `POST /seller/onboard` creates a Stripe Express connected account and returns an account link URL. `GET /seller/onboard/status` returns `onboarded`, `chargesEnabled`, and `payoutsEnabled`. `POST /listings` checks that the seller has completed onboarding (charges enabled) before allowing creation.

### Transfer to Seller

- Executed at `completed` (buyer confirms delivery). The transfer amount is the pre-calculated `sellerPayout`. If the transfer fails, the `completed` transition is rejected (returns 502), keeping the order in `delivered` for manual resolution.

### Webhook

- Single endpoint: `POST /api/v1/webhooks/stripe`. Events handled: `payment_intent.succeeded` (safety net for payment confirmation), `payment_intent.payment_failed` (logged), `charge.dispute.created`, `charge.dispute.closed`, `account.updated`. Signature verified via `STRIPE_WEBHOOK_SECRET`.
- Idempotency: the state machine validation acts as the guard — replaying an already-processed event produces an invalid transition, which is logged and 200'd. Pending orders are checked for expiry before webhook processing.

### Search

- PostgreSQL full-text search using `to_tsvector('english', ...)` on title and description concatenated
- Query uses `plainto_tsquery` for user-friendly search input
- Combined with optional category and price range filters
- All list endpoints return `{ data: T[], pagination: { page, limit, total, totalPages } }`

### Error Handling

- Card declines: `402 Payment Required`, code `PAYMENT_FAILED`, message includes decline reason
- Stripe API errors: `502 Bad Gateway`, code `PAYMENT_SERVICE_UNAVAILABLE`
- Transfer failures: `502 Bad Gateway`, code `TRANSFER_FAILED`
- Raw Stripe errors logged (including `stripeRequestId`, `stripeStatusCode`, `stripeType`), never returned to client
- A thin error-mapping function in the payments feature converts `StripeError` to `AppError`

### Configuration

- `.env` file loaded via dotenv at startup
- Environment variables validated against a Zod schema; app crashes on startup if required vars are missing
- Typed config object (`config.database.url`, not `process.env.DATABASE_URL`) used everywhere
- Required vars: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

### Module Structure

- **`features/auth/`** — Registration, login, token refresh, profile
- **`features/listings/`** — CRUD, search, seller dashboard. Includes Stripe onboarding check on create.
- **`features/orders/`** — Order creation, pay/cancel/complete/refund, state machine, commission calculation, expiry/lazy cleanup, Stripe transfer execution. This is the deep module: it encapsulates all Stripe interaction behind async functions.
- **`features/payments/`** — Stripe client singleton, decimal ↔ cents conversion, error mapping (infrastructure, consumed by other modules)
- **`features/seller/`** — Stripe Connect Express onboarding routes and service
- **`features/webhooks/`** — Stripe webhook receiver and event dispatch (signature verification, idempotent handling)

## Testing Decisions

- **Strategy**: integration tests only — supertest against the full Express app with a real PostgreSQL test database and Stripe test mode (`sk_test_*` keys)
- **What makes a good test**: every test exercises the full request-response lifecycle (route → middleware → service → DB → response). Tests verify HTTP status codes, response body shapes, state changes, and error codes. Tests do not inspect implementation details.
- **Test organization**: one test file per feature domain — auth, listings, orders, payments, webhooks. Shared test helper manages DB lifecycle (schema drop/recreate via migrations, data cleanup between tests).
- **Test DB setup**: drops and recreates the public schema + drizzle migration tracking before the first test suite runs. Each test resets all table data.
- **Vitest**: `pool: "forks"` with `singleFork: true` to avoid parallel test interference on the shared test database.
- **Stripe test cards**: `4242 4242 4242 4242` for success, `4000 0000 0000 0002` for decline. Webhook tests use `stripe.webhooks.generateTestHeaderString()`.

## Out of Scope

- Email notifications via Resend or any email provider
- Background job processing via pg-boss (lazy expiry cleanup suffices for current scale)
- S3 presigned URL image uploads
- Shipping carrier integration (EasyPost, Shippo)
- Partial refunds (full refund only)
- Partial disputes or dispute evidence submission via API
- ACH / bank transfer payment methods (cards only)
- Automatic retry of failed transfers (manual resolution)
- Stripe tax calculation or Stripe shipping rates
- Seller dashboard for viewing their Stripe balance or transfer history
- Idempotent event store for webhook events (state machine validation is sufficient)
- Stripe Connect onboarding via OAuth (account links only)
- OAuth / social login
- Role-based access beyond buyer/seller contextual checks
- In-app notifications or real-time updates (WebSockets/SSE)
- Deployment infrastructure (Railway/Render configuration)

## Further Notes

- All decimal amounts are returned as strings from the API to preserve precision. Clients should parse with a decimal-aware library.
- Stripe amounts (in cents) are converted to/from decimal strings at the boundary of the payments feature (`amount-utils.ts`).
- The `listings.status` field is a varchar with values `active`, `reserved`, and `sold`. Only active listings appear in public search. This was chosen over a PostgreSQL enum to keep the schema flexible.
- The `orders.status` field is a PostgreSQL enum, unlike listings.status, because the order state machine is more rigid and well-defined.
- The full-text search GIN index uses raw SQL in the Drizzle schema definition since Drizzle's index builder doesn't natively support expression-based GIN indexes.
- The Swagger UI route at `/api/docs` is intentionally placed before the global rate limiter in the Express middleware stack to avoid rate-limiting documentation consumers.
- Stripe webhook signatures require the raw request body as a buffer. The webhook route uses `express.raw({ type: "application/json" })` rather than `express.json()`.
- The state machine is the idempotency guard for webhook replays. If an event would cause an invalid transition, it's logged and 200'd.
- The reservation TTL (30 minutes) uses database-side `now()` for expiry checks to avoid clock-skew between the API server and the database.
- The PaymentIntent's `clientSecret` is stored in the database so the frontend can re-mount the Stripe PaymentElement after a page refresh on pending orders.
- Listing responses include `sellerName` via a JOIN with the users table. Order list responses include `listingTitle` and `listingImage` from the related listing.
