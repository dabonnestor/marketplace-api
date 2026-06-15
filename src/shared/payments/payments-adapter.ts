import Stripe from "stripe";
import { stripe } from "./stripe-client.js";
import { toCents } from "./amount-utils.js";
import { mapStripeError } from "./error-mapping.js";

// ── Command types ──────────────────────────────────────────────────

export type PaymentCommand =
  | { type: "create_payment_intent"; idempotencyKey: string; amount: string; metadata: Record<string, string> }
  | { type: "retrieve_payment_intent"; paymentIntentId: string }
  | { type: "confirm_payment_intent"; paymentIntentId: string }
  | { type: "cancel_payment_intent"; paymentIntentId: string }
  | { type: "create_refund"; paymentIntentId: string; amount: string }
  | { type: "create_transfer"; amount: string; destination: string; metadata: Record<string, string> }
  | { type: "retrieve_account"; accountId: string }
  | { type: "create_account" }
  | { type: "create_account_link"; account: string; refreshUrl: string; returnUrl: string };

// ── Result types ───────────────────────────────────────────────────

export type PaymentResult =
  | { type: "payment_intent_created"; id: string; clientSecret: string | null }
  | { type: "payment_intent"; paymentIntent: Stripe.PaymentIntent }
  | { type: "refund_created"; id: string }
  | { type: "transfer_created"; id: string }
  | { type: "account"; account: Stripe.Account }
  | { type: "account_link"; accountLink: Stripe.AccountLink };

// ── Execute ────────────────────────────────────────────────────────

export async function execute(command: PaymentCommand): Promise<PaymentResult> {
  try {
    switch (command.type) {
      case "create_payment_intent": {
        const pi = await stripe.paymentIntents.create(
          {
            amount: toCents(command.amount),
            currency: "usd",
            capture_method: "automatic",
            payment_method_types: ["card"],
            metadata: command.metadata,
          },
          { idempotencyKey: command.idempotencyKey },
        );
        return { type: "payment_intent_created", id: pi.id, clientSecret: pi.client_secret ?? null };
      }
      case "retrieve_payment_intent":
        return { type: "payment_intent", paymentIntent: await stripe.paymentIntents.retrieve(command.paymentIntentId) };
      case "confirm_payment_intent":
        return { type: "payment_intent", paymentIntent: await stripe.paymentIntents.confirm(command.paymentIntentId) };
      case "cancel_payment_intent":
        return { type: "payment_intent", paymentIntent: await stripe.paymentIntents.cancel(command.paymentIntentId) };
      case "create_refund": {
        const refund = await stripe.refunds.create({
          payment_intent: command.paymentIntentId,
          amount: toCents(command.amount),
        });
        return { type: "refund_created", id: refund.id };
      }
      case "create_transfer": {
        const transfer = await stripe.transfers.create({
          amount: toCents(command.amount),
          currency: "usd",
          destination: command.destination,
          metadata: command.metadata,
        });
        return { type: "transfer_created", id: transfer.id };
      }
      case "retrieve_account":
        return { type: "account", account: await stripe.accounts.retrieve(command.accountId) };
      case "create_account":
        return { type: "account", account: await stripe.accounts.create({
          type: "express",
          capabilities: {
            transfers: { requested: true },
            card_payments: { requested: true },
          },
        }) };
      case "create_account_link":
        return { type: "account_link", accountLink: await stripe.accountLinks.create({
          account: command.account,
          refresh_url: command.refreshUrl,
          return_url: command.returnUrl,
          type: "account_onboarding",
        }) };
      default:
        throw new Error(`Unknown command: ${(command as any).type}`);
    }
  } catch (err) {
    throw mapStripeError(err);
  }
}
