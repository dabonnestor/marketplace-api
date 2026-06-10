import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { setupDb, cleanDb, closeDb, getApp, getDb } from "./helpers.js";
import { orders } from "../db/schema.js";
import { sql } from "drizzle-orm";
import Stripe from "stripe";

vi.mock("../features/payments/stripe-client.js", () => ({
  stripe: {
    accounts: {
      create: vi.fn().mockResolvedValue({ id: "acct_test123" }),
      retrieve: vi.fn().mockResolvedValue({
        id: "acct_test123",
        charges_enabled: true,
        payouts_enabled: true,
      }),
    },
    accountLinks: {
      create: vi.fn().mockResolvedValue({ url: "https://connect.stripe.com/setup/test" }),
    },
    paymentIntents: {
      create: vi.fn().mockResolvedValue({
        id: "pi_test123",
        client_secret: "pi_test123_secret_test",
      }),
      retrieve: vi.fn().mockResolvedValue({
        id: "pi_test123",
        status: "requires_confirmation",
      }),
      confirm: vi.fn().mockResolvedValue({
        id: "pi_test123",
        status: "succeeded",
      }),
      cancel: vi.fn().mockResolvedValue({
        id: "pi_test123",
        status: "canceled",
      }),
    },
    refunds: {
      create: vi.fn().mockResolvedValue({
        id: "re_test123",
        amount: 10500,
        status: "succeeded",
        payment_intent: "pi_test123",
      }),
    },
    transfers: {
      create: vi.fn().mockResolvedValue({
        id: "tr_test123",
        amount: 9500,
        currency: "usd",
        destination: "acct_test123",
      }),
    },
  },
}));

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

  // Create seller and onboard them
  const sellerRes = await request(app)
    .post("/api/v1/auth/register")
    .send({ email: "seller@example.com", password: "password123", name: "Seller" });
  sellerToken = sellerRes.body.accessToken;
  sellerId = sellerRes.body.user.id;

  await request(app)
    .post("/api/v1/seller/onboard")
    .set("Authorization", `Bearer ${sellerToken}`);
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
    expect(res.body.subtotal).toBe("100.00");
    expect(res.body.shippingCost).toBe("5.00");
    expect(res.body.total).toBe("105.00");
    expect(res.body.platformFee).toBe("10.00"); // 10% of $100
    expect(res.body.sellerPayout).toBe("95.00"); // $105 - $10
    expect(res.body.stripePaymentIntentId).toBe("pi_test123");
    expect(res.body.clientSecret).toBe("pi_test123_secret_test");
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

  it("returns 404 for nonexistent listing", async () => {
    const res = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: "00000000-0000-0000-0000-000000000000" });

    expect(res.status).toBe(404);
  });

  it("marks listing as reserved after order creation", async () => {
    const listing = await createListing();

    await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    const get = await request(app).get(`/api/v1/listings/${listing.id}`);

    expect(get.status).toBe(200);
    expect(get.body.status).toBe("reserved");
  });

  it("requires auth", async () => {
    const listing = await createListing();

    const res = await request(app)
      .post("/api/v1/orders")
      .send({ listingId: listing.id });

    expect(res.status).toBe(401);
  });

  it("returns 409 when creating a second order on a reserved listing", async () => {
    const listing = await createListing();

    // First order succeeds
    const first = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });
    expect(first.status).toBe(201);

    // Register a second buyer
    const secondBuyerRes = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "buyer2@example.com", password: "password123", name: "Buyer 2" });
    const secondBuyerToken = secondBuyerRes.body.accessToken;

    // Second order on same listing should conflict
    const second = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${secondBuyerToken}`)
      .send({ listingId: listing.id });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("CONFLICT");
  });

  it("allows a new order on a listing whose pending order has expired", async () => {
    const listing = await createListing();

    // First order succeeds
    const first = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });
    expect(first.status).toBe(201);
    const firstOrderId = first.body.id;

    // Backdate the first order's createdAt to >30 minutes ago
    const EXPIRY_MINUTES = 30;
    const expiredDate = new Date(Date.now() - (EXPIRY_MINUTES + 1) * 60 * 1000);
    const db = getDb();
    await db
      .update(orders)
      .set({ createdAt: expiredDate })
      .where(sql`id = ${firstOrderId}`);

    // Register a second buyer
    const secondBuyerRes = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "buyer2@example.com", password: "password123", name: "Buyer 2" });
    const secondBuyerToken = secondBuyerRes.body.accessToken;

    // Second order should succeed because the first order expired
    const second = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${secondBuyerToken}`)
      .send({ listingId: listing.id });

    expect(second.status).toBe(201);
    expect(second.body.stripePaymentIntentId).toBeDefined();

    // Verify the old order was expired
    const oldOrder = await request(app)
      .get(`/api/v1/orders/${firstOrderId}`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(oldOrder.body.status).toBe("expired");
  });
});

