import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDbSelect = vi.fn();
const mockDbUpdateSet = vi.fn();
const mockDbUpdateWhere = vi.fn();

vi.mock("../../../db/index.js", () => {
  const eq = (a: any, b: any) => ({ type: "eq", left: a, right: b });
  const and = (...args: any[]) => ({ type: "and", args });
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
            where: (_cond: any) => mockDbUpdateWhere(),
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
  };
});

const { resolveListingReservation, expireIfStale, ORDER_EXPIRY_MS } = await import("../expiry.js");

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
    const now = Date.now();
    const expiredDate = new Date(now - ORDER_EXPIRY_MS - 1000);

    // 1st select: fetch listing
    mockDbSelect.mockResolvedValueOnce([{ id: "listing_1", status: "reserved" }]);
    // 2nd select: getPendingOrderOnListing
    mockDbSelect.mockResolvedValueOnce([
      { id: "order_1", listingId: "listing_1", status: "pending", createdAt: expiredDate },
    ]);

    // update mocks
    mockDbUpdateWhere.mockResolvedValue(undefined);

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
    const now = Date.now();
    const freshDate = new Date(now - 60_000); // 1 minute ago — well within 30 min window

    mockDbSelect.mockResolvedValueOnce([{ id: "listing_1", status: "reserved" }]);
    mockDbSelect.mockResolvedValueOnce([
      { id: "order_1", listingId: "listing_1", status: "pending", createdAt: freshDate },
    ]);

    const result = await resolveListingReservation("listing_1");

    expect(result).toBe("reserved");
    // No updates should have been triggered
    expect(mockDbUpdateSet).not.toHaveBeenCalled();
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
  it("releases and returns true for a pending order that has expired", async () => {
    const now = Date.now();
    const expiredDate = new Date(now - ORDER_EXPIRY_MS - 1000);
    const order = { id: "order_1", listingId: "listing_1", status: "pending", createdAt: expiredDate };

    mockDbUpdateWhere.mockResolvedValue(undefined);

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

  it("returns false for a pending order that has not yet expired", async () => {
    const now = Date.now();
    const freshDate = new Date(now - 60_000);
    const order = { id: "order_1", listingId: "listing_1", status: "pending", createdAt: freshDate };

    const result = await expireIfStale(order);

    expect(result).toBe(false);
    expect(mockDbUpdateSet).not.toHaveBeenCalled();
  });

  it("returns false for a non-pending order even if old", async () => {
    const now = Date.now();
    const oldDate = new Date(now - ORDER_EXPIRY_MS - 1000);
    const order = { id: "order_1", listingId: "listing_1", status: "paid", createdAt: oldDate };

    const result = await expireIfStale(order);

    expect(result).toBe(false);
    expect(mockDbUpdateSet).not.toHaveBeenCalled();
  });
});
