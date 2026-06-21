import { describe, it, expect, beforeEach } from "vitest";
import Stripe from "stripe";
import { InMemoryFake } from "../payments-fake.js";

let fake: InMemoryFake;

beforeEach(() => {
  fake = new InMemoryFake();
});

function fakePI(overrides: Partial<Stripe.PaymentIntent> = {}) {
  return { id: "pi_test", client_secret: "cs_test", status: "requires_payment_method", ...overrides } as unknown as Stripe.PaymentIntent;
}

function fakeAccount(overrides: Partial<Stripe.Account> = {}) {
  return { id: "acct_test", charges_enabled: true, payouts_enabled: true, ...overrides } as unknown as Stripe.Account;
}

// ── create_payment_intent ──────────────────────────────────────────

describe("InMemoryFake: create_payment_intent", () => {
  it("generates an id and clientSecret", async () => {
    const result = await fake.execute({
      type: "create_payment_intent",
      idempotencyKey: "order_1",
      amount: "105.00",
      metadata: { order_id: "order_1" },
    });

    expect(result.type).toBe("payment_intent_created");
    expect(result.id).toMatch(/^pi_fake_/);
    expect(result.clientSecret).toBe(`${result.id}_secret`);
  });

  it("stores the payment intent for later retrieval", async () => {
    const created = await fake.execute({
      type: "create_payment_intent",
      idempotencyKey: "o1",
      amount: "10.00",
      metadata: {},
    });

    const pi = fake.getPaymentIntent(created.id);
    expect(pi).toBeDefined();
    expect(pi!.amount).toBe(1000);
    expect(pi!.currency).toBe("usd");
    expect(pi!.status).toBe("requires_payment_method");
  });

  it("stores metadata on the payment intent", async () => {
    const created = await fake.execute({
      type: "create_payment_intent",
      idempotencyKey: "o1",
      amount: "10.00",
      metadata: { order_id: "o1", buyer_id: "b1" },
    });

    const pi = fake.getPaymentIntent(created.id);
    expect(pi!.metadata).toEqual({ order_id: "o1", buyer_id: "b1" });
  });

  it("handles dollar amounts with cents correctly", async () => {
    const result = await fake.execute({
      type: "create_payment_intent",
      idempotencyKey: "k1",
      amount: "99.99",
      metadata: {},
    });

    const pi = fake.getPaymentIntent(result.id);
    expect(pi!.amount).toBe(9999);
  });
});

// ── retrieve_payment_intent ────────────────────────────────────────

describe("InMemoryFake: retrieve_payment_intent", () => {
  it("returns the stored payment intent", async () => {
    fake.seedPaymentIntent(fakePI({ id: "pi_123", status: "requires_confirmation" }));

    const result = await fake.execute({ type: "retrieve_payment_intent", paymentIntentId: "pi_123" });

    expect(result).toEqual({ type: "payment_intent", paymentIntent: fake.getPaymentIntent("pi_123")! });
  });

  it("throws a StripeError for non-existent payment intent", async () => {
    await expect(
      fake.execute({ type: "retrieve_payment_intent", paymentIntentId: "nonexistent" }),
    ).rejects.toThrow();
  });
});

// ── confirm_payment_intent ─────────────────────────────────────────

describe("InMemoryFake: confirm_payment_intent", () => {
  it("updates the PI status to succeeded", async () => {
    fake.seedPaymentIntent(fakePI({ id: "pi_123", status: "requires_confirmation" }));

    const result = await fake.execute({ type: "confirm_payment_intent", paymentIntentId: "pi_123" });

    expect(result.type).toBe("payment_intent");
    const pi = result as { type: "payment_intent"; paymentIntent: Stripe.PaymentIntent };
    expect(pi.paymentIntent.status).toBe("succeeded");
    expect(fake.getPaymentIntent("pi_123")!.status).toBe("succeeded");
  });

  it("throws for non-existent payment intent", async () => {
    await expect(
      fake.execute({ type: "confirm_payment_intent", paymentIntentId: "nonexistent" }),
    ).rejects.toThrow();
  });
});

// ── cancel_payment_intent ──────────────────────────────────────────

describe("InMemoryFake: cancel_payment_intent", () => {
  it("updates the PI status to canceled", async () => {
    fake.seedPaymentIntent(fakePI({ id: "pi_123" }));

    const result = await fake.execute({ type: "cancel_payment_intent", paymentIntentId: "pi_123" });

    const pi = result as { type: "payment_intent"; paymentIntent: Stripe.PaymentIntent };
    expect(pi.paymentIntent.status).toBe("canceled");
  });
});

// ── create_refund ──────────────────────────────────────────────────

