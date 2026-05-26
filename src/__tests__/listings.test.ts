import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { setupDb, cleanDb, closeDb, getApp } from "./helpers.js";

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

  // Create a seller user for tests
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ email: "seller@example.com", password: "password123", name: "Seller" });
  sellerToken = res.body.accessToken;
  sellerId = res.body.user.id;
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
