import Stripe from "stripe";
import { AppError } from "../errors.js";
import { logger } from "../logger.js";

export function mapStripeError(err: unknown): Error {
  if (!(err instanceof Stripe.errors.StripeError)) {
    return err as Error;
  }

  logger.error(
    {
      stripeRequestId: err.requestId,
      stripeStatusCode: err.statusCode,
      stripeType: err.type,
    },
    "Stripe API error",
  );

  if (err instanceof Stripe.errors.StripeCardError) {
    const reason = (err as unknown as { decline_code?: string }).decline_code || "declined";
    return new AppError(402, "PAYMENT_FAILED", `Payment failed: ${reason}`);
  }

  return new AppError(502, "PAYMENT_SERVICE_UNAVAILABLE", "Payment service is currently unavailable");
}