describe("InMemoryFake: create_refund", () => {
  it("returns a refund id and tracks the refund", async () => {
    const result = await fake.execute({
      type: "create_refund",
      paymentIntentId: "pi_abc",
      amount: "50.00",
    });

    expect(result).toEqual({ type: "refund_created", id: expect.stringMatching(/^re_fake_/) });
    expect(fake.getRefundCount()).toBe(1);
    expect(fake.getRefundFor("pi_abc")!.amount).toBe(5000);
  });
});

// ── create_transfer ────────────────────────────────────────────────

describe("InMemoryFake: create_transfer", () => {
  it("creates a transfer and tracks it", async () => {
    const result = await fake.execute({
      type: "create_transfer",
      amount: "95.00",
      destination: "acct_seller",
      metadata: { order_id: "o1" },
    });

    expect(result).toEqual({ type: "transfer_created", id: expect.stringMatching(/^tr_fake_/) });
    expect(fake.getTransferCount()).toBe(1);
    const transfer = fake.getTransferFor("acct_seller");
    expect(transfer!.amount).toBe(9500);
    expect(transfer!.metadata).toEqual({ order_id: "o1" });
  });
});

// ── retrieve_account ───────────────────────────────────────────────

describe("InMemoryFake: retrieve_account", () => {
  it("returns the stored account", async () => {
    fake.seedAccount(fakeAccount({ id: "acct_abc", charges_enabled: false }));

    const result = await fake.execute({ type: "retrieve_account", accountId: "acct_abc" });

    const r = result as { type: "account"; account: Stripe.Account };
    expect(r.account.id).toBe("acct_abc");
    expect(r.account.charges_enabled).toBe(false);
  });

  it("throws for non-existent account", async () => {
    await expect(
      fake.execute({ type: "retrieve_account", accountId: "no_such" }),
    ).rejects.toThrow();
  });
});

// ── create_account ─────────────────────────────────────────────────

describe("InMemoryFake: create_account", () => {
  it("creates an express account and stores it", async () => {
    const result = await fake.execute({ type: "create_account" });

    const r = result as { type: "account"; account: Stripe.Account };
    expect(r.account.id).toMatch(/^acct_fake_/);
    expect(fake.getAccount(r.account.id)!.id).toBe(r.account.id);
  });
});

// ── create_account_link ────────────────────────────────────────────

describe("InMemoryFake: create_account_link", () => {
  it("returns an account link URL", async () => {
    const result = await fake.execute({
      type: "create_account_link",
      account: "acct_xyz",
      refreshUrl: "https://app.example/refresh",
      returnUrl: "https://app.example/return",
    });

    const r = result as { type: "account_link"; accountLink: Stripe.AccountLink };
    expect(r.accountLink.url).toContain("https://connect.stripe.com/setup/t/");
  });
});

// ── Error simulation ───────────────────────────────────────────────

describe("InMemoryFake: error simulation", () => {
  it("throws the configured error on next execute call", async () => {
    const cardError = new Stripe.errors.StripeCardError({ type: "card_error", message: "declined" } as any);
    fake.failNextWith(cardError);

    await expect(
      fake.execute({ type: "create_payment_intent", idempotencyKey: "k1", amount: "10.00", metadata: {} }),
    ).rejects.toThrow("declined");
  });

  it("clears the error after one call", async () => {
    fake.failNextWith(new Stripe.errors.StripeError({ type: "api_error", message: "boom" } as any));

    await expect(
      fake.execute({ type: "create_payment_intent", idempotencyKey: "k1", amount: "10.00", metadata: {} }),
    ).rejects.toThrow();

    // Second call should succeed
    const result = await fake.execute({
      type: "create_payment_intent",
      idempotencyKey: "k2",
      amount: "10.00",
      metadata: {},
    });
    expect(result.type).toBe("payment_intent_created");
  });
});

// ── Reset ──────────────────────────────────────────────────────────

describe("InMemoryFake: reset", () => {
  it("clears all state", async () => {
    const created = await fake.execute({
      type: "create_payment_intent",
      idempotencyKey: "k1",
      amount: "10.00",
      metadata: {},
    });
    fake.seedAccount(fakeAccount());
    fake.failNextWith(new Error("boom"));
    await fake.execute({ type: "create_refund", paymentIntentId: created.id, amount: "10.00" }).catch(() => {});

    fake.reset();

    expect(fake.getPaymentIntent(created.id)).toBeUndefined();
    expect(fake.getAccount("acct_test")).toBeUndefined();
    expect(fake.getRefundCount()).toBe(0);
    expect(fake.getTransferCount()).toBe(0);
    // Should succeed after reset (no more error)
    const result = await fake.execute({
      type: "create_payment_intent",
      idempotencyKey: "k2",
      amount: "10.00",
      metadata: {},
    });
    expect(result.type).toBe("payment_intent_created");
  });
});
