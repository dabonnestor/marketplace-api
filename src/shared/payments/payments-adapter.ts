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

// ── Result type map ─────────────────────────────────────────────────

type CommandResultType = {
  create_payment_intent: "payment_intent_created";
  retrieve_payment_intent: "payment_intent";
  confirm_payment_intent: "payment_intent";
  cancel_payment_intent: "payment_intent";
  create_refund: "refund_created";
  create_transfer: "transfer_created";
  retrieve_account: "account";
  create_account: "account";
  create_account_link: "account_link";
};

// ── Adapter interface ──────────────────────────────────────────────

export interface PaymentsAdapter {
  execute<C extends PaymentCommand>(
    command: C,
  ): Promise<Extract<PaymentResult, { type: CommandResultType[C["type"]] }>>;
}

// ── Stripe adapter (production) ────────────────────────────────────

export class StripeAdapter implements PaymentsAdapter {
  async execute<C extends PaymentCommand>(
    command: C,
  ): Promise<Extract<PaymentResult, { type: CommandResultType[C["type"]] }>> {
    try {
      let result: PaymentResult;
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
          result = { type: "payment_intent_created", id: pi.id, clientSecret: pi.client_secret ?? null };
          break;
        }
        case "retrieve_payment_intent":
          result = { type: "payment_intent", paymentIntent: await stripe.paymentIntents.retrieve(command.paymentIntentId) };
          break;
        case "confirm_payment_intent":
          result = { type: "payment_intent", paymentIntent: await stripe.paymentIntents.confirm(command.paymentIntentId) };
          break;
        case "cancel_payment_intent":
          result = { type: "payment_intent", paymentIntent: await stripe.paymentIntents.cancel(command.paymentIntentId) };
          break;
        case "create_refund": {
          const refund = await stripe.refunds.create({
            payment_intent: command.paymentIntentId,
            amount: toCents(command.amount),
          });
          result = { type: "refund_created", id: refund.id };
          break;
        }
        case "create_transfer": {
          const transfer = await stripe.transfers.create({
            amount: toCents(command.amount),
            currency: "usd",
            destination: command.destination,
            metadata: command.metadata,
          });
          result = { type: "transfer_created", id: transfer.id };
          break;
        }
        case "retrieve_account":
          result = { type: "account", account: await stripe.accounts.retrieve(command.accountId) };
          break;
        case "create_account":
          result = {
            type: "account",
            account: await stripe.accounts.create({
              type: "express",
              capabilities: {
                transfers: { requested: true },
                card_payments: { requested: true },
              },
            }),
          };
          break;
        case "create_account_link":
          result = {
            type: "account_link",
            accountLink: await stripe.accountLinks.create({
              account: command.account,
              refresh_url: command.refreshUrl,
              return_url: command.returnUrl,
              type: "account_onboarding",
            }),
          };
          break;
        default:
          throw new Error(`Unknown command: ${(command as any).type}`);
      }
      return result as Extract<PaymentResult, { type: CommandResultType[C["type"]] }>;
    } catch (err) {
      throw mapStripeError(err);
    }
  }
}

// ── DI ─────────────────────────────────────────────────────────────

let _adapter: PaymentsAdapter = new StripeAdapter();

export function setPaymentsAdapter(adapter: PaymentsAdapter): void {
  _adapter = adapter;
}

export function getPaymentsAdapter(): PaymentsAdapter {
  return _adapter;
}

export async function execute<C extends PaymentCommand>(
  command: C,
): Promise<Extract<PaymentResult, { type: CommandResultType[C["type"]] }>> {
  return _adapter.execute(command);
}
