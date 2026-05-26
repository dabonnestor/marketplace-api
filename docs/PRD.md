# PRD: Two-Sided Marketplace API

## Problem Statement

The user needs a backend API for a two-sided marketplace where buyers and sellers transact physical goods. The platform holds payments via Stripe Connect, takes a flat commission, and enforces a structured order lifecycle. The API must be secure, testable, well-documented, and built on a stack that balances developer velocity with production readiness.

## Solution

A RESTful Express API written in TypeScript with PostgreSQL as the database. Users have a single account that supports both buying and selling. Sellers create listings, buyers place orders, and orders progress through a state machine from pending through to completed. The platform takes a 10% commission on each transaction. Full-text search on listings is handled via PostgreSQL tsvector. Authentication uses email/password with bcrypt-hashed passwords and JWT access + refresh tokens. The API is documented via OpenAPI 3.0 with Swagger UI.

## User Stories

1. As a new user, I want to register with my email, name, and password, so that I can start buying and selling.
2. As a registered user, I want to log in and receive access tokens, so that I can make authenticated requests.
3. As a logged-in user, I want to refresh my access token with a long-lived refresh token, so that I don't have to log in again when my session expires.
4. As a logged-in user, I want to view my profile, so that I can confirm my identity.
5. As a seller, I want to create a listing with a title, description, price, category, condition, shipping cost, and images, so that buyers can discover my item.
6. As a seller, I want to update any field of my listing, so that I can correct mistakes or change pricing.
7. As a seller, I want to delete my listing, so that it is no longer visible to buyers.
8. As a buyer, I want to browse active listings with pagination, so that I can discover items without overwhelming page loads.
9. As a buyer, I want to filter listings by category, so that I can narrow my search to relevant items.
10. As a buyer, I want to filter listings by price range, so that I can find items within my budget.
11. As a buyer, I want to search listings by keyword matching on title and description, so that I can find specific items quickly.
12. As a buyer, I want to view the full details of a single listing, so that I can make an informed purchase decision.
13. As a buyer, I want to place an order on a listing, so that I can purchase an item.
14. As a buyer, I want the platform to prevent me from buying my own listing, so that obvious errors are caught before checkout.
15. As a buyer, I want to see the platform fee and total at order creation time, so that I know exactly what I'm paying.
16. As a seller, I want to see my expected payout (total minus platform fee) at order creation time, so that I know what I'll earn.
17. As a buyer, I want to mark an order as paid, so that the seller knows they can ship the item.
18. As a seller, I want to mark an order as shipped, so that the buyer knows the item is on the way.
19. As a seller, I want to mark an order as delivered, so that the buyer knows the item has arrived.
20. As a buyer, I want to confirm delivery and mark the order as completed, so that the transaction is finalized.
21. As a participant in an order, I want invalid status transitions to be rejected, so that order state stays consistent (e.g., pending cannot jump to delivered).
22. As a participant in an order, I want unauthorized role transitions to be rejected, so that only the buyer can mark paid and only the seller can mark shipped.
23. As a completed order participant, I want further status changes to be rejected, so that finalized orders stay finalized.
24. As a buyer, I want to view all my purchases with pagination and optional status filtering, so that I can track my order history.
25. As a seller, I want to view all my sales with pagination and optional status filtering, so that I can manage my fulfillment pipeline.
26. As an API consumer, I want a health check endpoint, so that I can monitor service availability.
27. As a developer integrating with the API, I want an OpenAPI spec served at a documentation endpoint, so that I can explore and test the API interactively.
28. As an operator, I want structured JSON logs for every request and error, so that I can monitor and debug the service in production.
29. As a developer, I want integration tests covering the full request-response lifecycle, so that I can refactor with confidence.
30. As an operator, I want the app to refuse to start if required environment variables are missing, so that misconfiguration is caught immediately rather than at runtime.

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
- **Security**: Helmet (with CSP relaxed for Swagger UI inline scripts), CORS, express-rate-limit (100 req/15min global, 20 req/15min on auth endpoints), 1MB request body limit.

