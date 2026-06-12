import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";

const mockTransitionOrder = vi.fn();
const mockExpireIfStale = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();

vi.mock("../../../shared/order-lifecycle/transition-order.js", () => ({
  transitionOrder: (...args: any[]) => mockTransitionOrder(...args),
}));

vi.mock("../../../shared/order-lifecycle/expiry.js", () => ({
  expireIfStale: (...args: any[]) => mockExpireIfStale(...args),
}));

vi.mock("../../../shared/logger.js", () => ({
  logger: {
    info: (...args: any[]) => mockLoggerInfo(...args),
    warn: (...args: any[]) => mockLoggerWarn(...args),
    error: vi.fn(),
  },
}));

vi.mock("../../../shared/errors.js", () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    code: string;
    constructor(statusCode: number, code: string, message: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

const mockDbSelectLimit = vi.fn();

vi.mock("../../../db/index.js", () => {
  const eq = (a: any, b: any) => ({ type: "eq", left: a, right: b });
  return {
    db: {
      select: (..._args: any[]) => ({
        from: (_table: any) => ({
          where: (_cond: any) => ({
            limit: (_n: number) => mockDbSelectLimit(),
          }),
        }),
      }),
    },
    schema: {
      orders: {
        id: { name: "id" },
        stripePaymentIntentId: { name: "stripePaymentIntentId" },
        status: { name: "status" },
      },
    },
    eq,
  };
});

const { handleStripeEvent } = await import("../webhooks.service.js");

function fakePI(overrides: Partial<Stripe.PaymentIntent> = {}) {
  return {
    id: "pi_test",
    metadata: { order_id: "order_1" },
    ...overrides,
  } as Stripe.PaymentIntent;
}

function fakeDispute(overrides: Partial<Stripe.Dispute> = {}) {
  return {
    id: "dp_test",
    payment_intent: "pi_test",
    status: "needs_response",
    ...overrides,
  } as Stripe.Dispute;
}

function fakeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order_1",
    status: "pending",
    buyerId: "buyer_1",
    sellerId: "seller_1",
    listingId: "listing_1",
    preDisputeStatus: null,
    stripePaymentIntentId: "pi_test",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── handleStripeEvent routing ──────────────────────────────────

describe("handleStripeEvent", () => {
  it("routes payment_intent.succeeded to the PI handler", async () => {
    mockDbSelectLimit.mockResolvedValueOnce([fakeOrder()]);
    mockExpireIfStale.mockResolvedValueOnce(false);
    mockTransitionOrder.mockResolvedValueOnce(fakeOrder({ status: "paid" }));

    await handleStripeEvent({
      type: "payment_intent.succeeded",
      data: { object: fakePI() },
    } as Stripe.Event);

    expect(mockTransitionOrder).toHaveBeenCalled();
  });

  it("logs and returns for unhandled event types", async () => {
    await handleStripeEvent({
      type: "invoice.paid",
      data: { object: {} },
    } as unknown as Stripe.Event);

    expect(mockDbSelectLimit).not.toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "invoice.paid" }),
      "Unhandled webhook event type",
    );
  });
});

// ── payment_intent.succeeded ───────────────────────────────────

describe("handlePaymentIntentSucceeded", () => {
  it("transitions the order to paid and logs the safety net message", async () => {
    mockDbSelectLimit.mockResolvedValueOnce([fakeOrder()]);
    mockExpireIfStale.mockResolvedValueOnce(false);
    mockTransitionOrder.mockResolvedValueOnce(fakeOrder({ status: "paid" }));

    await handleStripeEvent({
      type: "payment_intent.succeeded",
      data: { object: fakePI() },
    } as Stripe.Event);

    expect(mockTransitionOrder).toHaveBeenCalledWith(
      expect.objectContaining({ id: "order_1" }),
      "paid",
    );
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "order_1" }),
      "Order marked as paid via webhook (safety net)",
    );
  });

  it("logs a warning and returns if no order_id in metadata", async () => {
    await handleStripeEvent({
      type: "payment_intent.succeeded",
      data: { object: fakePI({ metadata: {} }) },
    } as Stripe.Event);

    expect(mockLoggerWarn).toHaveBeenCalledWith("payment_intent.succeeded webhook received without order_id in metadata");
    expect(mockTransitionOrder).not.toHaveBeenCalled();
  });

  it("logs a warning and returns for unknown order", async () => {
    mockDbSelectLimit.mockResolvedValueOnce([]);

    await handleStripeEvent({
      type: "payment_intent.succeeded",
      data: { object: fakePI() },
    } as Stripe.Event);

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "order_1" }),
      expect.stringContaining("unknown order"),
    );
    expect(mockTransitionOrder).not.toHaveBeenCalled();
  });

  it("expires stale orders and returns without transitioning", async () => {
    mockDbSelectLimit.mockResolvedValueOnce([fakeOrder()]);
    mockExpireIfStale.mockResolvedValueOnce(true);

    await handleStripeEvent({
      type: "payment_intent.succeeded",
      data: { object: fakePI() },
    } as Stripe.Event);

    expect(mockExpireIfStale).toHaveBeenCalled();
    expect(mockTransitionOrder).not.toHaveBeenCalled();
  });

  it("logs and returns when transition throws INVALID_TRANSITION (already processed)", async () => {
    mockDbSelectLimit.mockResolvedValueOnce([fakeOrder({ status: "paid" })]);
    mockExpireIfStale.mockResolvedValueOnce(false);
    const err = new (await import("../../../shared/errors.js")).AppError(
      400,
      "INVALID_TRANSITION",
      "Cannot transition order from 'paid' to 'paid'",
    );
    mockTransitionOrder.mockRejectedValueOnce(err);

    // Should NOT throw
    await handleStripeEvent({
      type: "payment_intent.succeeded",
      data: { object: fakePI() },
    } as Stripe.Event);

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ currentStatus: "paid" }),
      expect.stringContaining("already processed"),
    );
  });
});

