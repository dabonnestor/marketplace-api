# Marketplace API

A RESTful API for a two-sided marketplace where buyers and sellers transact physical goods. Built with Express, TypeScript, and PostgreSQL (Drizzle ORM). Features JWT authentication, a structured order state machine, full-text search, 10% platform commission, and an OpenAPI 3.0 spec served via Swagger UI.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up your PostgreSQL database and configure environment variables
cp .env.example .env
# Fill in DATABASE_URL, JWT_SECRET, etc.

# 3. Run migrations
npm run db:migrate

# 4. Start the dev server
npm run dev
```

The API runs at `http://localhost:3000`. API docs are at `http://localhost:3000/api/docs`.

## API Endpoints

### Auth
- `POST /api/v1/auth/register` — Register a new user
- `POST /api/v1/auth/login` — Log in, receive access + refresh tokens
- `POST /api/v1/auth/refresh` — Refresh an expired access token

### Listings
- `POST /api/v1/listings` — Create a listing (auth required)
- `GET /api/v1/listings` — Browse active listings (paginated, filterable by category, price range, keyword search)
- `GET /api/v1/listings/:id` — Get listing details
- `PUT /api/v1/listings/:id` — Update your listing (seller only)
- `DELETE /api/v1/listings/:id` — Delete your listing (seller only)

### Orders
- `POST /api/v1/orders` — Place an order on a listing (buyer only, cannot buy own listing)
- `PATCH /api/v1/orders/:id/pay` — Mark order as paid (buyer only)
- `PATCH /api/v1/orders/:id/ship` — Mark order as shipped (seller only)
- `PATCH /api/v1/orders/:id/deliver` — Mark order as delivered (seller only)
- `PATCH /api/v1/orders/:id/complete` — Confirm delivery and finalize (buyer only)
- `GET /api/v1/orders/purchases` — View your purchase history (buyer, paginated, status filter)
- `GET /api/v1/orders/sales` — View your sales history (seller, paginated, status filter)

### General
- `GET /api/health` — Health check
- `GET /api/docs` — Swagger UI
- `GET /api/docs.json` — Raw OpenAPI spec

## Order State Machine

```
pending → paid → shipped → delivered → completed
```

Status transitions are role-gated (e.g., only the buyer can mark paid, only the seller can mark shipped) and validated — invalid jumps (e.g., pending → delivered) are rejected. Once an order is `completed`, it is immutable.

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
├── db/
│   ├── schema.ts       # Drizzle schema (users, listings, orders)
│   ├── index.ts        # DB connection
│   ├── migrate.ts      # Migration runner
│   └── migrations/     # SQL migrations
├── features/
│   ├── auth/           # Register, login, refresh
│   ├── listings/       # CRUD + search/filter
│   ├── orders/         # Create + state machine transitions
│   └── users/
├── shared/
│   ├── config.ts       # Env var validation
│   ├── errors.ts       # Custom error classes
│   ├── logger.ts       # Pino logger
│   ├── openapi.ts      # OpenAPI spec builder
│   └── middleware/      # Auth guard, validation, error handler
└── __tests__/          # Integration tests
```

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing access tokens |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens |
| `PORT` | Server port (default: 3000) |
