import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";

// Mock stripe before importing the module under test
const mockCreate = vi.fn();
vi.mock("../../../shared/payments/stripe-client.js", () => ({
  stripe: {
    paymentIntents: {
      create: (...args: any[]) => mockCreate(...args),
    },
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
  ForbiddenError: class ForbiddenError extends Error {
    statusCode = 403;
    constructor(message: string) {
      super(message);
    }
  },
  NotFoundError: class NotFoundError extends Error {
    statusCode = 404;
    constructor(entity: string, id: string) {
      super(`${entity} not found: ${id}`);
    }
  },
  ConflictError: class ConflictError extends Error {
    statusCode = 409;
    constructor(message: string) {
      super(message);
    }
  },
}));

const mockDbUpdate = vi.fn();
const mockDbUpdateSet = vi.fn();
const mockDbUpdateWhere = vi.fn();
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
      update: (..._args: any[]) => {
        mockDbUpdate();
        return {
          set: (data: any) => {
            mockDbUpdateSet(data);
            return {
              where: (cond: any) => {
                mockDbUpdateWhere(cond);
                return Promise.resolve();
              },
            };
          },
        };
      },
    },
    schema: {
      orders: {
        id: { name: "id" },
        stripePaymentIntentId: { name: "stripePaymentIntentId" },
        stripeClientSecret: { name: "stripeClientSecret" },
        updatedAt: { name: "updatedAt" },
      },
    },
    eq,
  };
});

const { createOrGetPaymentIntent } = await import("../orchestration.js");
const { getOrder } = await import("../queries.js");

function fakePaymentIntent(overrides: Partial<Stripe.PaymentIntent> = {}) {
  return {
    id: "pi_test_123",
    client_secret: "pi_test_123_secret_abc",
    ...overrides,
  } as Stripe.PaymentIntent;
}

const sampleOrder = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  total: "105.00",
  buyerId: "buyer_1",
  sellerId: "seller_1",
  listingId: "listing_1",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createOrGetPaymentIntent", () => {
  it("creates a Stripe PaymentIntent with the correct amount in cents, currency, and capture method", async () => {
    mockCreate.mockResolvedValueOnce(fakePaymentIntent());

    await createOrGetPaymentIntent(sampleOrder);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.amount).toBe(10500); // $105.00 in cents
    expect(callArgs.currency).toBe("usd");
    expect(callArgs.capture_method).toBe("automatic");
    expect(callArgs.payment_method_types).toEqual(["card"]);
  });

  it("includes order metadata on the PaymentIntent", async () => {
    mockCreate.mockResolvedValueOnce(fakePaymentIntent());

    await createOrGetPaymentIntent(sampleOrder);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.metadata).toEqual({
      order_id: sampleOrder.id,
      buyer_id: sampleOrder.buyerId,
      seller_id: sampleOrder.sellerId,
      listing_id: sampleOrder.listingId,
    });
  });

  it("uses the order id as the idempotency key", async () => {
    mockCreate.mockResolvedValueOnce(fakePaymentIntent());

    await createOrGetPaymentIntent(sampleOrder);

    const secondArg = mockCreate.mock.calls[0][1];
    expect(secondArg).toEqual({ idempotencyKey: sampleOrder.id });
  });

  it("returns the PaymentIntent id and client_secret", async () => {
    mockCreate.mockResolvedValueOnce(
      fakePaymentIntent({ id: "pi_abc", client_secret: "cs_xyz" }),
    );

    const result = await createOrGetPaymentIntent(sampleOrder);

    expect(result).toEqual({ id: "pi_abc", clientSecret: "cs_xyz" });
  });

  it("returns null clientSecret when Stripe returns null client_secret", async () => {
    mockCreate.mockResolvedValueOnce(
      fakePaymentIntent({ id: "pi_abc", client_secret: null }),
    );

    const result = await createOrGetPaymentIntent(sampleOrder);

    expect(result).toEqual({ id: "pi_abc", clientSecret: null });
  });

  it("updates the order row with the stripePaymentIntentId and stripeClientSecret", async () => {
    mockCreate.mockResolvedValueOnce(fakePaymentIntent({ id: "pi_xyz", client_secret: "cs_xyz" }));

    await createOrGetPaymentIntent(sampleOrder);

    expect(mockDbUpdate).toHaveBeenCalled();
    expect(mockDbUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        stripePaymentIntentId: "pi_xyz",
        stripeClientSecret: "cs_xyz",
      }),
    );
  });

  it("maps Stripe errors through mapStripeError", async () => {
    const stripeError = new Stripe.errors.StripeError({
      type: "api_error",
      message: "boom",
    } as any);
    mockCreate.mockRejectedValueOnce(stripeError);

    await expect(
      createOrGetPaymentIntent(sampleOrder),
    ).rejects.toThrow();
  });
});

describe("getOrder", () => {
  const fakeOrder = {
    id: sampleOrder.id,
    buyerId: sampleOrder.buyerId,
    sellerId: sampleOrder.sellerId,
    listingId: sampleOrder.listingId,
    status: "pending",
    subtotal: "100.00",
    shippingCost: "5.00",
    platformFee: "10.00",
    total: "105.00",
    sellerPayout: "95.00",
    stripePaymentIntentId: "pi_test123",
    stripeClientSecret: "pi_test123_secret_test",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("returns the stored clientSecret from DB without calling Stripe", async () => {
    mockDbSelectLimit.mockResolvedValueOnce([fakeOrder]);

    const result = await getOrder(sampleOrder.id, sampleOrder.buyerId);

    // Must NOT call Stripe
    expect(mockCreate).not.toHaveBeenCalled();

    // Must return the stored clientSecret
    expect((result as any).clientSecret).toBe("pi_test123_secret_test");
  });

  it("does not attach clientSecret for non-pending orders", async () => {
    mockDbSelectLimit.mockResolvedValueOnce([
      { ...fakeOrder, status: "paid" },
    ]);

    const result = await getOrder(sampleOrder.id, sampleOrder.buyerId);

    expect(mockCreate).not.toHaveBeenCalled();
    expect((result as any).clientSecret).toBeUndefined();
  });

  it("does not attach clientSecret when stripeClientSecret is null", async () => {
    mockDbSelectLimit.mockResolvedValueOnce([
      { ...fakeOrder, stripeClientSecret: null },
    ]);

    const result = await getOrder(sampleOrder.id, sampleOrder.buyerId);

    expect(mockCreate).not.toHaveBeenCalled();
    expect((result as any).clientSecret).toBeUndefined();
  });

  it("throws NotFoundError when order does not exist", async () => {
    mockDbSelectLimit.mockResolvedValueOnce([]);

    await expect(
      getOrder("00000000-0000-0000-0000-000000000000", sampleOrder.buyerId),
    ).rejects.toThrow("not found");
  });
});