// ── charge.dispute.created ─────────────────────────────────────

describe("handleDisputeCreated", () => {
  it("transitions the order to disputed with preDisputeStatus", async () => {
    mockDbSelectLimit.mockResolvedValueOnce([fakeOrder({ status: "paid" })]);

    await handleStripeEvent({
      type: "charge.dispute.created",
      data: { object: fakeDispute() },
    } as Stripe.Event);

    expect(mockTransitionOrder).toHaveBeenCalledWith(
      expect.objectContaining({ status: "paid" }),
      "disputed",
      { extraUpdates: { preDisputeStatus: "paid" } },
    );
  });

  it("logs a warning if no payment_intent", async () => {
    await handleStripeEvent({
      type: "charge.dispute.created",
      data: { object: fakeDispute({ payment_intent: null as any }) },
    } as Stripe.Event);

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "charge.dispute.created webhook received without payment_intent",
    );
    expect(mockTransitionOrder).not.toHaveBeenCalled();
  });

  it("logs and returns for already-processed disputes", async () => {
    mockDbSelectLimit.mockResolvedValueOnce([fakeOrder({ status: "disputed", preDisputeStatus: "paid" })]);
    const err = new (await import("../../../shared/errors.js")).AppError(
      400,
      "INVALID_TRANSITION",
      "Cannot transition order from 'disputed' to 'disputed'",
    );
    mockTransitionOrder.mockRejectedValueOnce(err);

    await handleStripeEvent({
      type: "charge.dispute.created",
      data: { object: fakeDispute() },
    } as Stripe.Event);

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ currentStatus: "disputed" }),
      expect.stringContaining("already processed"),
    );
  });
});

// ── charge.dispute.closed ──────────────────────────────────────

describe("handleDisputeClosed", () => {
  it("won: restores the preDisputeStatus and clears preDisputeStatus field", async () => {
    mockDbSelectLimit.mockResolvedValueOnce([
      fakeOrder({ status: "disputed", preDisputeStatus: "paid" }),
    ]);

    await handleStripeEvent({
      type: "charge.dispute.closed",
      data: { object: fakeDispute({ status: "won" }) },
    } as Stripe.Event);

    expect(mockTransitionOrder).toHaveBeenCalledWith(
      expect.objectContaining({ preDisputeStatus: "paid" }),
      "paid",
      { extraUpdates: { preDisputeStatus: null } },
    );
  });

  it("won: logs warning if no preDisputeStatus", async () => {
    mockDbSelectLimit.mockResolvedValueOnce([
      fakeOrder({ status: "disputed", preDisputeStatus: null }),
    ]);

    await handleStripeEvent({
      type: "charge.dispute.closed",
      data: { object: fakeDispute({ status: "won" }) },
    } as Stripe.Event);

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "order_1" }),
      "charge.dispute.closed won but no preDisputeStatus stored",
    );
    expect(mockTransitionOrder).not.toHaveBeenCalled();
  });

  it("lost: transitions to refunded", async () => {
    mockDbSelectLimit.mockResolvedValueOnce([
      fakeOrder({ status: "disputed", preDisputeStatus: "paid" }),
    ]);

    await handleStripeEvent({
      type: "charge.dispute.closed",
      data: { object: fakeDispute({ status: "lost" }) },
    } as Stripe.Event);

    expect(mockTransitionOrder).toHaveBeenCalledWith(
      expect.objectContaining({ status: "disputed" }),
      "refunded",
    );
  });

  it("lost: logs and returns for already processed", async () => {
    mockDbSelectLimit.mockResolvedValueOnce([
      fakeOrder({ status: "refunded", preDisputeStatus: "paid" }),
    ]);
    const err = new (await import("../../../shared/errors.js")).AppError(
      400,
      "INVALID_TRANSITION",
      "Cannot transition order from 'refunded' to 'refunded'",
    );
    mockTransitionOrder.mockRejectedValueOnce(err);

    await handleStripeEvent({
      type: "charge.dispute.closed",
      data: { object: fakeDispute({ status: "lost" }) },
    } as Stripe.Event);

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ currentStatus: "refunded" }),
      expect.stringContaining("already processed"),
    );
  });

  it("handles unknown payment_intent gracefully", async () => {
    mockDbSelectLimit.mockResolvedValueOnce([]);

    await handleStripeEvent({
      type: "charge.dispute.closed",
      data: { object: fakeDispute({ status: "lost" }) },
    } as Stripe.Event);

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ piId: "pi_test" }),
      expect.stringContaining("unknown payment intent"),
    );
    expect(mockTransitionOrder).not.toHaveBeenCalled();
  });
});

// ── informational events ───────────────────────────────────────

describe("informational webhook events", () => {
  it("logs account.updated without error", async () => {
    await handleStripeEvent({
      type: "account.updated",
      data: { object: { id: "acct_123" } },
    } as Stripe.Event);

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "acct_123" }),
      "account.updated webhook received",
    );
  });

  it("logs payment_intent.payment_failed without error", async () => {
    await handleStripeEvent({
      type: "payment_intent.payment_failed",
      data: { object: { id: "pi_failed" } },
    } as Stripe.Event);

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ piId: "pi_failed" }),
      "payment_intent.payment_failed webhook received",
    );
  });
});
