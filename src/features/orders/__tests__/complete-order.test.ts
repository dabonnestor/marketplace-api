import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";

const mockTransfersCreate = vi.fn();
const mockSelectLimit = vi.fn();
const mockUpdateSet = vi.fn();
const mockUpdateWhere = vi.fn();
const mockTransitionStatus = vi.fn();
const mockGetOrder = vi.fn();

vi.mock("../../payments/stripe-client.js", () => ({
  stripe: {
    transfers: {
      create: (...args: any[]) => mockTransfersCreate(...args),
    },
  },
}));

vi.mock("../../shared/logger.js", () => ({
  logger: { error: vi.fn() },
}));

vi.mock("../../../db/index.js", () => {
  const eq = (a: any, b: any) => ({ type: "eq", left: a, right: b });
  return {
    db: {
      select: (..._args: any[]) => ({
        from: (_table: any) => ({
          where: (_cond: any) => ({
            limit: (_n: number) => mockSelectLimit(),
          }),
        }),
      }),
      update: (_table: any) => ({
        set: (data: any) => {
          mockUpdateSet(data);
          return {
            where: (cond: any) => {
              mockUpdateWhere(cond);
              return Promise.resolve();
            },
          };
        },
      }),
    },
    schema: {
      orders: {
        id: { name: "id" },
        stripeTransferId: { name: "stripeTransferId" },
        updatedAt: { name: "updatedAt" },
      },
      users: {
        id: { name: "id" },
        stripeAccountId: { name: "stripeAccountId" },
      },
    },
    eq,
  };
});

vi.mock("../orders.service.js", () => ({
  transitionStatus: (...args: any[]) => mockTransitionStatus(...args),
  getOrder: (...args: any[]) => mockGetOrder(...args),
}));

const { completeOrder, createStripeTransfer } = await import("../complete-order.js");

function fakeTransfer(overrides: Partial<Stripe.Transfer> = {}) {
  return { id: "tr_test_123", ...overrides } as Stripe.Transfer;
}

const sampleOrder = {
  id: "order_1",
  sellerId: "seller_1",
  buyerId: "buyer_1",
  sellerPayout: "95.00",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createStripeTransfer", () => {
  it("creates a Stripe transfer with the correct amount, currency, destination, and metadata", async () => {
    mockSelectLimit.mockResolvedValueOnce([{ stripeAccountId: "acct_seller_1" }]);
    mockTransfersCreate.mockResolvedValueOnce(fakeTransfer({ id: "tr_abc" }));

    const result = await createStripeTransfer(sampleOrder);

    const transferArgs = mockTransfersCreate.mock.calls[0][0];
    expect(transferArgs.amount).toBe(9500);
    expect(transferArgs.currency).toBe("usd");
    expect(transferArgs.destination).toBe("acct_seller_1");
    expect(transferArgs.metadata).toEqual({
      order_id: "order_1",
      buyer_id: "buyer_1",
      seller_id: "seller_1",
    });
    expect(result).toBe("tr_abc");
  });

  it("throws a 502 AppError when Stripe transfer fails", async () => {
    mockSelectLimit.mockResolvedValueOnce([{ stripeAccountId: "acct_seller_1" }]);
    const stripeError = new Stripe.errors.StripeError({
      type: "api_error",
      message: "Transfer failed",
    } as any);
    mockTransfersCreate.mockRejectedValueOnce(stripeError);

    await expect(createStripeTransfer(sampleOrder)).rejects.toThrow(
      "Stripe transfer failed",
    );
  });
});

describe("completeOrder", () => {
  it("fetches the order, creates a transfer, then transitions to completed", async () => {
    mockGetOrder.mockResolvedValueOnce(sampleOrder);
    mockSelectLimit.mockResolvedValueOnce([{ stripeAccountId: "acct_seller_1" }]);
    mockTransfersCreate.mockResolvedValueOnce(fakeTransfer({ id: "tr_xyz" }));
    mockTransitionStatus.mockResolvedValueOnce(sampleOrder);

    const result = await completeOrder("order_1", "user_1");

    expect(mockGetOrder).toHaveBeenCalledWith("order_1", "user_1");
    expect(mockTransfersCreate).toHaveBeenCalled();
    expect(mockTransitionStatus).toHaveBeenCalledWith("order_1", "completed", "user_1");
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ stripeTransferId: "tr_xyz" }),
    );
    expect(result).toEqual({ ...sampleOrder, stripeTransferId: "tr_xyz" });
  });

  it("does not transition if the transfer fails", async () => {
    mockGetOrder.mockResolvedValueOnce(sampleOrder);
    mockSelectLimit.mockResolvedValueOnce([{ stripeAccountId: "acct_seller_1" }]);
    const stripeError = new Stripe.errors.StripeError({
      type: "api_error",
      message: "Transfer failed",
    } as any);
    mockTransfersCreate.mockRejectedValueOnce(stripeError);

    await expect(completeOrder("order_1", "user_1")).rejects.toThrow(
      "Stripe transfer failed",
    );
    expect(mockTransitionStatus).not.toHaveBeenCalled();
  });
});