describe("POST /api/v1/orders/:id/pay", () => {
  it("pays a pending order and confirms the PaymentIntent", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`)
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("paid");
    expect(res.body.paidAt).toBeDefined();
  });

  it("rejects payment from a non-buyer", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`)
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.status).toBe(403);
  });

  it("expires an expired pending order when paying", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    // Backdate the order
    const EXPIRY_MINUTES = 30;
    const expiredDate = new Date(Date.now() - (EXPIRY_MINUTES + 1) * 60 * 1000);
    const db = getDb();
    await db
      .update(orders)
      .set({ createdAt: expiredDate })
      .where(sql`id = ${order.body.id}`);

    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`)
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("ORDER_EXPIRED");

    // Verify order is expired
    const getOrder = await request(app)
      .get(`/api/v1/orders/${order.body.id}`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(getOrder.body.status).toBe("expired");

    // Verify listing is released
    const getListing = await request(app).get(`/api/v1/listings/${listing.id}`);
    expect(getListing.body.status).toBe("active");
  });

  it("requires auth", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`);

    expect(res.status).toBe(401);
  });

  it("returns 402 when card is declined", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    const { stripe } = await import("../features/payments/stripe-client.js");
    const cardError = Object.assign(
      Object.create(Stripe.errors.StripeCardError.prototype),
      {
        type: "card_error",
        statusCode: 402,
        decline_code: "generic_decline",
        message: "Your card was declined",
      },
    );
    vi.mocked(stripe.paymentIntents.confirm).mockRejectedValueOnce(cardError);

    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`)
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe("PAYMENT_FAILED");
  });

  it("returns 502 on Stripe API error", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    const { stripe } = await import("../features/payments/stripe-client.js");
    const apiError = Object.assign(
      Object.create(Stripe.errors.StripeAPIError.prototype),
      {
        type: "api_error",
        statusCode: 500,
        message: "Stripe API error",
      },
    );
    vi.mocked(stripe.paymentIntents.confirm).mockRejectedValueOnce(apiError);

    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`)
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("PAYMENT_SERVICE_UNAVAILABLE");
  });

  it("returns the order as-is when paying an already-paid order (idempotent)", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    // Pay once
    await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`)
      .set("Authorization", `Bearer ${buyerToken}`);

    const { stripe } = await import("../features/payments/stripe-client.js");
    const confirmCallsBefore = vi.mocked(stripe.paymentIntents.confirm).mock.calls.length;

    // Pay again — idempotent, returns the already-paid order without hitting Stripe
    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`)
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("paid");
    expect(vi.mocked(stripe.paymentIntents.confirm).mock.calls.length).toBe(confirmCallsBefore);
  });

  it("returns 400 when paying a non-pending and non-paid order", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    // Cancel the order first
    await request(app)
      .post(`/api/v1/orders/${order.body.id}/cancel`)
      .set("Authorization", `Bearer ${buyerToken}`);

    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`)
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("handles webhook racing ahead and marking order paid before transitionStatus runs", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    const { stripe } = await import("../features/payments/stripe-client.js");
    const db = getDb();

    // Simulate the webhook race: when confirm() is called, the webhook
    // handler receives payment_intent.succeeded and transitions the order
    // to "paid" before payOrder() reaches transitionStatus().
    vi.mocked(stripe.paymentIntents.confirm).mockImplementationOnce(async () => {
      await db
        .update(orders)
        .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
        .where(sql`id = ${order.body.id}`);
      return { id: "pi_test123", status: "succeeded" };
    });

    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`)
      .set("Authorization", `Bearer ${buyerToken}`);

    // Should succeed — the order is paid, which is what the caller wanted
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("paid");
  });
});

