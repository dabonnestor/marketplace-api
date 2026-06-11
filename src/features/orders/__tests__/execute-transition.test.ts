import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDbUpdateSet = vi.fn();
const mockDbUpdateWhereReturning = vi.fn();

vi.mock("../../../db/index.js", () => {
  const eq = (a: any, b: any) => ({ type: "eq", left: a, right: b });
  return {
    db: {
      update: (_table: any) => ({
        set: (data: any) => {
          mockDbUpdateSet(data);
          return {
            where: (_cond: any) => ({
              returning: () => mockDbUpdateWhereReturning(),
            }),
          };
        },
      }),
    },
    schema: {
      orders: { id: { name: "id" } },
    },
    eq,
  };
});

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
}));

const { transitionOrder } = await import("../orders.service.js");

beforeEach(() => {
  vi.clearAllMocks();
});

function makeOrder(overrides: Partial<{ id: string; status: string; buyerId: string; sellerId: string; preDisputeStatus: string | null }> = {}) {
  return {
    id: "order_1",
    status: "pending",
    buyerId: "buyer_1",
    sellerId: "seller_1",
    preDisputeStatus: null,
    ...overrides,
  };
}

describe("transitionOrder", () => {
  it("persists status, updatedAt, and timestampField, and returns the updated order", async () => {
    const updated = { id: "order_1", status: "paid", paidAt: new Date() };
    mockDbUpdateWhereReturning.mockResolvedValueOnce([updated]);

    const result = await transitionOrder(makeOrder(), "paid", { userId: "buyer_1" });

    expect(mockDbUpdateSet).toHaveBeenCalledWith({
      status: "paid",
      updatedAt: expect.any(Date),
      paidAt: expect.any(Date),
    });
    expect(result).toEqual(updated);
  });

  it("does not set a timestampField when the state machine does not provide one", async () => {
    mockDbUpdateWhereReturning.mockResolvedValueOnce([{ id: "order_1", status: "cancelled" }]);

    await transitionOrder(makeOrder(), "cancelled", { userId: "buyer_1" });

    const callArgs = mockDbUpdateSet.mock.calls[0][0];
    expect(callArgs).toHaveProperty("status", "cancelled");
    expect(callArgs).toHaveProperty("updatedAt");
    expect(callArgs).not.toHaveProperty("cancelledAt");
  });

  it("merges extraUpdates into the persisted record", async () => {
    mockDbUpdateWhereReturning.mockResolvedValueOnce([
      { id: "order_1", status: "disputed", preDisputeStatus: "paid" },
    ]);

    await transitionOrder(makeOrder({ status: "paid" }), "disputed", {
      extraUpdates: { preDisputeStatus: "paid" },
    });

    expect(mockDbUpdateSet).toHaveBeenCalledWith({
      status: "disputed",
      updatedAt: expect.any(Date),
      preDisputeStatus: "paid",
    });
  });

  it("sets extraUpdates to null when explicitly passed", async () => {
    mockDbUpdateWhereReturning.mockResolvedValueOnce([
      { id: "order_1", status: "paid", preDisputeStatus: null },
    ]);

    await transitionOrder(makeOrder({ status: "disputed", preDisputeStatus: "paid" }), "paid", {
      extraUpdates: { preDisputeStatus: null },
    });

    expect(mockDbUpdateSet).toHaveBeenCalledWith({
      status: "paid",
      updatedAt: expect.any(Date),
      paidAt: expect.any(Date),
      preDisputeStatus: null,
    });
  });

  it("throws ForbiddenError when userId is provided but user is not a participant", async () => {
    await expect(
      transitionOrder(makeOrder(), "paid", { userId: "stranger" }),
    ).rejects.toThrow("not a participant");
  });

  it("allows system calls without userId (no role check)", async () => {
    const updated = { id: "order_1", status: "paid", paidAt: new Date() };
    mockDbUpdateWhereReturning.mockResolvedValueOnce([updated]);

    const result = await transitionOrder(makeOrder(), "paid");

    expect(result).toEqual(updated);
  });

  it("throws INVALID_TRANSITION for disallowed transitions", async () => {
    // completed is terminal — no transitions from it
    await expect(
      transitionOrder(makeOrder({ status: "completed" }), "paid"),
    ).rejects.toThrow("Cannot transition order from 'completed' to 'paid'");
  });

  it("throws ForbiddenError for role-restricted transitions by wrong role", async () => {
    // shipped requires seller, but buyer_1 is the buyer
    await expect(
      transitionOrder(makeOrder({ status: "paid" }), "shipped", { userId: "buyer_1" }),
    ).rejects.toThrow("Only the seller can mark the order as shipped");
  });
});
