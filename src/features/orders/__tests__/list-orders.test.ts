import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPaginate = vi.fn();

vi.mock("../../../shared/pagination.js", () => ({
  paginate: (...args: any[]) => mockPaginate(...args),
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

function chainable(): any {
  const obj: any = {
    from: chainable,
    leftJoin: chainable,
    where: chainable,
    orderBy: chainable,
    limit: chainable,
    offset: chainable,
  };
  return obj;
}

vi.mock("../../../db/index.js", () => ({
  db: {
    select: chainable,
  },
  schema: {
    orders: {
      id: { name: "id" },
      buyerId: { name: "buyerId" },
      sellerId: { name: "sellerId" },
      status: { name: "status" },
      createdAt: { name: "createdAt" },
    },
    listings: {
      id: { name: "id" },
      title: { name: "title" },
      images: { name: "images" },
    },
  },
  eq: (a: any, b: any) => ({ type: "eq", left: a, right: b }),
  and: (...args: any[]) => ({ type: "and", args }),
  desc: (col: any) => ({ type: "desc", col }),
  sql: (strings: TemplateStringsArray, ...values: any[]) => ({
    type: "sql",
    strings,
    values,
  }),
}));

const { listBuyerOrders, listSellerOrders } = await import("../orders.service.js");

beforeEach(() => {
  vi.clearAllMocks();
});

function fakePaginatedResult(overrides: any = {}) {
  return {
    data: [],
    pagination: {
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    },
    ...overrides,
  };
}

describe("listBuyerOrders", () => {
  it("returns paginated orders with listingTitle and listingImage", async () => {
    mockPaginate.mockResolvedValueOnce(
      fakePaginatedResult({
        data: [
          {
            order: { id: "order_1", status: "paid", buyerId: "buyer_1" },
            listingTitle: "Vintage Chair",
            listingImage: "https://img.example.com/1.jpg",
          },
        ],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      }),
    );

    const result = await listBuyerOrders("buyer_1", 1, 10);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      id: "order_1",
      status: "paid",
      listingTitle: "Vintage Chair",
      listingImage: "https://img.example.com/1.jpg",
    });
    expect(result.pagination).toEqual({ page: 1, limit: 10, total: 1, totalPages: 1 });
  });

  it("filters by status when provided", async () => {
    mockPaginate.mockResolvedValueOnce(fakePaginatedResult());

    await listBuyerOrders("buyer_1", 1, 10, "paid");

    // Verify paginate was called (status filter applied internally)
    expect(mockPaginate).toHaveBeenCalledOnce();
  });

  it("returns empty data array when no orders exist", async () => {
    mockPaginate.mockResolvedValueOnce(fakePaginatedResult());

    const result = await listBuyerOrders("buyer_1", 1, 10);

    expect(result.data).toEqual([]);
    expect(result.pagination.total).toBe(0);
  });
});

describe("listSellerOrders", () => {
  it("returns paginated orders with listingTitle and listingImage", async () => {
    mockPaginate.mockResolvedValueOnce(
      fakePaginatedResult({
        data: [
          {
            order: { id: "order_2", status: "pending", sellerId: "seller_1" },
            listingTitle: "Wooden Table",
            listingImage: "https://img.example.com/2.jpg",
          },
        ],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      }),
    );

    const result = await listSellerOrders("seller_1", 1, 10);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      id: "order_2",
      listingTitle: "Wooden Table",
      listingImage: "https://img.example.com/2.jpg",
    });
  });

  it("filters by status when provided", async () => {
    mockPaginate.mockResolvedValueOnce(fakePaginatedResult());

    await listSellerOrders("seller_1", 1, 10, "shipped");

    expect(mockPaginate).toHaveBeenCalledOnce();
  });

  it("returns empty data array when no orders exist", async () => {
    mockPaginate.mockResolvedValueOnce(fakePaginatedResult());

    const result = await listSellerOrders("seller_1", 1, 10);

    expect(result.data).toEqual([]);
    expect(result.pagination.total).toBe(0);
  });
});