### Database Schema
- **users**: `id` (uuid PK, default random), `email` (unique, varchar 255), `password_hash` (varchar 255), `name` (varchar 255), `created_at`, `updated_at`
- **listings**: `id` (uuid PK), `seller_id` (FK → users), `title`, `description`, `price` (decimal 12,2), `category`, `condition`, `shipping_cost` (decimal 10,2), `images` (text array), `status` (varchar, default "active"), timestamps. Indexes on seller_id, category, status. GIN index on tsvector of title + description for full-text search.
- **orders**: `id` (uuid PK), `buyer_id` (FK → users), `seller_id` (FK → users), `listing_id` (FK → listings), `status` (enum: pending, paid, shipped, delivered, completed, disputed, cancelled), `subtotal`, `shipping_cost`, `platform_fee`, `total`, `seller_payout` (all decimals), `paid_at`, `shipped_at`, `delivered_at`, `completed_at` (timestamps). Indexes on buyer_id, seller_id, status.
- **User model**: single account, dual role. No separate buyer/seller tables. The user simply performs whichever role is appropriate for the action.

### Order State Machine
Transitions (from prototype):

```
pending    → paid, cancelled
paid       → shipped, disputed, cancelled
shipped    → delivered, disputed
delivered  → completed, disputed
completed  → (terminal)
disputed   → cancelled
cancelled  → (terminal)
```

- Only the buyer can transition to `paid` or `completed`
- Only the seller can transition to `shipped` or `delivered`
- Transitions are validated before execution; invalid transitions return a 400 with code `INVALID_TRANSITION`
- Timestamp fields (`paid_at`, `shipped_at`, etc.) are set automatically on the corresponding transition

### Commission
- Flat 10% platform fee calculated on the listing subtotal at order creation
- `platformFee = round(subtotal * 0.10, 2)`
- `total = subtotal + shippingCost`
- `sellerPayout = total - platformFee`
- All monetary values stored as decimal strings in PostgreSQL

### Search
- PostgreSQL full-text search using `to_tsvector('english', ...)` on title and description concatenated
- Query uses `plainto_tsquery` for user-friendly search input
- Combined with optional category and price range filters
- All list endpoints return `{ data: T[], pagination: { page, limit, total, totalPages } }`

### Configuration
- `.env` file loaded via dotenv at startup
- Environment variables validated against a Zod schema; app crashes on startup if required vars are missing
- Typed config object (`config.database.url`, not `process.env.DATABASE_URL`) used everywhere
- Required vars: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`

## Testing Decisions

- **Strategy**: integration tests only — supertest against the full Express app with a real PostgreSQL test database
- **What makes a good test**: every test exercises the full request-response lifecycle (route → middleware → service → DB → response). No mocks, no stubs. Tests verify HTTP status codes, response body shapes, state changes, and error codes. Tests do not inspect implementation details (file structure, internal function calls).
- **Test organization**: one test file per feature domain — auth, listings, orders. Shared test helper (`helpers.ts`) manages DB lifecycle (schema drop/recreate via migrations, data cleanup between tests).
- **Test DB setup**: drops and recreates the public schema + drizzle migration tracking before the first test suite runs. Each test resets all table data.
- **Vitest**: `pool: "forks"` with `singleFork: true` to avoid parallel test interference on the shared test database.

## Out of Scope

- Stripe Connect integration (payment processing, fund holds, payouts)
- Email notifications via Resend or any email provider
- Background job processing via pg-boss
- S3 presigned URL image uploads
- Shipping carrier integration (EasyPost, Shippo)
- Seller onboarding/verification flows
- Returns, refunds, and dispute resolution flows beyond the basic `disputed` status
- In-app notifications or real-time updates (WebSockets/SSE)
- OAuth / social login
- Role-based access beyond buyer/seller contextual checks
- Rate limiting beyond the global/auth defaults
- Deployment infrastructure (Railway/Render configuration)

## Further Notes

- All decimal amounts are returned as strings from the API to preserve precision. Clients should parse with a decimal-aware library.
- The `listings.status` field is a varchar with values `active` and `sold`. Only active listings appear in public search. This was chosen over a PostgreSQL enum to keep the schema flexible as listing lifecycle states evolve.
- The `orders.status` field is a PostgreSQL enum, unlike listings.status, because the order state machine is more rigid and well-defined.
- The full-text search GIN index uses raw SQL in the Drizzle schema definition since Drizzle's index builder doesn't natively support expression-based GIN indexes.
- The Swagger UI route at `/api/docs` is intentionally placed before the global rate limiter in the Express middleware stack to avoid rate-limiting documentation consumers.
