# Marketplace API

A RESTful API for a two-sided marketplace where buyers and sellers transact physical goods. Built with Express, TypeScript, and PostgreSQL (Drizzle ORM). Features JWT authentication, a structured order state machine, Stripe payment processing, full-text search, 10% platform commission, and an OpenAPI 3.0 spec served via Swagger UI.

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
- `POST /api/v1/listings` — Create a listing (auth required)
- `GET /api/v1/listings` — Browse active listings (paginated, filterable by category, price range, keyword search)
- `GET /api/v1/listings/mine` — List your own listings, active and sold (seller, paginated)
- `GET /api/v1/listings/:id` — Get listing details
- `PATCH /api/v1/listings/:id` — Update your listing (seller only)
- `DELETE /api/v1/listings/:id` — Delete your listing (seller only)

### Orders
- `POST /api/v1/orders` — Place an order on a listing (buyer only, cannot buy own listing). Creates a Stripe PaymentIntent and reserves the listing.
- `POST /api/v1/orders/:id/pay` — Pay for an order (buyer only). Confirms the Stripe PaymentIntent.
- `POST /api/v1/orders/:id/cancel` — Cancel an order (buyer only). Cancels the Stripe PaymentIntent and releases the listing.
- `POST /api/v1/orders/:id/complete` — Mark an order as received (buyer only). Triggers a Stripe transfer to the seller.
- `POST /api/v1/orders/:id/refund` — Request a refund (buyer only). Creates a Stripe refund.
- `GET /api/v1/orders/buyer/purchases` — View your purchase history (buyer, paginated, status filter)
- `GET /api/v1/orders/seller/sales` — View your sales history (seller, paginated, status filter)
- `GET /api/v1/orders/:id` — Get a single order (buyer or seller only)
- `PATCH /api/v1/orders/:id/status` — Transition order status. The paid / cancelled / refunded / completed transitions have been moved to dedicated endpoints (above); this endpoint only accepts shipped and delivered.

### Seller
- `POST /api/v1/seller/onboard` — Start or resume Stripe Connect Express onboarding
- `GET /api/v1/seller/onboard/status` — Check onboarding status (charges_enabled, payouts_enabled)

### Webhooks
- `POST /api/v1/webhooks/stripe` — Stripe webhook receiver. Handles `payment_intent.succeeded`, `charge.dispute.created`, `charge.dispute.closed`, and `account.updated`.

### General
- `GET /api/health` — Health check
- `GET /api/docs` — Swagger UI
- `GET /api/docs.json` — Raw OpenAPI spec

## Order State Machine

```
                 ┌──────────────────────┐
                 │       disputed       │
                 └──┬───────────────┬───┘
     (dispute won) │               │ (dispute lost)
        ┌──────────┘               └──────────┐
        ▼                                     ▼
pending → paid → shipped → delivered → completed
   │       │       │          │
   │       │       │          ├──→ refunded
   │       │       └──────────┤
   │       └──────────────────┤
   │                          │
   ├──→ cancelled             │
   └──→ expired
```

- `pending` orders expire after 30 minutes (releases the listing back to active).
- The `disputed` state stores the previous status (`preDisputeStatus`). If the dispute is won, the order reverts; if lost, it moves to `refunded`.
- Terminal states: `completed`, `cancelled`, `expired`, `refunded`.

Transitions are role-gated (e.g., only the buyer can mark paid/cancel/complete/refund, only the seller can mark shipped/delivered). Webhook-driven transitions (payment confirmation, disputes) bypass role gating as asynchronous safety nets.

## Payments

Stripe is the payment provider. On order creation, a [PaymentIntent](https://docs.stripe.com/api/payment_intents) is created and its `client_secret` is returned to the buyer for client-side confirmation. The buyer then calls `POST /orders/:id/pay` to confirm server-side.

Seller payouts use [Stripe Connect Express](https://docs.stripe.com/connect) accounts. Sellers complete onboarding via `POST /api/v1/seller/onboard`. When the buyer completes an order, a [transfer](https://docs.stripe.com/api/transfers) sends the seller's payout (total — 10% platform fee) to their Connect account.

Webhooks serve as a safety net for async Stripe events:
- `payment_intent.succeeded` — Marks the order as paid if the synchronous flow missed it.
- `charge.dispute.created` — Moves the order to `disputed`, saving the previous status.
- `charge.dispute.closed` — Reverts to the previous status (won) or moves to `refunded` (lost).

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
- **Tests**: Vitest + Supertest

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
│   │   ├── expiry.ts         # Pending order expiry (30 min)
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
│   ├── config.ts       # Env var validation
│   ├── errors.ts       # Custom error classes
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

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing access tokens |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens |
| `STRIPE_SECRET_KEY` | Stripe secret key (sk_...) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (whsec_...) |
| `PORT` | Server port (default: 8080) |
| `BASE_URL` | Public base URL for Stripe Connect redirect URLs (default: http://localhost:8080) |
