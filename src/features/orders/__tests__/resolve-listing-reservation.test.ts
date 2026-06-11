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

const { resolveListingReservation, expireIfStale, ORDER_EXPIRY_MINUTES } = await import("../expiry.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveListingReservation", () => {
  it("returns the current status for a non-reserved listing (active)", async () => {
    mockDbSelect.mockResolvedValueOnce([{ id: "listing_1", status: "active" }]);

    const result = await resolveListingReservation("listing_1");

    expect(result).toBe("active");
  });

  it("releases an expired reservation and returns active", async () => {
    // 1st select: fetch listing
    mockDbSelect.mockResolvedValueOnce([{ id: "listing_1", status: "reserved" }]);
    // 2nd select: getPendingOrderOnListing
    mockDbSelect.mockResolvedValueOnce([
      { id: "order_1", listingId: "listing_1", status: "pending", createdAt: new Date() },
    ]);

    // update returning: DB found a stale row and updated it
    mockDbUpdateWhere.mockResolvedValueOnce([{ id: "order_1" }]);

    const result = await resolveListingReservation("listing_1");

    expect(result).toBe("active");

    // Verify order was expired
    expect(mockDbUpdateSet).toHaveBeenCalledWith({
      status: "expired",
      updatedAt: expect.any(Date),
    });

    // Verify listing was released
    expect(mockDbUpdateSet).toHaveBeenCalledWith({
      status: "active",
      updatedAt: expect.any(Date),
    });
  });

  it("returns reserved when the pending order has not yet expired", async () => {
    mockDbSelect.mockResolvedValueOnce([{ id: "listing_1", status: "reserved" }]);
    mockDbSelect.mockResolvedValueOnce([
      { id: "order_1", listingId: "listing_1", status: "pending", createdAt: new Date() },
    ]);

    // update returning: DB did NOT find a stale row
    mockDbUpdateWhere.mockResolvedValueOnce([]);

    const result = await resolveListingReservation("listing_1");

    expect(result).toBe("reserved");
    // set() is called for the attempt, but listing release should NOT happen
    expect(mockDbUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockDbUpdateSet).toHaveBeenCalledWith({
      status: "expired",
      updatedAt: expect.any(Date),
    });
  });

  it("passes through non-reserved status unchanged (sold)", async () => {
    mockDbSelect.mockResolvedValueOnce([{ id: "listing_1", status: "sold" }]);

    const result = await resolveListingReservation("listing_1");

    expect(result).toBe("sold");
  });

  it("returns 'not_found' when the listing does not exist", async () => {
    mockDbSelect.mockResolvedValueOnce([]);

    const result = await resolveListingReservation("nonexistent");

    expect(result).toBe("not_found");
  });
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
