# Marketplace API

A RESTful API for a two-sided marketplace where buyers and sellers transact physical goods. Built with Express, TypeScript, and PostgreSQL (Drizzle ORM). Features JWT authentication, a structured order state machine, Stripe payment processing with Connect Express payouts, full-text search, 10% platform commission, and an OpenAPI 3.0 spec served via Swagger UI.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up your environment
cp .env.example .env
# Fill in DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET

# 3. Run migrations
npm run db:migrate

# 4. Start the dev server
npm run dev
```

The API runs at `http://localhost:8080`. API docs are at `http://localhost:8080/api/docs`.

## API Endpoints

### Auth
- `POST /api/v1/auth/register` — Register a new user
- `POST /api/v1/auth/login` — Log in, receive access + refresh tokens
- `POST /api/v1/auth/refresh` — Refresh an expired access token
- `GET /api/v1/auth/me` — Get the authenticated user's profile

### Listings
- `POST /api/v1/listings` — Create a listing (auth required, seller must have completed Stripe onboarding)
- `GET /api/v1/listings` — Browse active listings (paginated, filterable by category, price range, keyword search). Includes seller name.
- `GET /api/v1/listings/mine` — List your own listings, active and sold (paginated)
- `GET /api/v1/listings/:id` — Get listing details with seller name. Lazy-releases expired reservations.
- `PATCH /api/v1/listings/:id` — Update your listing (seller only)
- `DELETE /api/v1/listings/:id` — Delete your listing (seller only)

### Orders
- `POST /api/v1/orders` — Place an order on a listing (buyer only, cannot buy own listing). Creates a Stripe PaymentIntent and reserves the listing. Returns `clientSecret` for frontend payment confirmation.
- `POST /api/v1/orders/:id/pay` — Pay for an order (buyer only). Confirms the Stripe PaymentIntent. Idempotent: returns the order as-is if already paid.
- `POST /api/v1/orders/:id/cancel` — Cancel an order (buyer only, only from `pending`). Cancels the Stripe PaymentIntent and releases the listing back to `active`.
- `POST /api/v1/orders/:id/complete` — Mark an order as received (buyer only). Creates a Stripe transfer to the seller's Connect account before transitioning to `completed`. If the transfer fails, the order stays in `delivered` with a 502.
- `POST /api/v1/orders/:id/refund` — Request a full refund (buyer only). Creates a Stripe refund and transitions to `refunded`.
- `GET /api/v1/orders/buyer/purchases` — View your purchase history (paginated, status filter). Includes listing title and first image.
- `GET /api/v1/orders/seller/sales` — View your sales history (paginated, status filter). Includes listing title and first image.
- `GET /api/v1/orders/:id` — Get a single order (buyer or seller only). Returns stored `clientSecret` for pending orders.
- `PATCH /api/v1/orders/:id/status` — Transition order status. Only accepts `shipped` and `delivered`; `paid`/`cancelled`/`refunded`/`completed` have been moved to dedicated endpoints.

### Seller
- `POST /api/v1/seller/onboard` — Start or resume Stripe Connect Express onboarding. Returns an account link URL.
- `GET /api/v1/seller/onboard/status` — Check onboarding status (`onboarded`, `chargesEnabled`, `payoutsEnabled`)

### Webhooks
- `POST /api/v1/webhooks/stripe` — Stripe webhook receiver. Handles `payment_intent.succeeded`, `charge.dispute.created`, `charge.dispute.closed`, `account.updated`, and `payment_intent.payment_failed`. Idempotent: replaying an already-processed event is a no-op.

### General
- `GET /api/health` — Health check
- `GET /api/docs` — Swagger UI
- `GET /api/docs.json` — Raw OpenAPI spec

## Order State Machine

```
                     ┌─────────────────────────────┐
                     │          disputed           │
                     │  (stores preDisputeStatus)  │
                     └──────┬──────────────┬───────┘
              (won)  ◄──────┘              └──────►  (lost)
            reverts to                              moves to
         preDisputeStatus                           refunded
                 ▲                                      │
                 │                                      ▼
pending ──► paid ──► shipped ──► delivered ──► completed
   │          │         │            │
   │          │         │            │
   ├──► cancelled        │            │
   │          │         │            │
   └──► expired         └────┬───────┘
                              ▼
                          refunded
```

**Transitions by role:**

| Transition | Role | Notes |
|---|---|---|
| `pending → paid` | buyer | Confirms PaymentIntent. Has webhook safety net. |
| `pending → cancelled` | buyer | Cancels PaymentIntent, releases listing. |
| `pending → expired` | system | Lazy: checked on pay, cancel, listing access, webhook. 30-min TTL using DB-side `now()`. |
| `paid → shipped` | seller | |
| `paid → refunded` | buyer | Full refund via Stripe. Platform absorbs fee. |
| `shipped → delivered` | seller | |
| `shipped → refunded` | buyer | Full refund via Stripe. |
| `delivered → completed` | buyer | Creates Stripe transfer to seller. Fails with 502 if transfer errors. |
| `delivered → refunded` | buyer | Full refund via Stripe. |
| `* → disputed` | webhook | Triggered by `charge.dispute.created`. Saves `preDisputeStatus`. |
| `disputed → <prev>` | webhook | On dispute won. Reverts to `preDisputeStatus`. |
| `disputed → refunded` | webhook | On dispute lost. |

Terminal states: `completed`, `cancelled`, `expired`, `refunded`.

## Payments

Stripe is the payment provider using the **separate charges and transfers** model. The platform charges the buyer's card, holds funds in the platform's Stripe balance, and transfers the seller's payout on order completion.

