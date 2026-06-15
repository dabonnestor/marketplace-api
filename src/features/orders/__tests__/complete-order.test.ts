import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
const mockLoggerError = vi.fn();

// DB mocks
const mockDbSelectLimit = vi.fn();
const mockDbUpdateSet = vi.fn();
const mockDbUpdateWhere = vi.fn();

vi.mock("../../../shared/payments/payments-adapter.js", () => ({
  execute: (...args: any[]) => mockExecute(...args),
}));

vi.mock("../../../shared/logger.js", () => ({
  logger: { error: (...args: any[]) => mockLoggerError(...args) },
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
}));

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
      update: (_table: any) => {
        return {
          set: (data: any) => {
            mockDbUpdateSet(data);
            return {
              where: (cond: any) => {
                mockDbUpdateWhere(cond);
                return { returning: () => Promise.resolve([{ ...sampleOrder, ...data }]) };
              },
            };
          },
        };
      },
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

const { completeOrder } = await import("../orders.service.js");

const sampleOrder = {
  id: "order_1",
  buyerId: "buyer_1",
  sellerId: "seller_1",
  listingId: "listing_1",
  status: "delivered",
  subtotal: "100.00",
  shippingCost: "5.00",
  platformFee: "10.00",
  total: "105.00",
  sellerPayout: "95.00",
  stripePaymentIntentId: "pi_test",
  stripeClientSecret: null,
  preDisputeStatus: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("completeOrder", () => {
  it("fetches the order, creates a transfer, then transitions to completed", async () => {
    // DB: getOrder (first call returns the order)
    mockDbSelectLimit.mockResolvedValueOnce([sampleOrder]);
    // DB: seller lookup
    mockDbSelectLimit.mockResolvedValueOnce([{ stripeAccountId: "acct_seller_1" }]);
    // DB: transitionOrder update
    mockDbUpdateSet.mockClear();

    mockExecute.mockResolvedValueOnce({ type: "transfer_created", id: "tr_xyz" });

    const result = await completeOrder("order_1", "buyer_1");

    expect(mockExecute).toHaveBeenCalled();
    const command = mockExecute.mock.calls[0][0];
    expect(command.type).toBe("create_transfer");
    expect(command.amount).toBe("95.00");
    expect(command.destination).toBe("acct_seller_1");
    expect(command.metadata).toEqual({
      order_id: "order_1",
      buyer_id: "buyer_1",
      seller_id: "seller_1",
    });

    // Should have updated status to completed
    expect(mockDbUpdateSet).toHaveBeenCalled();
    const updateCalls = mockDbUpdateSet.mock.calls.map((c: any) => c[0]);
    const transitionUpdate = updateCalls.find((u: any) => u.status === "completed");
    expect(transitionUpdate).toBeDefined();
    expect(transitionUpdate).toHaveProperty("completedAt");

    // Should have saved the transfer ID
    const transferUpdate = updateCalls.find((u: any) => u.stripeTransferId === "tr_xyz");
    expect(transferUpdate).toBeDefined();

    expect(result.stripeTransferId).toBe("tr_xyz");
  });

  it("does not transition if the transfer fails", async () => {
    mockDbSelectLimit.mockResolvedValueOnce([sampleOrder]);
    mockDbSelectLimit.mockResolvedValueOnce([{ stripeAccountId: "acct_seller_1" }]);

    mockExecute.mockRejectedValueOnce(new Error("Stripe transfer failed"));

    await expect(completeOrder("order_1", "buyer_1")).rejects.toThrow("Stripe transfer failed");

    // Should NOT have updated status to completed
    const statusUpdates = mockDbUpdateSet.mock.calls.filter(
      (c: any) => c[0] && c[0].status === "completed",
    );
    expect(statusUpdates).toHaveLength(0);
  });
});
