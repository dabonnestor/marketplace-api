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

const { executeTransition } = await import("../orders.service.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("executeTransition", () => {
  it("persists status and updatedAt, and returns the updated order", async () => {
    const fakeOrder = { id: "order_1", status: "paid", updatedAt: new Date() };
    mockDbUpdateWhereReturning.mockResolvedValueOnce([fakeOrder]);

    const result = await executeTransition("order_1", "paid", { allowed: true });

    expect(mockDbUpdateSet).toHaveBeenCalledWith({
      status: "paid",
      updatedAt: expect.any(Date),
    });
    expect(result).toEqual(fakeOrder);
  });

  it("sets the timestampField in the update when result provides one", async () => {
    const fakeOrder = { id: "order_1", status: "completed", completedAt: new Date() };
    mockDbUpdateWhereReturning.mockResolvedValueOnce([fakeOrder]);

    await executeTransition("order_1", "completed", {
      allowed: true,
      timestampField: "completedAt",
    });

    expect(mockDbUpdateSet).toHaveBeenCalledWith({
      status: "completed",
      updatedAt: expect.any(Date),
      completedAt: expect.any(Date),
    });
  });

  it("does not set a timestampField when result does not provide one", async () => {
    mockDbUpdateWhereReturning.mockResolvedValueOnce([{ id: "order_1", status: "disputed" }]);

    await executeTransition("order_1", "disputed", { allowed: true });

    const callArgs = mockDbUpdateSet.mock.calls[0][0];
    expect(callArgs).toHaveProperty("status", "disputed");
    expect(callArgs).toHaveProperty("updatedAt");
    expect(callArgs).not.toHaveProperty("disputedAt");
  });

  it("merges extraUpdates into the persisted record", async () => {
    mockDbUpdateWhereReturning.mockResolvedValueOnce([
      { id: "order_1", status: "disputed", preDisputeStatus: "paid" },
    ]);

    await executeTransition("order_1", "disputed", { allowed: true }, {
      preDisputeStatus: "paid",
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

    await executeTransition("order_1", "paid", { allowed: true, timestampField: "paidAt" }, {
      preDisputeStatus: null,
    });

    expect(mockDbUpdateSet).toHaveBeenCalledWith({
      status: "paid",
      updatedAt: expect.any(Date),
      paidAt: expect.any(Date),
      preDisputeStatus: null,
    });
  });
});
