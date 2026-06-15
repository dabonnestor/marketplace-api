import { describe, it, expect } from "vitest";
import { transition } from "../order-lifecycle/state-machine.js";

describe("OrderStateMachine.transition", () => {
  it("allows pending → paid by buyer", () => {
    const result = transition("pending", "paid", "buyer");

    expect(result.allowed).toBe(true);
    expect(result.timestampField).toBe("paidAt");
  });

  it("rejects pending → delivered", () => {
    const result = transition("pending", "delivered", "buyer");

    expect(result.allowed).toBe(false);
    expect(result.error).toContain("Cannot transition");
  });

  it("rejects any transition from completed (terminal)", () => {
    const result = transition("completed", "disputed", "buyer");

    expect(result.allowed).toBe(false);
    expect(result.error).toContain("Cannot transition");
  });

  it("rejects any transition from cancelled (terminal)", () => {
    const result = transition("cancelled", "paid", "buyer");

    expect(result.allowed).toBe(false);
    expect(result.error).toContain("Cannot transition");
  });

  it("rejects pending → paid by seller (only buyer can)", () => {
    const result = transition("pending", "paid", "seller");

    expect(result.allowed).toBe(false);
    expect(result.error).toContain("Only the buyer");
  });

  it("rejects paid → shipped by buyer (only seller can)", () => {
    const result = transition("paid", "shipped", "buyer");

    expect(result.allowed).toBe(false);
    expect(result.error).toContain("Only the seller");
  });

  it("allows paid → disputed by buyer (no role restriction)", () => {
    const result = transition("paid", "disputed", "buyer");

    expect(result.allowed).toBe(true);
  });

  it("rejects pending → cancelled by seller (buyer only)", () => {
    const result = transition("pending", "cancelled", "seller");

    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("FORBIDDEN");
  });

  it("allows shipped → disputed by buyer (no role restriction)", () => {
    const result = transition("shipped", "disputed", "buyer");

    expect(result.allowed).toBe(true);
  });

  it("allows delivered → disputed by seller (no role restriction)", () => {
    const result = transition("delivered", "disputed", "seller");

    expect(result.allowed).toBe(true);
  });

  it("rejects any transition from expired (terminal)", () => {
    const result = transition("expired", "paid", "buyer");

    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("INVALID_TRANSITION");
  });

  it("rejects any transition from refunded (terminal)", () => {
    const result = transition("refunded", "disputed", "buyer");

    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("INVALID_TRANSITION");
  });

  it("allows pending → expired by buyer (no role restriction)", () => {
    const result = transition("pending", "expired", "buyer");

    expect(result.allowed).toBe(true);
  });

  it("allows pending → expired by seller (no role restriction)", () => {
    const result = transition("pending", "expired", "seller");

    expect(result.allowed).toBe(true);
  });

  it("allows paid → refunded by buyer", () => {
    const result = transition("paid", "refunded", "buyer");

    expect(result.allowed).toBe(true);
    expect(result.timestampField).toBe("refundedAt");
  });

  it("rejects paid → refunded by seller", () => {
    const result = transition("paid", "refunded", "seller");

    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("FORBIDDEN");
  });

  it("allows shipped → refunded by buyer", () => {
    const result = transition("shipped", "refunded", "buyer");

    expect(result.allowed).toBe(true);
  });

  it("rejects shipped → refunded by seller", () => {
    const result = transition("shipped", "refunded", "seller");

    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("FORBIDDEN");
  });

  it("allows delivered → refunded by buyer", () => {
    const result = transition("delivered", "refunded", "buyer");

    expect(result.allowed).toBe(true);
  });

  it("rejects delivered → refunded by seller", () => {
    const result = transition("delivered", "refunded", "seller");

    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("FORBIDDEN");
  });

  it("allows disputed → refunded (no role restriction)", () => {
    const result = transition("disputed", "refunded", "buyer");

    expect(result.allowed).toBe(true);
  });

  it("rejects disputed → cancelled (removed)", () => {
    const result = transition("disputed", "cancelled", "buyer");

    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("INVALID_TRANSITION");
  });

  it("allows disputed → paid when preDisputeStatus is paid", () => {
    const result = transition("disputed", "paid", "buyer", "paid");

    expect(result.allowed).toBe(true);
  });

  it("rejects disputed → paid when preDisputeStatus is shipped (mismatch)", () => {
    const result = transition("disputed", "paid", "buyer", "shipped");

    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("INVALID_TRANSITION");
  });

  it("allows disputed → pre_dispute_status by any role", () => {
    const result = transition("disputed", "delivered", "seller", "delivered");

    expect(result.allowed).toBe(true);
  });
});
