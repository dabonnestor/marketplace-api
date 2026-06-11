import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { setupDb, cleanDb, closeDb, getApp, getDb } from "./helpers.js";
import { orders } from "../db/schema.js";
import { sql } from "drizzle-orm";

const { mockAccountRetrieve } = vi.hoisted(() => ({
  mockAccountRetrieve: vi.fn().mockResolvedValue({
    id: "acct_test123",
    charges_enabled: true,
    payouts_enabled: true,
  }),
}));

vi.mock("../shared/payments/stripe-client.js", () => ({
  stripe: {
    accounts: {
      create: vi.fn().mockResolvedValue({ id: "acct_test123" }),
      retrieve: mockAccountRetrieve,
    },
    accountLinks: {
      create: vi.fn().mockResolvedValue({ url: "https://connect.stripe.com/setup/test" }),
    },
    paymentIntents: {
      create: vi.fn().mockResolvedValue({
        id: "pi_test123",
        client_secret: "pi_test123_secret_test",
      }),
    },
  },
}));

const app = getApp();

let sellerToken: string;
let sellerId: string;

beforeAll(async () => {
  await setupDb();
});

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await cleanDb();

  // Create a seller user and onboard them
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ email: "seller@example.com", password: "password123", name: "Seller" });
  sellerToken = res.body.accessToken;
  sellerId = res.body.user.id;

  // Onboard the seller (so they can create listings)
  await request(app)
    .post("/api/v1/seller/onboard")
    .set("Authorization", `Bearer ${sellerToken}`);
});

describe("POST /api/v1/listings", () => {
  it("creates a listing", async () => {
    const res = await request(app)
      .post("/api/v1/listings")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        title: "Vintage Camera",
        description: "A beautiful vintage camera in great condition",
        price: 150,
        category: "Electronics",
        condition: "Used - Good",
        shippingCost: 10,
      });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Vintage Camera");
    expect(res.body.price).toBe("150.00");
    expect(res.body.sellerId).toBe(sellerId);
  });

  it("requires auth", async () => {
    const res = await request(app)
      .post("/api/v1/listings")
      .send({ title: "Test", description: "Test", price: 10, category: "Test", condition: "New" });

    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/listings", () => {
  it("returns paginated listings", async () => {
    await request(app)
      .post("/api/v1/listings")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ title: "Item 1", description: "First item", price: 10, category: "Books", condition: "New" });

    await request(app)
      .post("/api/v1/listings")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ title: "Item 2", description: "Second item", price: 20, category: "Books", condition: "New" });

    const res = await request(app).get("/api/v1/listings");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.total).toBe(2);
  });

  it("filters by category", async () => {
    await request(app)
      .post("/api/v1/listings")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ title: "Book", description: "A good read", price: 10, category: "Books", condition: "New" });

    await request(app)
      .post("/api/v1/listings")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ title: "Laptop", description: "Fast laptop", price: 500, category: "Electronics", condition: "New" });

    const res = await request(app).get("/api/v1/listings?category=Books");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe("Book");
  });

  it("searches by keyword matching title and description", async () => {
    await request(app)
      .post("/api/v1/listings")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        title: "Vintage Leather Jacket",
        description: "Worn by a rockstar on tour",
        price: 200,
        category: "Clothing",
        condition: "Used",
      });

    await request(app)
      .post("/api/v1/listings")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        title: "Denim Shorts",
        description: "Vintage style with leather trim",
        price: 45,
        category: "Clothing",
        condition: "Used",
      });

    const res = await request(app).get("/api/v1/listings?search=vintage");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it("returns empty array when no listings match", async () => {
    const res = await request(app).get("/api/v1/listings?search=nonexistentxyz");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });

  it("filters by price range", async () => {
    await request(app)
      .post("/api/v1/listings")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ title: "Cheap Item", description: "x", price: 10, category: "Misc", condition: "New" });

    await request(app)
      .post("/api/v1/listings")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ title: "Expensive Item", description: "x", price: 1000, category: "Misc", condition: "New" });

    const res = await request(app).get("/api/v1/listings?minPrice=100&maxPrice=2000");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe("Expensive Item");
  });
});

describe("GET /api/v1/listings/:id", () => {
  it("returns a single listing", async () => {
    const create = await request(app)
      .post("/api/v1/listings")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ title: "Test Item", description: "Description", price: 25, category: "Books", condition: "New" });

    const res = await request(app).get(`/api/v1/listings/${create.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Test Item");
  });

  it("returns 404 for missing listing", async () => {
    const res = await request(app).get("/api/v1/listings/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  it("releases a reserved listing when its pending order has expired", async () => {
    const create = await request(app)
      .post("/api/v1/listings")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ title: "Expire Test", description: "Test", price: 50, category: "Books", condition: "New" });
    const listingId = create.body.id;

    // Buyer creates an order
    const buyerRes = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "expbuyer@example.com", password: "password123", name: "Expiry Buyer" });

    const orderRes = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerRes.body.accessToken}`)
      .send({ listingId });
    expect(orderRes.status).toBe(201);

    // Backdate order to >30 minutes ago
    const EXPIRY_MINUTES = 30;
    const expiredDate = new Date(Date.now() - (EXPIRY_MINUTES + 1) * 60 * 1000);
    const db = getDb();
    await db
      .update(orders)
      .set({ createdAt: expiredDate })
      .where(sql`id = ${orderRes.body.id}`);

    // Fetching the listing should release it
    const get = await request(app).get(`/api/v1/listings/${listingId}`);
    expect(get.status).toBe(200);
    expect(get.body.status).toBe("active");
  });
});

