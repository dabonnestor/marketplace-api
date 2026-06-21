import Stripe from "stripe";
import { toCents } from "./amount-utils.js";
import { mapStripeError } from "./error-mapping.js";
import type { PaymentsAdapter, PaymentCommand, PaymentResult } from "./payments-adapter.js";

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

let _nextId = 1;
function nextId(prefix: string): string {
  return `${prefix}_fake_${_nextId++}`;
}

export class InMemoryFake implements PaymentsAdapter {
  private paymentIntents = new Map<string, Stripe.PaymentIntent>();
  private accounts = new Map<string, Stripe.Account>();
  private refunds: { id: string; payment_intent: string; amount: number }[] = [];
  private transfers: { id: string; amount: number; destination: string; metadata: Record<string, string> }[] = [];
  private accountLinks: { id: string; url: string; account: string }[] = [];
  private _failNext: Error | null = null;

  // ── Error simulation ─────────────────────────────────────────────

  failNextWith(error: Error): void {
    this._failNext = error;
  }

  // ── Seed data for tests ──────────────────────────────────────────

  seedPaymentIntent(pi: Stripe.PaymentIntent): void {
    this.paymentIntents.set(pi.id, pi);
  }

  seedAccount(account: Stripe.Account): void {
    this.accounts.set(account.id, account);
  }

  // ── State inspection (for test assertions) ───────────────────────

  getPaymentIntent(id: string): Stripe.PaymentIntent | undefined {
    return this.paymentIntents.get(id);
  }

  getAccount(id: string): Stripe.Account | undefined {
    return this.accounts.get(id);
  }

  getRefundFor(paymentIntentId: string): { id: string; payment_intent: string; amount: number } | undefined {
    return this.refunds.find((r) => r.payment_intent === paymentIntentId);
  }

  getTransferFor(destination: string): { id: string; amount: number; destination: string; metadata: Record<string, string> } | undefined {
    return this.transfers.find((t) => t.destination === destination);
  }

  getTransferCount(): number {
    return this.transfers.length;
  }

  getRefundCount(): number {
    return this.refunds.length;
  }

  // ── Reset ────────────────────────────────────────────────────────

  reset(): void {
    this.paymentIntents.clear();
    this.accounts.clear();
    this.refunds = [];
    this.transfers = [];
    this.accountLinks = [];
    this._failNext = null;
  }

  // ── Execute ──────────────────────────────────────────────────────

  async execute<C extends PaymentCommand>(
    command: C,
  ): Promise<Extract<PaymentResult, { type: CommandResultType[C["type"]] }>> {
    if (this._failNext) {
      const err = this._failNext;
      this._failNext = null;
      throw err;
    }

    try {
      let result: PaymentResult;
      switch (command.type) {
        case "create_payment_intent": {
          const id = nextId("pi");
          const pi = {
            id,
            client_secret: `${id}_secret`,
            amount: toCents(command.amount),
            currency: "usd",
            status: "requires_payment_method",
            metadata: command.metadata,
          } as unknown as Stripe.PaymentIntent;
          this.paymentIntents.set(id, pi);
          result = { type: "payment_intent_created", id, clientSecret: pi.client_secret! };
          break;
        }
        case "retrieve_payment_intent": {
          const pi = this.paymentIntents.get(command.paymentIntentId);
          if (!pi) {
            throw new (Stripe.errors as any).StripeError({
              type: "invalid_request_error",
              message: `No such payment_intent: ${command.paymentIntentId}`,
            });
          }
          result = { type: "payment_intent", paymentIntent: pi };
          break;
        }
        case "confirm_payment_intent": {
          const pi = this.paymentIntents.get(command.paymentIntentId);
          if (!pi) {
            throw new (Stripe.errors as any).StripeError({
              type: "invalid_request_error",
              message: `No such payment_intent: ${command.paymentIntentId}`,
            });
          }
          (pi as any).status = "succeeded";
          this.paymentIntents.set(command.paymentIntentId, pi);
          result = { type: "payment_intent", paymentIntent: pi };
          break;
        }
        case "cancel_payment_intent": {
          const pi = this.paymentIntents.get(command.paymentIntentId);
          if (!pi) {
            throw new (Stripe.errors as any).StripeError({
              type: "invalid_request_error",
              message: `No such payment_intent: ${command.paymentIntentId}`,
            });
          }
          (pi as any).status = "canceled";
          this.paymentIntents.set(command.paymentIntentId, pi);
          result = { type: "payment_intent", paymentIntent: pi };
          break;
        }
        case "create_refund": {
          const id = nextId("re");
          const refund = {
            id,
            payment_intent: command.paymentIntentId,
            amount: toCents(command.amount),
          };
          this.refunds.push(refund);
          result = { type: "refund_created", id };
          break;
        }
        case "create_transfer": {
          const id = nextId("tr");
          this.transfers.push({
            id,
            amount: toCents(command.amount),
            destination: command.destination,
            metadata: command.metadata,
          });
          result = { type: "transfer_created", id };
          break;
        }
        case "retrieve_account": {
          const account = this.accounts.get(command.accountId);
          if (!account) {
            throw new (Stripe.errors as any).StripeError({
              type: "invalid_request_error",
              message: `No such account: ${command.accountId}`,
            });
          }
          result = { type: "account", account };
          break;
        }
        case "create_account": {
          const id = nextId("acct");
          const account = {
            id,
            type: "express",
            charges_enabled: true,
            payouts_enabled: true,
            capabilities: {
              transfers: "active",
              card_payments: "active",
            },
          } as unknown as Stripe.Account;
          this.accounts.set(id, account);
          result = { type: "account", account };
          break;
        }
        case "create_account_link": {
          const url = `https://connect.stripe.com/setup/t/${nextId("link")}`;
          const accountLink = {
            url,
            id: `link_${command.account}`,
          };
          this.accountLinks.push({ id: accountLink.id, url, account: command.account });
          result = {
            type: "account_link",
            accountLink: accountLink as unknown as Stripe.AccountLink,
          };
          break;
        }
        default:
          throw new Error(`Unknown command: ${(command as any).type}`);
      }
      return result as Extract<PaymentResult, { type: CommandResultType[C["type"]] }>;
    } catch (err) {
      throw mapStripeError(err);
    }
  }
}
