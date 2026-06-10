import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReturningFn = vi.fn();
const mockUpdateSetData = vi.fn();

vi.mock("../../../db/index.js", () => {
  const eq = (a: any, b: any) => ({ type: "eq", left: a, right: b });
  const and = (...args: any[]) => ({ type: "and", args });
  const lt = (a: any, b: any) => ({ type: "lt", left: a, right: b });
  return {
    db: {
      select: () => ({
        from: (_table: any) => ({
          where: (_cond: any) => ({
            limit: (_n: number) => ({
              then: (resolve: any) => resolve(mockReturningFn()),
            }),
          }),
        }),
      }),
      update: (_table: any) => ({
        set: (data: any) => {
          mockUpdateSetData(data);
          return {
            where: (_cond: any) => ({
              returning: () => mockReturningFn(),
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
    lt,
  };
});

const { resolveListingReservation, expireIfStale } = await import("../expiry.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveListingReservation", () => {
  it("returns the current status for a non-reserved listing (active)", async () => {
    mockReturningFn.mockResolvedValueOnce([{ id: "listing_1", status: "active" }]);

    const result = await resolveListingReservation("listing_1");

    expect(result).toBe("active");
  });

  it("releases an expired reservation when the atomic update succeeds", async () => {
    // 1st select: fetch listing (reserved)
    mockReturningFn.mockResolvedValueOnce([{ id: "listing_1", status: "reserved" }]);
    // 2nd select: getPendingOrderOnListing
    mockReturningFn.mockResolvedValueOnce([
      { id: "order_1", listingId: "listing_1", status: "pending" },
    ]);
    // Atomic update: returning() returns the expired order
    mockReturningFn.mockResolvedValueOnce([{ id: "order_1" }]);

    const result = await resolveListingReservation("listing_1");

    expect(result).toBe("active");
    expect(mockUpdateSetData).toHaveBeenCalledWith({
      status: "expired",
      updatedAt: expect.any(Date),
    });
    expect(mockUpdateSetData).toHaveBeenCalledWith({
      status: "active",
      updatedAt: expect.any(Date),
    });
  });

  it("returns reserved when the atomic update does not match (order not stale)", async () => {
    mockReturningFn.mockResolvedValueOnce([{ id: "listing_1", status: "reserved" }]);
    mockReturningFn.mockResolvedValueOnce([
      { id: "order_1", listingId: "listing_1", status: "pending" },
    ]);
    // Atomic update returns empty — order not expired per DB clock
    mockReturningFn.mockResolvedValueOnce([]);

    const result = await resolveListingReservation("listing_1");

    expect(result).toBe("reserved");
  });

  it("passes through non-reserved status unchanged (sold)", async () => {
    mockReturningFn.mockResolvedValueOnce([{ id: "listing_1", status: "sold" }]);

    const result = await resolveListingReservation("listing_1");

    expect(result).toBe("sold");
  });

  it("returns 'not_found' when the listing does not exist", async () => {
    mockReturningFn.mockResolvedValueOnce([]);

    const result = await resolveListingReservation("nonexistent");

    expect(result).toBe("not_found");
  });
});

describe("expireIfStale", () => {
  it("returns true when the atomic update matches (order is pending and stale per DB)", async () => {
    mockReturningFn.mockResolvedValueOnce([{ id: "order_1" }]);

    const order = { id: "order_1", listingId: "listing_1", status: "pending" };
    const result = await expireIfStale(order);

    expect(result).toBe(true);
    expect(mockUpdateSetData).toHaveBeenCalledWith({
      status: "expired",
      updatedAt: expect.any(Date),
    });
    expect(mockUpdateSetData).toHaveBeenCalledWith({
      status: "active",
      updatedAt: expect.any(Date),
    });
  });

  it("returns false when the atomic update does not match (not stale per DB)", async () => {
    mockReturningFn.mockResolvedValueOnce([]);

    const order = { id: "order_1", listingId: "listing_1", status: "pending" };
    const result = await expireIfStale(order);

    expect(result).toBe(false);
  });

  it("returns false for a non-pending order without touching the DB", async () => {
    const order = { id: "order_1", listingId: "listing_1", status: "paid" };
    const result = await expireIfStale(order);

    expect(result).toBe(false);
    expect(mockReturningFn).not.toHaveBeenCalled();
  });
});
