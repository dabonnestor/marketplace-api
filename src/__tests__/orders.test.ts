import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { setupDb, cleanDb, closeDb, getApp } from "./helpers.js";

const app = getApp();

let buyerToken: string;
let buyerId: string;
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

  // Create buyer
  const buyerRes = await request(app)
    .post("/api/v1/auth/register")
    .send({ email: "buyer@example.com", password: "password123", name: "Buyer" });
  buyerToken = buyerRes.body.accessToken;
  buyerId = buyerRes.body.user.id;

  // Create seller
  const sellerRes = await request(app)
    .post("/api/v1/auth/register")
    .send({ email: "seller@example.com", password: "password123", name: "Seller" });
  sellerToken = sellerRes.body.accessToken;
  sellerId = sellerRes.body.user.id;
});

async function createListing() {
  const res = await request(app)
    .post("/api/v1/listings")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send({
      title: "Test Item",
      description: "A test item for ordering",
      price: 100,
      category: "Books",
      condition: "New",
      shippingCost: 5,
    });
  return res.body;
}

describe("POST /api/v1/orders", () => {
  it("creates an order from a listing", async () => {
    const listing = await createListing();

    const res = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    expect(res.body.buyerId).toBe(buyerId);
    expect(res.body.sellerId).toBe(sellerId);
    expect(res.body.subtotal).toBe("100");
    expect(res.body.shippingCost).toBe("5");
    expect(res.body.total).toBe("105");
    expect(res.body.platformFee).toBe("10"); // 10% of $100
    expect(res.body.sellerPayout).toBe("95"); // $105 - $10
  });

  it("prevents self-purchase", async () => {
    const listing = await createListing();

    const res = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ listingId: listing.id });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SELF_PURCHASE");
  });

  it("requires auth", async () => {
    const listing = await createListing();

    const res = await request(app)
      .post("/api/v1/orders")
      .send({ listingId: listing.id });

    expect(res.status).toBe(401);
  });
});

describe("Order state machine", () => {
  it("progresses through pending -> paid -> shipped -> delivered -> completed", async () => {
    const listing = await createListing();

    // Create order
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });
    const orderId = order.body.id;
    expect(order.body.status).toBe("pending");

    // Buyer marks as paid
    const paid = await request(app)
      .patch(`/api/v1/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ status: "paid" });
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe("paid");
    expect(paid.body.paidAt).toBeDefined();

    // Seller marks as shipped
    const shipped = await request(app)
      .patch(`/api/v1/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ status: "shipped" });
    expect(shipped.status).toBe(200);
    expect(shipped.body.status).toBe("shipped");

    // Seller marks as delivered
    const delivered = await request(app)
      .patch(`/api/v1/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ status: "delivered" });
    expect(delivered.status).toBe(200);
    expect(delivered.body.status).toBe("delivered");

    // Buyer confirms and completes
    const completed = await request(app)
      .patch(`/api/v1/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ status: "completed" });
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe("completed");
  });

  it("rejects invalid transitions", async () => {
    const listing = await createListing();

    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    // Can't jump from pending to delivered
    const res = await request(app)
      .patch(`/api/v1/orders/${order.body.id}/status`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ status: "delivered" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("rejects unauthorized role transitions", async () => {
    const listing = await createListing();

    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    // Seller can't mark as paid (only buyer can)
    const res = await request(app)
      .patch(`/api/v1/orders/${order.body.id}/status`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ status: "paid" });

    expect(res.status).toBe(403);
  });

  it("completed orders cannot be modified", async () => {
    const listing = await createListing();

    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });
    const id = order.body.id;

    // Progress to completed
    await request(app).patch(`/api/v1/orders/${id}/status`).set("Authorization", `Bearer ${buyerToken}`).send({ status: "paid" });
    await request(app).patch(`/api/v1/orders/${id}/status`).set("Authorization", `Bearer ${sellerToken}`).send({ status: "shipped" });
    await request(app).patch(`/api/v1/orders/${id}/status`).set("Authorization", `Bearer ${sellerToken}`).send({ status: "delivered" });
    await request(app).patch(`/api/v1/orders/${id}/status`).set("Authorization", `Bearer ${buyerToken}`).send({ status: "completed" });

    // Try to modify completed order
    const res = await request(app)
      .patch(`/api/v1/orders/${id}/status`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ status: "disputed" });

    expect(res.status).toBe(400);
  });
});

describe("GET buyer/seller order lists", () => {
  it("lists buyer purchases", async () => {
    const listing = await createListing();
    await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    const res = await request(app)
      .get("/api/v1/orders/buyer/purchases")
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("lists seller sales", async () => {
    const listing = await createListing();
    await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    const res = await request(app)
      .get("/api/v1/orders/seller/sales")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});
