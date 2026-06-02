import { describe, it, expect } from "vitest";
import Stripe from "stripe";
import { stripe } from "../stripe-client.js";

describe("stripe client", () => {
  it("is a Stripe instance", () => {
    expect(stripe).toBeInstanceOf(Stripe);
  });

  it("is a singleton (same reference on re-import)", async () => {
    const mod = await import("../stripe-client.js");
    expect(mod.stripe).toBe(stripe);
  });
});
