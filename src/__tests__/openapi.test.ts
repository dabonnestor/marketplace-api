import { describe, it, expect } from "vitest";
import request from "supertest";
import { getApp } from "./helpers.js";

const app = getApp();

describe("GET /api/docs.json", () => {
  it("returns a valid OpenAPI 3.0 spec with all expected paths", async () => {
    const res = await request(app).get("/api/docs.json");

    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.0.3");
    expect(res.body.info.title).toBe("Marketplace API");

    // All expected paths are present
    const paths = Object.keys(res.body.paths);
    expect(paths).toContain("/api/health");

    // Auth
    expect(paths).toContain("/api/v1/auth/register");
    expect(paths).toContain("/api/v1/auth/login");
    expect(paths).toContain("/api/v1/auth/refresh");
    expect(paths).toContain("/api/v1/auth/me");

    // Listings
    expect(paths).toContain("/api/v1/listings");
    expect(paths).toContain("/api/v1/listings/mine");
    expect(paths).toContain("/api/v1/listings/{id}");

    // Orders
    expect(paths).toContain("/api/v1/orders");
    expect(paths).toContain("/api/v1/orders/buyer/purchases");
    expect(paths).toContain("/api/v1/orders/seller/sales");
    expect(paths).toContain("/api/v1/orders/{id}");
    expect(paths).toContain("/api/v1/orders/{id}/status");
  });

  it("has all expected component schemas", async () => {
    const res = await request(app).get("/api/docs.json");

    const schemas = Object.keys(res.body.components.schemas);
    expect(schemas).toContain("RegisterRequest");
    expect(schemas).toContain("LoginRequest");
    expect(schemas).toContain("RefreshRequest");
    expect(schemas).toContain("CreateListingRequest");
    expect(schemas).toContain("UpdateListingRequest");
    expect(schemas).toContain("CreateOrderRequest");
    expect(schemas).toContain("User");
    expect(schemas).toContain("Error");
    expect(schemas).toContain("Pagination");
    expect(schemas).toContain("Listing");
    expect(schemas).toContain("Order");
  });

  it("has security schemes defined", async () => {
    const res = await request(app).get("/api/docs.json");

    expect(res.body.components.securitySchemes.bearerAuth).toBeDefined();
    expect(res.body.components.securitySchemes.bearerAuth.type).toBe("http");
    expect(res.body.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
  });
});
