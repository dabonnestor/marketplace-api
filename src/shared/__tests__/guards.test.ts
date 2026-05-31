import { describe, it, expect } from "vitest";
import { ensureOwner, ensureParticipant } from "../guards.js";

describe("ensureOwner", () => {
  it("does nothing when the resource owner matches the user", () => {
    const resource = { sellerId: "user-1" };
    expect(() => ensureOwner(resource, "user-1")).not.toThrow();
  });

  it("throws ForbiddenError when the resource owner does not match the user", () => {
    const resource = { sellerId: "user-1" };
    expect(() => ensureOwner(resource, "user-2")).toThrow();
  });

  it("throws with a descriptive message", () => {
    const resource = { sellerId: "user-1" };
    try {
      ensureOwner(resource, "user-2");
      expect.unreachable("should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe("FORBIDDEN");
    }
  });
});

describe("ensureParticipant", () => {
  it("does nothing when user is the buyer", () => {
    const order = { buyerId: "buyer-1", sellerId: "seller-1" };
    expect(() => ensureParticipant(order, "buyer-1")).not.toThrow();
  });

  it("does nothing when user is the seller", () => {
    const order = { buyerId: "buyer-1", sellerId: "seller-1" };
    expect(() => ensureParticipant(order, "seller-1")).not.toThrow();
  });

  it("throws ForbiddenError when user is neither buyer nor seller", () => {
    const order = { buyerId: "buyer-1", sellerId: "seller-1" };
    expect(() => ensureParticipant(order, "stranger")).toThrow();
  });

  it("throws with a descriptive message for non-participant", () => {
    const order = { buyerId: "buyer-1", sellerId: "seller-1" };
    try {
      ensureParticipant(order, "stranger");
      expect.unreachable("should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe("FORBIDDEN");
    }
  });
});
