import { describe, it, expect } from "vitest";
import { toCents, fromCents } from "../amount-utils.js";

describe("toCents", () => {
  it('converts "100.00" to 10000', () => {
    expect(toCents("100.00")).toBe(10000);
  });

  it('converts "0.01" to 1', () => {
    expect(toCents("0.01")).toBe(1);
  });

  it('converts "0.99" to 99', () => {
    expect(toCents("0.99")).toBe(99);
  });

  it('converts "9.99" to 999', () => {
    expect(toCents("9.99")).toBe(999);
  });

  it('converts "0" to 0', () => {
    expect(toCents("0")).toBe(0);
  });

  it('converts "0.00" to 0', () => {
    expect(toCents("0.00")).toBe(0);
  });

  it("throws on more than 2 decimal places", () => {
    expect(() => toCents("0.001")).toThrow();
  });

  it("throws on non-numeric string", () => {
    expect(() => toCents("abc")).toThrow();
  });

  it("throws on empty string", () => {
    expect(() => toCents("")).toThrow();
  });
});

describe("fromCents", () => {
  it("converts 10000 to '100.00'", () => {
    expect(fromCents(10000)).toBe("100.00");
  });

  it("converts 1 to '0.01'", () => {
    expect(fromCents(1)).toBe("0.01");
  });

  it("converts 99 to '0.99'", () => {
    expect(fromCents(99)).toBe("0.99");
  });

  it("converts 0 to '0.00'", () => {
    expect(fromCents(0)).toBe("0.00");
  });

  it("converts 100000 to '1000.00'", () => {
    expect(fromCents(100000)).toBe("1000.00");
  });
});
