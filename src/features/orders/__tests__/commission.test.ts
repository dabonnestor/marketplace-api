import { describe, it, expect } from "vitest";
import { calculateOrderBreakdown } from "../commission.js";

describe("calculateOrderBreakdown", () => {
  it("calculates 10% platform fee, total, and seller payout from subtotal and shipping", () => {
    const result = calculateOrderBreakdown(100, 5);

    expect(result.platformFee).toBe("10.00");
    expect(result.total).toBe("105.00");
    expect(result.sellerPayout).toBe("95.00");
  });

  it("rounds platform fee to 2 decimal places (rounds up)", () => {
    const result = calculateOrderBreakdown(19.99, 0);

    // 10% of 19.99 = 1.999 → Math.round(1.999 * 100) / 100 = 2.00
    expect(result.platformFee).toBe("2.00");
  });

  it("rounds platform fee to 2 decimal places (rounds down)", () => {
    const result = calculateOrderBreakdown(19.94, 0);

    // 10% of 19.94 = 1.994 → Math.round(1.994 * 100) / 100 = 1.99
    expect(result.platformFee).toBe("1.99");
  });

  it("handles zero shipping cost", () => {
    const result = calculateOrderBreakdown(50, 0);

    expect(result.platformFee).toBe("5.00");
    expect(result.total).toBe("50.00");
    expect(result.sellerPayout).toBe("45.00");
  });

  it("handles zero subtotal", () => {
    const result = calculateOrderBreakdown(0, 10);

    expect(result.platformFee).toBe("0.00");
    expect(result.total).toBe("10.00");
    expect(result.sellerPayout).toBe("10.00");
  });

  it("handles large amounts", () => {
    const result = calculateOrderBreakdown(9999.99, 50);

    expect(result.platformFee).toBe("1000.00");
    expect(result.total).toBe("10049.99");
    expect(result.sellerPayout).toBe("9049.99");
  });

  it("returns all outputs as strings", () => {
    const result = calculateOrderBreakdown(100, 5);

    expect(typeof result.platformFee).toBe("string");
    expect(typeof result.total).toBe("string");
    expect(typeof result.sellerPayout).toBe("string");
  });
});