### Payment flow
On order creation, a [PaymentIntent](https://docs.stripe.com/api/payment_intents) is created and its `client_secret` is returned to the buyer for client-side confirmation (via Stripe.js). The `clientSecret` is stored in the database so the frontend can re-mount the Stripe PaymentElement after a page refresh. The buyer then calls `POST /orders/:id/pay` to confirm server-side.

### Seller payouts
Sellers use [Stripe Connect Express](https://docs.stripe.com/connect) accounts. Sellers must complete onboarding before creating listings (`POST /api/v1/seller/onboard`). Onboarding is checked at listing creation time (charges must be enabled). When the buyer completes an order, a [transfer](https://docs.stripe.com/api/transfers) sends the seller's payout (`total - 10% platform fee`) to their Connect account. If the transfer fails, the order stays in `delivered` for manual resolution.

### Webhooks
Webhooks serve as a safety net for async Stripe events:
- `payment_intent.succeeded` — Marks the order as paid if the synchronous flow missed it. Guards against stale (expired) orders.
- `charge.dispute.created` — Moves the order to `disputed`, saving the previous status.
- `charge.dispute.closed` — Reverts to the previous status (won) or moves to `refunded` (lost).
- `account.updated` — Logged for observability.
- `payment_intent.payment_failed` — Logged for observability.

Webhook handlers are idempotent: replaying an already-processed event produces an invalid state transition, which is logged and acknowledged with 200.

### Commission
10% platform fee on the listing subtotal: `platformFee = round(subtotal × 0.10, 2)`. The platform retains this by transferring only `sellerPayout = total - platformFee` to the seller. All amounts are decimal strings in API responses; Stripe amounts (cents) are converted at the payments boundary.

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled JS |
| `npm run db:generate` | Generate Drizzle migrations from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:push` | Push schema directly (dev only) |
| `npm test` | Run integration tests |
| `npm run test:watch` | Run tests in watch mode |

## Stack

- **Runtime**: Node.js, Express 4, TypeScript (strict mode)
- **Database**: PostgreSQL with Drizzle ORM + Drizzle Kit migrations
- **Payments**: Stripe (PaymentIntents, Transfers, Refunds, Connect Express accounts)
- **Auth**: bcrypt (cost 12) + JWT (15min access / 7 day refresh tokens)
- **Validation**: Zod (shared across request validation, DB types, and OpenAPI schema gen)
- **Security**: helmet, CORS, express-rate-limit
- **Logging**: Pino (structured JSON)
- **Docs**: OpenAPI 3.0 / Swagger UI
- **Tests**: Vitest + Supertest (integration tests against real DB and Stripe test mode)

## Project Structure

```
src/
├── app.ts              # Express app factory
├── main.ts             # Entry point
├── test-setup.ts       # Test environment setup
├── db/
│   ├── schema.ts       # Drizzle schema (users, listings, orders)
│   ├── index.ts        # DB connection
│   ├── migrate.ts      # Migration runner
│   └── migrations/     # SQL migrations
├── features/
│   ├── auth/
│   │   ├── auth.routes.ts    # Route handlers
│   │   ├── auth.schemas.ts   # Zod schemas + OpenAPI
│   │   ├── auth.service.ts   # Business logic
│   │   └── openapi.ts        # Co-located OpenAPI paths
│   ├── listings/
│   │   ├── listings.routes.ts
│   │   ├── listings.schemas.ts
│   │   ├── listings.service.ts
│   │   └── openapi.ts
│   ├── orders/
│   │   ├── orders.routes.ts
│   │   ├── orders.schemas.ts
│   │   ├── orders.service.ts
│   │   ├── state-machine.ts  # Order lifecycle state machine
│   │   ├── commission.ts     # 10% platform fee calculation
│   │   ├── complete-order.ts # Completion + Stripe transfer
│   │   ├── expiry.ts         # Pending order expiry (30 min, lazy cleanup)
│   │   ├── openapi.ts
│   │   └── __tests__/
│   ├── payments/
│   │   ├── stripe-client.ts  # Stripe SDK instance
│   │   ├── amount-utils.ts   # Decimal ↔ cents conversion
│   │   ├── error-mapping.ts  # Stripe error → AppError
│   │   └── __tests__/
│   ├── seller/
│   │   ├── seller.routes.ts  # Seller onboarding routes
│   │   ├── seller.service.ts # Stripe Connect onboarding
│   │   └── openapi.ts
│   └── webhooks/
│       ├── webhooks.routes.ts # Stripe webhook receiver
│       ├── webhooks.service.ts # Webhook event handling
│       └── openapi.ts
├── shared/
│   ├── config.ts       # Env var validation (Zod, crashes on missing vars)
│   ├── errors.ts       # Custom error classes (AppError, NotFoundError, etc.)
│   ├── guards.ts       # Ownership verification guards
│   ├── logger.ts       # Pino logger
│   ├── openapi.ts      # OpenAPI spec builder
│   ├── pagination.ts   # Shared paginate helper
│   ├── middleware/
│   │   ├── async-handler.ts  # Async error boundary
│   │   ├── auth.ts           # JWT auth middleware
│   │   ├── error-handler.ts  # Global error handler
│   │   └── validate.ts       # Zod request validation
│   └── __tests__/
└── __tests__/          # Feature integration tests
```

## Environment Variables

### Required

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing access tokens (min 32 chars) |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens (min 32 chars) |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_...`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_...`) |

### Optional

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Server port |
| `NODE_ENV` | `development` | Environment (`development`, `production`, `test`) |
| `BASE_URL` | `http://localhost:8080` | Public base URL for Stripe Connect redirects |
| `FRONTEND_URL` | `http://localhost:3000` | Frontend URL for CORS / Stripe Connect return |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | Access token expiration |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Refresh token expiration |