describe("POST /api/v1/orders/:id/cancel", () => {
  it("cancels a pending order and releases the listing", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/cancel`)
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");

    // Listing should be released
    const getListing = await request(app).get(`/api/v1/listings/${listing.id}`);
    expect(getListing.body.status).toBe("active");
  });

  it("rejects cancellation from a non-buyer", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/cancel`)
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.status).toBe(403);
  });

  it("expires an expired pending order when cancelling", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    // Backdate the order
    const EXPIRY_MINUTES = 30;
    const expiredDate = new Date(Date.now() - (EXPIRY_MINUTES + 1) * 60 * 1000);
    const db = getDb();
    await db
      .update(orders)
      .set({ createdAt: expiredDate })
      .where(sql`id = ${order.body.id}`);

    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/cancel`)
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("expired");

    // Listing should be released
    const getListing = await request(app).get(`/api/v1/listings/${listing.id}`);
    expect(getListing.body.status).toBe("active");
  });

  it("requires auth", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/cancel`);

    expect(res.status).toBe(401);
  });

  it("returns 400 when cancelling a non-pending order", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    // Cancel once
    await request(app)
      .post(`/api/v1/orders/${order.body.id}/cancel`)
      .set("Authorization", `Bearer ${buyerToken}`);

    // Cancel again — should fail
    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/cancel`)
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
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

    // Buyer pays through dedicated endpoint
    const paid = await request(app)
      .post(`/api/v1/orders/${orderId}/pay`)
      .set("Authorization", `Bearer ${buyerToken}`);
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
      .post(`/api/v1/orders/${orderId}/complete`)
      .set("Authorization", `Bearer ${buyerToken}`);
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

    // Pay first so order is in "paid" status
    await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`)
      .set("Authorization", `Bearer ${buyerToken}`);

    // Buyer can't mark as shipped (only seller can)
    const res = await request(app)
      .patch(`/api/v1/orders/${order.body.id}/status`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ status: "shipped" });

    expect(res.status).toBe(403);
  });

  it("rejects paid transition through PATCH status endpoint (use dedicated pay endpoint)", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    const res = await request(app)
      .patch(`/api/v1/orders/${order.body.id}/status`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ status: "paid" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("TRANSITION_REMOVED");
  });

  it("rejects cancelled transition through PATCH status endpoint (use dedicated cancel endpoint)", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    const res = await request(app)
      .patch(`/api/v1/orders/${order.body.id}/status`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ status: "cancelled" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("TRANSITION_REMOVED");
  });

  it("rejects refunded transition through PATCH status endpoint (use dedicated refund endpoint)", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    // Pay first so it's in a state where refunded would otherwise be valid
    await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`)
      .set("Authorization", `Bearer ${buyerToken}`);

    const res = await request(app)
      .patch(`/api/v1/orders/${order.body.id}/status`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ status: "refunded" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("TRANSITION_REMOVED");
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
    await request(app).post(`/api/v1/orders/${id}/complete`).set("Authorization", `Bearer ${buyerToken}`);

    // Try to modify completed order
    const res = await request(app)
      .patch(`/api/v1/orders/${id}/status`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ status: "disputed" });

    expect(res.status).toBe(400);
  });
});

describe("completed transfer", () => {
    it("creates a Stripe transfer on completion and stores stripeTransferId", async () => {
      const listing = await createListing();

      const order = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({ listingId: listing.id });
      const id = order.body.id;

      // Progress to delivered
      await request(app)
        .post(`/api/v1/orders/${id}/pay`)
        .set("Authorization", `Bearer ${buyerToken}`);
      await request(app)
        .patch(`/api/v1/orders/${id}/status`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ status: "shipped" });
      await request(app)
        .patch(`/api/v1/orders/${id}/status`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ status: "delivered" });

      // Buyer completes — should trigger Stripe transfer
      const completed = await request(app)
        .post(`/api/v1/orders/${id}/complete`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(completed.status).toBe(200);
      expect(completed.body.status).toBe("completed");
      expect(completed.body.completedAt).toBeDefined();
      expect(completed.body.stripeTransferId).toBe("tr_test123");

      // Verify the transfer was created with correct params
      const { stripe } = await import("../features/payments/stripe-client.js");
      expect(stripe.transfers.create).toHaveBeenCalledWith({
        amount: 9500, // sellerPayout $95.00 in cents
        currency: "usd",
        destination: "acct_test123",
        metadata: {
          order_id: id,
          buyer_id: buyerId,
          seller_id: sellerId,
        },
      });
    });

    it("rejects completion with 502 TRANSFER_FAILED when Stripe transfer fails", async () => {
      const listing = await createListing();

      const order = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({ listingId: listing.id });
      const id = order.body.id;

      // Progress to delivered
      await request(app)
        .post(`/api/v1/orders/${id}/pay`)
        .set("Authorization", `Bearer ${buyerToken}`);
      await request(app)
        .patch(`/api/v1/orders/${id}/status`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ status: "shipped" });
      await request(app)
        .patch(`/api/v1/orders/${id}/status`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ status: "delivered" });

      // Simulate transfer failure
      const { stripe } = await import("../features/payments/stripe-client.js");
      const apiError = Object.assign(
        Object.create(Stripe.errors.StripeAPIError.prototype),
        {
          type: "api_error",
          statusCode: 500,
          message: "Stripe transfer failed",
        },
      );
      vi.mocked(stripe.transfers.create).mockRejectedValueOnce(apiError);

      const completed = await request(app)
        .post(`/api/v1/orders/${id}/complete`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(completed.status).toBe(502);
      expect(completed.body.error.code).toBe("TRANSFER_FAILED");

      // Order stays in delivered
      const getOrder = await request(app)
        .get(`/api/v1/orders/${id}`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(getOrder.body.status).toBe("delivered");
      expect(getOrder.body.stripeTransferId).toBeNull();
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

  it("does not show other users' orders", async () => {
    const listing = await createListing();

    // Buyer creates an order
    await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    // Register a different buyer
    const otherBuyer = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "otherbuyer@example.com", password: "password123", name: "Other" });

    const otherRes = await request(app)
      .get("/api/v1/orders/buyer/purchases")
      .set("Authorization", `Bearer ${otherBuyer.body.accessToken}`);

    expect(otherRes.status).toBe(200);
    expect(otherRes.body.data).toHaveLength(0);
  });

  it("filters by status", async () => {
    const listing = await createListing();

    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    // Move one order to paid
    await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`)
      .set("Authorization", `Bearer ${buyerToken}`);

    const res = await request(app)
      .get("/api/v1/orders/buyer/purchases?status=paid")
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe("paid");
  });
});

