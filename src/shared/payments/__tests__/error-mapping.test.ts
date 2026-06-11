import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";
import { mapStripeError } from "../error-mapping.js";
import { AppError } from "../../errors.js";

// Mock logger so we can assert logging without side effects
vi.mock("../../logger.js", () => ({
  logger: { error: vi.fn() },
}));

let logger: { error: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  const mod = await import("../../logger.js");
  logger = mod.logger as unknown as { error: ReturnType<typeof vi.fn> };
  logger.error.mockClear();
});

function asAppError(err: Error): AppError {
  return err as AppError;
}

describe("mapStripeError", () => {
  it("maps StripeCardError to 402 PAYMENT_FAILED with decline reason", () => {
    const stripeErr = new Stripe.errors.StripeCardError({
      message: "Your card was declined.",
      type: "card_error",
      code: "card_declined",
      decline_code: "insufficient_funds",
      statusCode: 402,
      requestId: "req_abc123",
    } as any);

    const result = asAppError(mapStripeError(stripeErr));

    expect(result).toBeInstanceOf(AppError);
    expect(result.statusCode).toBe(402);
    expect(result.code).toBe("PAYMENT_FAILED");
    expect(result.message).toContain("insufficient_funds");
  });

  it("falls back to 'declined' when decline_code is missing", () => {
    const stripeErr = new Stripe.errors.StripeCardError({
      message: "Your card was declined.",
      type: "card_error",
      code: "card_declined",
      statusCode: 402,
    } as any);

    const result = asAppError(mapStripeError(stripeErr));

    expect(result.code).toBe("PAYMENT_FAILED");
    expect(result.message).toContain("declined");
  });

  it("maps StripeAPIError to 502 PAYMENT_SERVICE_UNAVAILABLE", () => {
    const stripeErr = new Stripe.errors.StripeAPIError({
      message: "An error occurred.",
      type: "api_error",
      statusCode: 500,
      requestId: "req_xyz",
    } as any);

    const result = asAppError(mapStripeError(stripeErr));

    expect(result).toBeInstanceOf(AppError);
    expect(result.statusCode).toBe(502);
    expect(result.code).toBe("PAYMENT_SERVICE_UNAVAILABLE");
  });

  it("maps StripeConnectionError to 502", () => {
    const stripeErr = new Stripe.errors.StripeConnectionError({
      message: "Connection error.",
    } as any);

    const result = asAppError(mapStripeError(stripeErr));

    expect(result.statusCode).toBe(502);
    expect(result.code).toBe("PAYMENT_SERVICE_UNAVAILABLE");
  });

  it("maps StripeRateLimitError to 502", () => {
    const stripeErr = new Stripe.errors.StripeRateLimitError({
      message: "Rate limit.",
    } as any);

    const result = asAppError(mapStripeError(stripeErr));

    expect(result.statusCode).toBe(502);
    expect(result.code).toBe("PAYMENT_SERVICE_UNAVAILABLE");
  });

  it("maps generic StripeError to 502", () => {
    const stripeErr = new Stripe.errors.StripeError({
      message: "Something went wrong.",
      type: "invalid_request_error",
      statusCode: 400,
    } as any);

    const result = asAppError(mapStripeError(stripeErr));

    expect(result.statusCode).toBe(502);
    expect(result.code).toBe("PAYMENT_SERVICE_UNAVAILABLE");
  });

  it("does not expose raw Stripe details in error message", () => {
    const stripeErr = new Stripe.errors.StripeCardError({
      message: "Your card was declined.",
      type: "card_error",
      code: "card_declined",
      decline_code: "generic_decline",
      statusCode: 402,
      requestId: "req_secret_123",
    } as any);

    const result = asAppError(mapStripeError(stripeErr));

    // Must not leak raw Stripe internals
    expect(result.message).not.toContain("req_secret_123");
    expect(result.message).not.toContain("402");
    expect(result.details).toBeUndefined();
  });

  it("logs full Stripe error details", async () => {
    const stripeErr = new Stripe.errors.StripeAPIError({
      message: "API error.",
      type: "api_error",
      statusCode: 500,
      requestId: "req_log_me",
    } as any);

    mapStripeError(stripeErr);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeRequestId: "req_log_me",
        stripeStatusCode: 500,
        stripeType: "StripeAPIError",
      }),
      "Stripe API error",
    );
  });

  it("passes through non-Stripe errors unchanged", () => {
    const plainErr = new Error("network timeout");

    const result = mapStripeError(plainErr);

    expect(result).toBe(plainErr);
  });
});
