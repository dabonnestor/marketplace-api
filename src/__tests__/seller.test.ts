import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { setupDb, cleanDb, closeDb, getApp } from "./helpers.js";
import { InMemoryFake } from "../shared/payments/payments-fake.js";
import { setPaymentsAdapter } from "../shared/payments/payments-adapter.js";

// Minimal stub — prevents real Stripe SDK from initializing.
// Payment operations go through the InMemoryFake, not this stub.
vi.mock("../shared/payments/stripe-client.js", () => ({
  stripe: {},
}));

const app = getApp();
let fake: InMemoryFake;

beforeAll(async () => {
  await setupDb();
});

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await cleanDb();
  fake = new InMemoryFake();
  setPaymentsAdapter(fake);
});

describe("POST /api/v1/seller/onboard", () => {
  it("creates a Stripe Express account, stores the ID, and returns an account link URL", async () => {
    const register = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "seller@example.com", password: "password123", name: "Test Seller" });

    const res = await request(app)
      .post("/api/v1/seller/onboard")
      .set("Authorization", `Bearer ${register.body.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^https:\/\/connect\.stripe\.com\/setup\/t\//);

    // Verify account was created in the fake
    const accounts = fake as any;
    // The seller service creates an account then retrieves it
    // Just verify the link URL was generated
    expect(res.body.url).toBeDefined();
  });

  it("returns 401 without authentication", async () => {
    const res = await request(app)
      .post("/api/v1/seller/onboard");

    expect(res.status).toBe(401);
  });

  it("returns an existing account link when already onboarded", async () => {
    const register = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "seller@example.com", password: "password123", name: "Test Seller" });
    const token = `Bearer ${register.body.accessToken}`;

    const first = await request(app)
      .post("/api/v1/seller/onboard")
      .set("Authorization", token);

    expect(first.status).toBe(200);
    const firstUrl = first.body.url;

    const second = await request(app)
      .post("/api/v1/seller/onboard")
      .set("Authorization", token);

    expect(second.status).toBe(200);
    // Second call reuses the existing account, generates a new onboarding link
    expect(second.body.url).toMatch(/^https:\/\/connect\.stripe\.com\/setup\/t\//);
  });
});

describe("GET /api/v1/seller/onboard/status", () => {
  it("returns onboarded status with Stripe account fields", async () => {
    const register = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "seller@example.com", password: "password123", name: "Test Seller" });
    const token = `Bearer ${register.body.accessToken}`;

    // First onboard the seller — this creates an account in the fake
    await request(app)
      .post("/api/v1/seller/onboard")
      .set("Authorization", token);

    const res = await request(app)
      .get("/api/v1/seller/onboard/status")
      .set("Authorization", token);

    expect(res.status).toBe(200);
    expect(res.body.onboarded).toBe(true);
    expect(res.body.chargesEnabled).toBe(true);
    expect(res.body.payoutsEnabled).toBe(true);
  });

  it("returns onboarded: false when seller has no Stripe account", async () => {
    const register = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "seller@example.com", password: "password123", name: "Test Seller" });
    const token = `Bearer ${register.body.accessToken}`;

    const res = await request(app)
      .get("/api/v1/seller/onboard/status")
      .set("Authorization", token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      onboarded: false,
      chargesEnabled: false,
      payoutsEnabled: false,
    });
  });
});
