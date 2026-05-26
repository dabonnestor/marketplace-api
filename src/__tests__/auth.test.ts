import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { setupDb, cleanDb, closeDb, getApp } from "./helpers.js";

const app = getApp();

beforeAll(async () => {
  await setupDb();
});

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await cleanDb();
});

describe("POST /api/v1/auth/register", () => {
  it("creates a new user and returns tokens", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "test@example.com", password: "password123", name: "Test User" });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe("test@example.com");
    expect(res.body.user.name).toBe("Test User");
    expect(res.body.user).not.toHaveProperty("passwordHash");
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });

  it("rejects duplicate email", async () => {
    await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "test@example.com", password: "password123", name: "Test User" });

    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "test@example.com", password: "password456", name: "Test User 2" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("validates input", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "not-an-email", password: "short" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/v1/auth/login", () => {
  it("logs in with correct credentials", async () => {
    await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "test@example.com", password: "password123", name: "Test User" });

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "test@example.com", password: "password123" });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user.email).toBe("test@example.com");
  });

  it("rejects wrong password", async () => {
    await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "test@example.com", password: "password123", name: "Test User" });

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "test@example.com", password: "wrongpassword" });

    expect(res.status).toBe(401);
  });
});

describe("POST /api/v1/auth/refresh", () => {
  it("returns new tokens with valid refresh token", async () => {
    const register = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "test@example.com", password: "password123", name: "Test User" });

    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: register.body.refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });

  it("rejects invalid refresh token", async () => {
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: "invalid-token" });

    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/auth/me", () => {
  it("returns current user", async () => {
    const register = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "test@example.com", password: "password123", name: "Test User" });

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${register.body.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe("test@example.com");
    expect(res.body.name).toBe("Test User");
    expect(res.body).not.toHaveProperty("passwordHash");
  });

  it("rejects missing token", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
  });
});
