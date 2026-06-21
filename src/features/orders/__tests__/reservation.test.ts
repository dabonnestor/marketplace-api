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

const { isAvailable, getStatus, expireIfStale } = await import("../reservation.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isAvailable", () => {
  it("returns true for an active listing with no pending order", async () => {
    mockDbSelect.mockResolvedValueOnce([{ id: "listing_1", status: "active" }]);

    const result = await isAvailable("listing_1");

    expect(result).toBe(true);
  });

  it("returns false for a reserved listing with a valid pending order", async () => {
    mockDbSelect.mockResolvedValueOnce([{ id: "listing_1", status: "reserved" }]);
    mockDbSelect.mockResolvedValueOnce([
      { id: "order_1", listingId: "listing_1", status: "pending", createdAt: new Date() },
    ]);
    mockDbUpdateWhere.mockResolvedValueOnce([]); // not stale

    const result = await isAvailable("listing_1");

    expect(result).toBe(false);
  });

  it("returns true after lazy-expiring a stale pending order on a reserved listing", async () => {
    mockDbSelect.mockResolvedValueOnce([{ id: "listing_1", status: "reserved" }]);
    mockDbSelect.mockResolvedValueOnce([
      { id: "order_1", listingId: "listing_1", status: "pending", createdAt: new Date() },
    ]);
    mockDbUpdateWhere.mockResolvedValueOnce([{ id: "order_1" }]); // expired

    const result = await isAvailable("listing_1");

    expect(result).toBe(true);
  });

  it("returns false for a non-existent listing", async () => {
    mockDbSelect.mockResolvedValueOnce([]);

    const result = await isAvailable("nonexistent");

    expect(result).toBe(false);
  });

  it("returns false for a sold listing", async () => {
    mockDbSelect.mockResolvedValueOnce([{ id: "listing_1", status: "sold" }]);

    const result = await isAvailable("listing_1");

    expect(result).toBe(false);
  });
});

describe("getStatus", () => {
  it("returns the current status for a non-reserved listing (active)", async () => {
    mockDbSelect.mockResolvedValueOnce([{ id: "listing_1", status: "active" }]);

    const result = await getStatus("listing_1");

    expect(result).toBe("active");
  });

  it("releases an expired reservation and returns active", async () => {
    mockDbSelect.mockResolvedValueOnce([{ id: "listing_1", status: "reserved" }]);
    mockDbSelect.mockResolvedValueOnce([
      { id: "order_1", listingId: "listing_1", status: "pending", createdAt: new Date() },
    ]);
    mockDbUpdateWhere.mockResolvedValueOnce([{ id: "order_1" }]);

    const result = await getStatus("listing_1");

    expect(result).toBe("active");
  });

  it("returns reserved when the pending order has not yet expired", async () => {
    mockDbSelect.mockResolvedValueOnce([{ id: "listing_1", status: "reserved" }]);
    mockDbSelect.mockResolvedValueOnce([
      { id: "order_1", listingId: "listing_1", status: "pending", createdAt: new Date() },
    ]);
    mockDbUpdateWhere.mockResolvedValueOnce([]);

    const result = await getStatus("listing_1");

    expect(result).toBe("reserved");
  });

  it("passes through non-reserved status unchanged (sold)", async () => {
    mockDbSelect.mockResolvedValueOnce([{ id: "listing_1", status: "sold" }]);

    const result = await getStatus("listing_1");

    expect(result).toBe("sold");
  });

  it("returns 'not_found' when the listing does not exist", async () => {
    mockDbSelect.mockResolvedValueOnce([]);

    const result = await getStatus("nonexistent");

    expect(result).toBe("not_found");
  });
});

describe("expireIfStale", () => {
  it("returns true and releases listing for a pending order that the DB expired", async () => {
    const order = { id: "order_1", listingId: "listing_1", status: "pending" };

    mockDbUpdateWhere.mockResolvedValueOnce([{ id: "order_1" }]);

    const result = await expireIfStale(order);

    expect(result).toBe(true);
  });

  it("returns false for a pending order that is not yet stale per DB", async () => {
    const order = { id: "order_1", listingId: "listing_1", status: "pending" };

    mockDbUpdateWhere.mockResolvedValueOnce([]);

    const result = await expireIfStale(order);

    expect(result).toBe(false);
  });

  it("returns false for a non-pending order without touching DB", async () => {
    const order = { id: "order_1", listingId: "listing_1", status: "paid" };

    const result = await expireIfStale(order);

    expect(result).toBe(false);
  });
});
