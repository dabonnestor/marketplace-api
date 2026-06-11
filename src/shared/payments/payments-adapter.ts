import Stripe from "stripe";
import { stripe } from "./stripe-client.js";
import { toCents } from "./amount-utils.js";
import { mapStripeError } from "./error-mapping.js";
import { AppError } from "../errors.js";
import { logger } from "../logger.js";

export async function createPaymentIntent(params: {
  idempotencyKey: string;
  amount: string;
  metadata: Record<string, string>;
}) {
  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: toCents(params.amount),
        currency: "usd",
        capture_method: "automatic",
        payment_method_types: ["card"],
        metadata: params.metadata,
      },
      { idempotencyKey: params.idempotencyKey },
    );
    return { id: pi.id, clientSecret: pi.client_secret ?? null };
  } catch (err) {
    throw mapStripeError(err);
  }
}

export async function retrievePaymentIntent(piId: string) {
  try {
    return await stripe.paymentIntents.retrieve(piId);
  } catch (err) {
    throw mapStripeError(err);
  }
}

export async function confirmPaymentIntent(piId: string) {
  try {
    return await stripe.paymentIntents.confirm(piId);
  } catch (err) {
    throw mapStripeError(err);
  }
}

export async function cancelPaymentIntent(piId: string) {
  try {
    return await stripe.paymentIntents.cancel(piId);
  } catch (err) {
    throw mapStripeError(err);
  }
}

export async function createRefund(params: {
  paymentIntentId: string;
  amount: string;
}) {
  try {
    const refund = await stripe.refunds.create({
      payment_intent: params.paymentIntentId,
      amount: toCents(params.amount),
    });
    return { id: refund.id };
  } catch (err) {
    throw mapStripeError(err);
  }
}

export async function createTransfer(params: {
  amount: string;
  destination: string;
  metadata: Record<string, string>;
}) {
  try {
    const transfer = await stripe.transfers.create({
      amount: toCents(params.amount),
      currency: "usd",
      destination: params.destination,
      metadata: params.metadata,
    });
    return { id: transfer.id };
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      logger.error(
        { stripeRequestId: err.requestId, stripeType: err.type },
        "Stripe transfer failed",
      );
      throw new AppError(502, "TRANSFER_FAILED", "Stripe transfer failed");
    }
    throw err;
  }
}
