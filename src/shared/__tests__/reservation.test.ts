import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDbSelect = vi.fn();
const mockDbUpdateSet = vi.fn();
const mockDbUpdateWhere = vi.fn();

vi.mock("../../db/index.js", () => {
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

const { resolveListingStatus } = await import("../reservation.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveListingStatus", () => {
  it("returns the current status for a non-reserved listing (active)", async () => {
    mockDbSelect.mockResolvedValueOnce([{ id: "listing_1", status: "active" }]);

    const result = await resolveListingStatus("listing_1");

    expect(result).toBe("active");
  });

  it("releases an expired reservation and returns active", async () => {
    mockDbSelect.mockResolvedValueOnce([{ id: "listing_1", status: "reserved" }]);
    mockDbSelect.mockResolvedValueOnce([
      { id: "order_1", listingId: "listing_1", status: "pending", createdAt: new Date() },
    ]);

    mockDbUpdateWhere.mockResolvedValueOnce([{ id: "order_1" }]);

    const result = await resolveListingStatus("listing_1");

    expect(result).toBe("active");

    expect(mockDbUpdateSet).toHaveBeenCalledWith({
      status: "expired",
      updatedAt: expect.any(Date),
    });
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

    mockDbUpdateWhere.mockResolvedValueOnce([]);

    const result = await resolveListingStatus("listing_1");

    expect(result).toBe("reserved");
    expect(mockDbUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockDbUpdateSet).toHaveBeenCalledWith({
      status: "expired",
      updatedAt: expect.any(Date),
    });
  });

  it("passes through non-reserved status unchanged (sold)", async () => {
    mockDbSelect.mockResolvedValueOnce([{ id: "listing_1", status: "sold" }]);

    const result = await resolveListingStatus("listing_1");

    expect(result).toBe("sold");
  });

  it("returns 'not_found' when the listing does not exist", async () => {
    mockDbSelect.mockResolvedValueOnce([]);

    const result = await resolveListingStatus("nonexistent");

    expect(result).toBe("not_found");
  });
});
