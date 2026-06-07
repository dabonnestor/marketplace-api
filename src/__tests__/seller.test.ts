import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { setupDb, cleanDb, closeDb, getApp } from "./helpers.js";

const { mockAccountCreate, mockAccountLinkCreate, mockAccountRetrieve } = vi.hoisted(() => ({
  mockAccountCreate: vi.fn().mockResolvedValue({ id: "acct_test123" }),
  mockAccountLinkCreate: vi.fn().mockResolvedValue({ url: "https://connect.stripe.com/setup/test" }),
  mockAccountRetrieve: vi.fn().mockResolvedValue({
    id: "acct_test123",
    charges_enabled: true,
    payouts_enabled: false,
  }),
}));

vi.mock("../features/payments/stripe-client.js", () => ({
  stripe: {
    accounts: {
      create: mockAccountCreate,
      retrieve: mockAccountRetrieve,
    },
    accountLinks: {
      create: mockAccountLinkCreate,
    },
  },
}));

const app = getApp();

beforeAll(async () => {
  await setupDb();
});

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await cleanDb();
  vi.clearAllMocks();
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
    expect(res.body.url).toBe("https://connect.stripe.com/setup/test");

    expect(mockAccountCreate).toHaveBeenCalledWith({
      type: "express",
      capabilities: {
        transfers: { requested: true },
        card_payments: { requested: true },
      },
    });

    expect(mockAccountLinkCreate).toHaveBeenCalledWith({
      account: "acct_test123",
      refresh_url: expect.stringContaining("/dashboard/seller/onboard"),
      return_url: expect.stringContaining("/dashboard/seller/onboard"),
      type: "account_onboarding",
    });
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
    expect(mockAccountCreate).toHaveBeenCalledTimes(1);

    const second = await request(app)
      .post("/api/v1/seller/onboard")
      .set("Authorization", token);

    expect(second.status).toBe(200);
    expect(second.body.url).toBe("https://connect.stripe.com/setup/test");
    // Should not create a second Stripe account
    expect(mockAccountCreate).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/v1/seller/onboard/status", () => {
  it("returns onboarded status with Stripe account fields", async () => {
    const register = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "seller@example.com", password: "password123", name: "Test Seller" });
    const token = `Bearer ${register.body.accessToken}`;

    // First onboard the seller
    await request(app)
      .post("/api/v1/seller/onboard")
      .set("Authorization", token);

    const res = await request(app)
      .get("/api/v1/seller/onboard/status")
      .set("Authorization", token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      onboarded: true,
      chargesEnabled: true,
      payoutsEnabled: false,
    });
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