describe("PATCH /api/v1/listings/:id", () => {
  it("updates a listing", async () => {
    const create = await request(app)
      .post("/api/v1/listings")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ title: "Old Title", description: "Description", price: 25, category: "Books", condition: "New" });

    const res = await request(app)
      .patch(`/api/v1/listings/${create.body.id}`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ title: "New Title" });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("New Title");
  });

  it("rejects non-owner update with 403", async () => {
    const create = await request(app)
      .post("/api/v1/listings")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ title: "My Item", description: "Description", price: 25, category: "Books", condition: "New" });

    // Register a different user
    const other = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "other@example.com", password: "password123", name: "Other User" });

    const res = await request(app)
      .patch(`/api/v1/listings/${create.body.id}`)
      .set("Authorization", `Bearer ${other.body.accessToken}`)
      .send({ title: "Stolen" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});

describe("GET /api/v1/listings/mine", () => {
  it("returns authenticated seller's listings with pagination", async () => {
    await request(app)
      .post("/api/v1/listings")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ title: "My Item 1", description: "First", price: 10, category: "Books", condition: "New" });

    await request(app)
      .post("/api/v1/listings")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ title: "My Item 2", description: "Second", price: 20, category: "Electronics", condition: "New" });

    const res = await request(app)
      .get("/api/v1/listings/mine")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(20);
  });

  it("requires auth", async () => {
    const res = await request(app).get("/api/v1/listings/mine");
    expect(res.status).toBe(401);
  });

  it("only returns the authenticated seller's listings", async () => {
    // Create listing as seller
    await request(app)
      .post("/api/v1/listings")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ title: "Seller Item", description: "Mine", price: 10, category: "Books", condition: "New" });

    // Register a different seller and create their listing
    const other = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "other@example.com", password: "password123", name: "Other Seller" });

    await request(app)
      .post("/api/v1/listings")
      .set("Authorization", `Bearer ${other.body.accessToken}`)
      .send({ title: "Other Item", description: "Theirs", price: 20, category: "Books", condition: "New" });

    const res = await request(app)
      .get("/api/v1/listings/mine")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe("Seller Item");
  });

  it("includes reserved listings", async () => {
    // Create a listing
    const create = await request(app)
      .post("/api/v1/listings")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ title: "For Sale", description: "Buy me", price: 50, category: "Books", condition: "New" });

    // Mark it as reserved via a buyer purchasing it
    const buyer = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "buyer@example.com", password: "password123", name: "Buyer" });

    await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyer.body.accessToken}`)
      .send({ listingId: create.body.id });

    const res = await request(app)
      .get("/api/v1/listings/mine")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe("reserved");
  });
});

describe("onboarding guard", () => {
  it("blocks listing creation when seller is not onboarded", async () => {
    // Register a new seller who has NOT been onboarded
    const notOnboarded = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "newbie@example.com", password: "password123", name: "New Seller" });

    const res = await request(app)
      .post("/api/v1/listings")
      .set("Authorization", `Bearer ${notOnboarded.body.accessToken}`)
      .send({ title: "Blocked", description: "Should fail", price: 10, category: "Books", condition: "New" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("ONBOARDING_REQUIRED");
  });

  it("allows listing creation after onboarding", async () => {
    // Register and onboard a seller
    const register = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "ready@example.com", password: "password123", name: "Ready Seller" });
    const token = `Bearer ${register.body.accessToken}`;

    await request(app)
      .post("/api/v1/seller/onboard")
      .set("Authorization", token);

    const res = await request(app)
      .post("/api/v1/listings")
      .set("Authorization", token)
      .send({ title: "Allowed", description: "Should work", price: 10, category: "Books", condition: "New" });

    expect(res.status).toBe(201);
  });
});

describe("DELETE /api/v1/listings/:id", () => {
  it("deletes a listing", async () => {
    const create = await request(app)
      .post("/api/v1/listings")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ title: "Delete Me", description: "Description", price: 25, category: "Books", condition: "New" });

    const res = await request(app)
      .delete(`/api/v1/listings/${create.body.id}`)
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.status).toBe(204);

    const get = await request(app).get(`/api/v1/listings/${create.body.id}`);
    expect(get.status).toBe(404);
  });

  it("rejects non-owner delete with 403", async () => {
    const create = await request(app)
      .post("/api/v1/listings")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ title: "My Item", description: "Description", price: 25, category: "Books", condition: "New" });

    // Register a different user
    const other = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "other2@example.com", password: "password123", name: "Other User" });

    const res = await request(app)
      .delete(`/api/v1/listings/${create.body.id}`)
      .set("Authorization", `Bearer ${other.body.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});
