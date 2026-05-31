import { describe, it, expect } from "vitest";
import { transition } from "../state-machine.js";

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

  it("allows pending → cancelled by seller (no role restriction)", () => {
    const result = transition("pending", "cancelled", "seller");

    expect(result.allowed).toBe(true);
  });

  it("allows shipped → disputed by buyer (no role restriction)", () => {
    const result = transition("shipped", "disputed", "buyer");

    expect(result.allowed).toBe(true);
  });

  it("allows delivered → disputed by seller (no role restriction)", () => {
    const result = transition("delivered", "disputed", "seller");

    expect(result.allowed).toBe(true);
  });
});
