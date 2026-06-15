import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDbSelect = vi.fn();
const mockDbUpdateSet = vi.fn();
const mockDbUpdateWhere = vi.fn();

vi.mock("../../../db/index.js", () => {
  const eq = (a: any, b: any) => ({ type: "eq", left: a, right: b });
  const and = (...args: any[]) => ({ type: "and", args });
  const sql = (strings: TemplateStringsArray, ...values: any[]) => ({
    type: "sql",
    strings,
    values,
  });
  return {
    db: {
      select: () => ({
        from: (_table: any) => ({
          where: (_cond: any) => ({
            limit: (_n: number) => mockDbSelect(),
          }),
        }),
      }),
      update: (_table: any) => ({
        set: (data: any) => {
          mockDbUpdateSet(data);
          return {
            where: (_cond: any) => ({
              returning: () => mockDbUpdateWhere(),
            }),
          };
        },
      }),
    },
    schema: {
      orders: {
        id: { name: "id" },
        listingId: { name: "listingId" },
        status: { name: "status" },
        createdAt: { name: "createdAt" },
        updatedAt: { name: "updatedAt" },
      },
      listings: {
        id: { name: "id" },
        status: { name: "status" },
        updatedAt: { name: "updatedAt" },
      },
    },
    eq,
    and,
    sql,
  };
});

const { expireIfStale, ORDER_EXPIRY_MINUTES } = await import("../order-lifecycle/expiry.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("expireIfStale", () => {
  it("returns true and releases listing for a pending order that the DB expired", async () => {
    const order = { id: "order_1", listingId: "listing_1", status: "pending" };

    // DB found a stale row and updated it
    mockDbUpdateWhere.mockResolvedValueOnce([{ id: "order_1" }]);

    const result = await expireIfStale(order);

    expect(result).toBe(true);
    expect(mockDbUpdateSet).toHaveBeenCalledWith({
      status: "expired",
      updatedAt: expect.any(Date),
    });
    expect(mockDbUpdateSet).toHaveBeenCalledWith({
      status: "active",
      updatedAt: expect.any(Date),
    });
  });

  it("returns false for a pending order that is not yet stale per DB", async () => {
    const order = { id: "order_1", listingId: "listing_1", status: "pending" };

    // DB did NOT find a stale row
    mockDbUpdateWhere.mockResolvedValueOnce([]);

    const result = await expireIfStale(order);

    expect(result).toBe(false);
    expect(mockDbUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockDbUpdateSet).toHaveBeenCalledWith({
      status: "expired",
      updatedAt: expect.any(Date),
    });
  });

  it("returns false for a non-pending order without touching DB", async () => {
    const order = { id: "order_1", listingId: "listing_1", status: "paid" };

    const result = await expireIfStale(order);

    expect(result).toBe(false);
    expect(mockDbUpdateSet).not.toHaveBeenCalled();
  });
});
