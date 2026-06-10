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
    webhooks: {
      generateTestHeaderString: vi.fn(({ payload }: { payload: string }) => {
        return `t=1234567890,v1=mock_sig_for_${payload.slice(0, 20)}`;
      }),
      constructEvent: vi.fn((body: Buffer, signature: string | undefined, _secret: string) => {
        if (!signature || !signature.startsWith("t=")) {
          throw new Error("No valid signature found");
        }
        return JSON.parse(body.toString());
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

  const buyerRes = await request(app)
    .post("/api/v1/auth/register")
    .send({ email: "buyer@example.com", password: "password123", name: "Buyer" });
  buyerToken = buyerRes.body.accessToken;
  buyerId = buyerRes.body.user.id;

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
      description: "A test item",
      price: 100,
      category: "Books",
      condition: "New",
      shippingCost: 5,
    });
  return res.body;
}

describe("POST /api/v1/webhooks/stripe", () => {
  async function sendWebhook(event: Record<string, unknown>) {
    const { stripe } = await import("../features/payments/stripe-client.js");
    const payload = JSON.stringify(event);
    const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test" });
    return request(app)
      .post("/api/v1/webhooks/stripe")
      .set("stripe-signature", sig)
      .set("Content-Type", "application/json")
      .send(payload);
  }

  it("returns 401 when no Stripe signature header is present", async () => {
    const res = await request(app)
      .post("/api/v1/webhooks/stripe")
      .send({ type: "account.updated" })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(401);
  });

  it("transitions pending order to paid on payment_intent.succeeded (safety net)", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    const res = await sendWebhook({
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: order.body.stripePaymentIntentId,
          status: "succeeded",
          metadata: {
            order_id: order.body.id,
          },
        },
      },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    // Verify order is now paid
    const getOrder = await request(app)
      .get(`/api/v1/orders/${order.body.id}`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(getOrder.body.status).toBe("paid");
    expect(getOrder.body.paidAt).toBeDefined();
  });

  it("transitions to disputed and stores preDisputeStatus on charge.dispute.created", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    // Pay first so it's in "paid" status
    await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`)
      .set("Authorization", `Bearer ${buyerToken}`);

    const res = await sendWebhook({
      type: "charge.dispute.created",
      data: {
        object: {
          id: "dp_test123",
          status: "needs_response",
          payment_intent: order.body.stripePaymentIntentId,
        },
      },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    const getOrder = await request(app)
      .get(`/api/v1/orders/${order.body.id}`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(getOrder.body.status).toBe("disputed");
    expect(getOrder.body.preDisputeStatus).toBe("paid");
  });

  it("reverts to preDisputeStatus when charge.dispute.closed with status won", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`)
      .set("Authorization", `Bearer ${buyerToken}`);

    // First, dispute it
    await sendWebhook({
      type: "charge.dispute.created",
      data: {
        object: {
          id: "dp_test123",
          status: "needs_response",
          payment_intent: order.body.stripePaymentIntentId,
        },
      },
    });

    // Then close the dispute as won
    const res = await sendWebhook({
      type: "charge.dispute.closed",
      data: {
        object: {
          id: "dp_test123",
          status: "won",
          payment_intent: order.body.stripePaymentIntentId,
        },
      },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    const getOrder = await request(app)
      .get(`/api/v1/orders/${order.body.id}`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(getOrder.body.status).toBe("paid");
    expect(getOrder.body.preDisputeStatus).toBeNull();
  });

  it("transitions to refunded when charge.dispute.closed with status lost", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    await request(app)
      .post(`/api/v1/orders/${order.body.id}/pay`)
      .set("Authorization", `Bearer ${buyerToken}`);

    // First, dispute it
    await sendWebhook({
      type: "charge.dispute.created",
      data: {
        object: {
          id: "dp_test123",
          status: "needs_response",
          payment_intent: order.body.stripePaymentIntentId,
        },
      },
    });

    // Then close the dispute as lost
    const res = await sendWebhook({
      type: "charge.dispute.closed",
      data: {
        object: {
          id: "dp_test123",
          status: "lost",
          payment_intent: order.body.stripePaymentIntentId,
        },
      },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    const getOrder = await request(app)
      .get(`/api/v1/orders/${order.body.id}`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(getOrder.body.status).toBe("refunded");
    expect(getOrder.body.refundedAt).toBeDefined();
  });

  it("logs account.updated and returns 200", async () => {
    const res = await sendWebhook({
      type: "account.updated",
      data: {
        object: {
          id: "acct_test123",
        },
      },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it("logs payment_intent.payment_failed and returns 200 without transitioning order", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    const res = await sendWebhook({
      type: "payment_intent.payment_failed",
      data: {
        object: {
          id: order.body.stripePaymentIntentId,
          status: "requires_payment_method",
          metadata: {
            order_id: order.body.id,
          },
        },
      },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    // Order should still be pending
    const getOrder = await request(app)
      .get(`/api/v1/orders/${order.body.id}`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(getOrder.body.status).toBe("pending");
  });

  it("returns 200 when replaying an already-processed event (idempotent)", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    // First webhook: transitions pending → paid
    await sendWebhook({
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: order.body.stripePaymentIntentId,
          status: "succeeded",
          metadata: { order_id: order.body.id },
        },
      },
    });

    // Replay the same event
    const res = await sendWebhook({
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: order.body.stripePaymentIntentId,
          status: "succeeded",
          metadata: { order_id: order.body.id },
        },
      },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    // Order should still be paid (not errored)
    const getOrder = await request(app)
      .get(`/api/v1/orders/${order.body.id}`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(getOrder.body.status).toBe("paid");
  });

  it("returns 200 for an invalid transition event (order in wrong state)", async () => {
    const listing = await createListing();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ listingId: listing.id });

    // Cancel the order first
    await request(app)
      .post(`/api/v1/orders/${order.body.id}/cancel`)
      .set("Authorization", `Bearer ${buyerToken}`);

    // Send payment_intent.succeeded — but order is already cancelled
    const res = await sendWebhook({
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: order.body.stripePaymentIntentId,
          status: "succeeded",
          metadata: { order_id: order.body.id },
        },
      },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    // Order should still be cancelled
    const getOrder = await request(app)
      .get(`/api/v1/orders/${order.body.id}`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(getOrder.body.status).toBe("cancelled");
  });
});
