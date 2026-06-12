import { describe, it, expect } from "vitest";
import { transition } from "../order-lifecycle/state-machine.js";
import type { OrderStatus } from "../order-lifecycle/state-machine.js";

describe("transition (state machine)", () => {
  it("allows valid transitions", () => {
    expect(transition("pending", "paid").allowed).toBe(true);
    expect(transition("pending", "cancelled").allowed).toBe(true);
    expect(transition("pending", "expired").allowed).toBe(true);
    expect(transition("paid", "shipped").allowed).toBe(true);
    expect(transition("paid", "disputed").allowed).toBe(true);
    expect(transition("paid", "refunded").allowed).toBe(true);
    expect(transition("shipped", "delivered").allowed).toBe(true);
    expect(transition("delivered", "completed").allowed).toBe(true);
    expect(transition("disputed", "refunded").allowed).toBe(true);
  });

  it("allows dispute recovery (disputed → preDisputeStatus)", () => {
    const result = transition("disputed" as OrderStatus, "paid", undefined, "paid");
    expect(result.allowed).toBe(true);
  });

  it("rejects invalid transitions", () => {
    const result = transition("completed" as OrderStatus, "paid");
    expect(result.allowed).toBe(false);
    expect(result.error).toBe("Cannot transition order from 'completed' to 'paid'");
    expect(result.errorCode).toBe("INVALID_TRANSITION");
  });

  it("rejects role-restricted transitions for wrong role", () => {
    const result = transition("paid" as OrderStatus, "shipped", "buyer");
    expect(result.allowed).toBe(false);
    expect(result.error).toBe("Only the seller can mark the order as shipped");
    expect(result.errorCode).toBe("FORBIDDEN");
  });

  it("allows role-restricted transitions for correct role", () => {
    const result = transition("paid" as OrderStatus, "shipped", "seller");
    expect(result.allowed).toBe(true);
    expect(result.timestampField).toBe("shippedAt");
  });

  it("sets timestampField for timestamped statuses", () => {
    expect(transition("pending", "paid").timestampField).toBe("paidAt");
    expect(transition("paid", "shipped").timestampField).toBe("shippedAt");
    expect(transition("shipped", "delivered").timestampField).toBe("deliveredAt");
    expect(transition("delivered", "completed").timestampField).toBe("completedAt");
    expect(transition("paid", "refunded").timestampField).toBe("refundedAt");
  });

  it("skips role check when no role is provided (system call)", () => {
    const result = transition("paid" as OrderStatus, "shipped");
    expect(result.allowed).toBe(true);
  });
});
