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
    expect(paths).toContain("/api/v1/orders/{id}/refund");
    expect(paths).toContain("/api/v1/orders/{id}/pay");
    expect(paths).toContain("/api/v1/orders/{id}/cancel");

    // Seller
    expect(paths).toContain("/api/v1/seller/onboard");
    expect(paths).toContain("/api/v1/seller/onboard/status");

    // Webhooks
    expect(paths).toContain("/api/v1/webhooks/stripe");
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
    expect(schemas).toContain("OnboardResponse");
    expect(schemas).toContain("OnboardStatus");
  });

  it("has security schemes defined", async () => {
    const res = await request(app).get("/api/docs.json");

    expect(res.body.components.securitySchemes.bearerAuth).toBeDefined();
    expect(res.body.components.securitySchemes.bearerAuth.type).toBe("http");
    expect(res.body.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
  });

  it("Order schema includes all Stripe-related fields", async () => {
    const res = await request(app).get("/api/docs.json");

    const order = res.body.components.schemas.Order;
    expect(order).toBeDefined();
    expect(order.properties.preDisputeStatus).toBeDefined();
    expect(order.properties.stripePaymentIntentId).toBeDefined();
    expect(order.properties.stripeTransferId).toBeDefined();
    expect(order.properties.stripeRefundId).toBeDefined();
    expect(order.properties.refundedAt).toBeDefined();
    expect(order.properties.clientSecret).toBeUndefined();
  });

  it("OrderCreated schema includes clientSecret for create order response", async () => {
    const res = await request(app).get("/api/docs.json");

    const schemas = Object.keys(res.body.components.schemas);
    expect(schemas).toContain("OrderCreated");

    const orderCreated = res.body.components.schemas.OrderCreated;
    expect(orderCreated.properties.clientSecret).toBeDefined();
    expect(orderCreated.properties.clientSecret.type).toBe("string");
    expect(orderCreated.properties.stripePaymentIntentId).toBeDefined();
  });

  it("POST /orders 201 response references OrderCreated schema", async () => {
    const res = await request(app).get("/api/docs.json");

    const createOrder = res.body.paths["/api/v1/orders"].post;
    const ref = createOrder.responses["201"].content["application/json"].schema.$ref;
    expect(ref).toBe("#/components/schemas/OrderCreated");
  });

  it("Listing schema includes reserved in status enum", async () => {
    const res = await request(app).get("/api/docs.json");

    const listing = res.body.components.schemas.Listing;
    expect(listing.properties.status.enum).toBeDefined();
    expect(listing.properties.status.enum).toContain("reserved");
    expect(listing.properties.status.enum).toContain("active");
  });

  it("PATCH /orders/:id/status enum excludes paid, cancelled, refunded", async () => {
    const res = await request(app).get("/api/docs.json");

    const statusPath = res.body.paths["/api/v1/orders/{id}/status"].patch;
    const statusEnum = statusPath.requestBody.content["application/json"].schema.properties.status.enum;
    expect(statusEnum).not.toContain("paid");
    expect(statusEnum).not.toContain("cancelled");
    expect(statusEnum).not.toContain("refunded");
    expect(statusEnum).toContain("shipped");
    expect(statusEnum).toContain("delivered");
    expect(statusEnum).toContain("completed");
    expect(statusEnum).toContain("disputed");
    expect(statusPath.description).toMatch(/paid.*cancelled|dedicated endpoint/i);
  });

  it("webhook endpoint describes Stripe signature verification", async () => {
    const res = await request(app).get("/api/docs.json");

    const webhook = res.body.paths["/api/v1/webhooks/stripe"].post;
    expect(webhook.description).toMatch(/signature/i);
    expect(webhook.security).toEqual([]);
  });

  it("pay endpoint documents payment error response codes", async () => {
    const res = await request(app).get("/api/docs.json");

    const pay = res.body.paths["/api/v1/orders/{id}/pay"].post;
    expect(pay).toBeDefined();
    expect(pay.responses["402"]).toBeDefined();
    expect(pay.responses["402"].description).toMatch(/PAYMENT_FAILED|payment failed/i);
    expect(pay.responses["502"]).toBeDefined();
    expect(pay.responses["502"].description).toMatch(/PAYMENT_SERVICE_UNAVAILABLE|payment service/i);
  });
});