describe("POST /api/v1/orders/:id/refund", () => {
  it("refunds a paid order and stores the Stripe refund ID", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    // Pay first
    await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`)
      .set("Authorization", `Bearer ${buyerToken}`);

    // Refund
    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/refund`)
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("refunded");
    expect(res.body.refundedAt).toBeDefined();
    expect(res.body.stripeRefundId).toBe("re_test123");
  });

  it("rejects refund from a non-buyer", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    // Pay first
    await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`)
      .set("Authorization", `Bearer ${buyerToken}`);

    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/refund`)
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.status).toBe(403);
  });

  it("refunds an order in shipped status", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`)
      .set("Authorization", `Bearer ${buyerToken}`);

    await request(app)
      .patch(`/api/v1/orders/${order.body.id}/status`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ status: "shipped" });

    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/refund`)
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("refunded");
  });

  it("refunds an order in delivered status", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`)
      .set("Authorization", `Bearer ${buyerToken}`);

    await request(app)
      .patch(`/api/v1/orders/${order.body.id}/status`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ status: "shipped" });

    await request(app)
      .patch(`/api/v1/orders/${order.body.id}/status`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ status: "delivered" });

    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/refund`)
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("refunded");
  });

  it("returns 400 when refunding a pending order", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/refund`)
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("returns 400 when refunding a completed order", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });
    const id = order.body.id;

    // Progress to completed
    await request(app).post(`/api/v1/orders/${id}/pay`).set("Authorization", `Bearer ${buyerToken}`);
    await request(app).patch(`/api/v1/orders/${id}/status`).set("Authorization", `Bearer ${sellerToken}`).send({ status: "shipped" });
    await request(app).patch(`/api/v1/orders/${id}/status`).set("Authorization", `Bearer ${sellerToken}`).send({ status: "delivered" });
    await request(app).post(`/api/v1/orders/${id}/complete`).set("Authorization", `Bearer ${buyerToken}`);

    const res = await request(app)
      .post(`/api/v1/orders/${id}/refund`)
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("returns 400 when refunding an already refunded order", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`)
      .set("Authorization", `Bearer ${buyerToken}`);

    // First refund
    await request(app)
      .post(`/api/v1/orders/${order.body.id}/refund`)
      .set("Authorization", `Bearer ${buyerToken}`);

    // Second refund should fail
    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/refund`)
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("returns 400 when refunding a cancelled order", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    await request(app)
      .post(`/api/v1/orders/${order.body.id}/cancel`)
      .set("Authorization", `Bearer ${buyerToken}`);

    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/refund`)
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("returns 400 when refunding an expired order", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    // Backdate the order to expire it, then try to pay (which triggers expiry)
    const EXPIRY_MINUTES = 30;
    const expiredDate = new Date(Date.now() - (EXPIRY_MINUTES + 1) * 60 * 1000);
    const db = getDb();
    await db
      .update(orders)
      .set({ createdAt: expiredDate })
      .where(sql`id = ${order.body.id}`);

    // Trying to pay triggers the expiry transition
    await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`)
      .set("Authorization", `Bearer ${buyerToken}`);

    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/refund`)
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("returns 401 when not authenticated", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/refund`);

    expect(res.status).toBe(401);
  });

  it("returns 502 on Stripe API error", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`)
      .set("Authorization", `Bearer ${buyerToken}`);

    const { stripe } = await import("../features/payments/stripe-client.js");
    const apiError = Object.assign(
      Object.create(Stripe.errors.StripeAPIError.prototype),
      {
        type: "api_error",
        statusCode: 500,
        message: "Stripe API error",
      },
    );
    vi.mocked(stripe.refunds.create).mockRejectedValueOnce(apiError);

    const res = await request(app)
      .post(`/api/v1/orders/${order.body.id}/refund`)
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("PAYMENT_SERVICE_UNAVAILABLE");
  });
});
