import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";

const mockPaymentIntentsCreate = vi.fn();
const mockPaymentIntentsRetrieve = vi.fn();
const mockPaymentIntentsConfirm = vi.fn();
const mockPaymentIntentsCancel = vi.fn();
const mockAccountsRetrieve = vi.fn();
const mockAccountsCreate = vi.fn();
const mockAccountLinksCreate = vi.fn();
const mockRefundsCreate = vi.fn();
const mockTransfersCreate = vi.fn();
const mockLoggerError = vi.fn();

vi.mock("../stripe-client.js", () => ({
  stripe: {
    paymentIntents: {
      create: (...args: any[]) => mockPaymentIntentsCreate(...args),
      retrieve: (...args: any[]) => mockPaymentIntentsRetrieve(...args),
      confirm: (...args: any[]) => mockPaymentIntentsConfirm(...args),
      cancel: (...args: any[]) => mockPaymentIntentsCancel(...args),
    },
    accounts: {
      retrieve: (...args: any[]) => mockAccountsRetrieve(...args),
      create: (...args: any[]) => mockAccountsCreate(...args),
    },
    accountLinks: {
      create: (...args: any[]) => mockAccountLinksCreate(...args),
    },
    refunds: {
      create: (...args: any[]) => mockRefundsCreate(...args),
    },
    transfers: {
      create: (...args: any[]) => mockTransfersCreate(...args),
    },
  },
}));

vi.mock("../../errors.js", () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    code: string;
    constructor(statusCode: number, code: string, message: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

vi.mock("../../logger.js", () => ({
  logger: { error: (...args: any[]) => mockLoggerError(...args) },
}));

const {
  createPaymentIntent,
  retrievePaymentIntent,
  confirmPaymentIntent,
  cancelPaymentIntent,
  createRefund,
  createTransfer,
  retrieveAccount,
  createAccount,
  createAccountLink,
} = await import("../payments-adapter.js");

beforeEach(() => {
  vi.clearAllMocks();
});

function fakePI(overrides: Partial<Stripe.PaymentIntent> = {}) {
  return { id: "pi_test", client_secret: "cs_test", ...overrides } as Stripe.PaymentIntent;
}

function fakeRefund(overrides: Partial<Stripe.Refund> = {}) {
  return { id: "re_test", ...overrides } as Stripe.Refund;
}

function fakeTransfer(overrides: Partial<Stripe.Transfer> = {}) {
  return { id: "tr_test", ...overrides } as Stripe.Transfer;
}

// ── createPaymentIntent ────────────────────────────────────────

describe("createPaymentIntent", () => {
  it("creates a Stripe PaymentIntent with amount in cents, usd, automatic capture, and card", async () => {
    mockPaymentIntentsCreate.mockResolvedValueOnce(fakePI());

    await createPaymentIntent({
      idempotencyKey: "order_1",
      amount: "105.00",
      metadata: { order_id: "order_1" },
    });

    const [callArgs, opts] = mockPaymentIntentsCreate.mock.calls[0];
    expect(callArgs.amount).toBe(10500);
    expect(callArgs.currency).toBe("usd");
    expect(callArgs.capture_method).toBe("automatic");
    expect(callArgs.payment_method_types).toEqual(["card"]);
    expect(opts).toEqual({ idempotencyKey: "order_1" });
  });

  it("passes metadata through to Stripe", async () => {
    mockPaymentIntentsCreate.mockResolvedValueOnce(fakePI());

    await createPaymentIntent({
      idempotencyKey: "o1",
      amount: "10.00",
      metadata: { order_id: "o1", buyer_id: "b1" },
    });

    const [callArgs] = mockPaymentIntentsCreate.mock.calls[0];
    expect(callArgs.metadata).toEqual({ order_id: "o1", buyer_id: "b1" });
  });

  it("returns the PI id and clientSecret", async () => {
    mockPaymentIntentsCreate.mockResolvedValueOnce(
      fakePI({ id: "pi_abc", client_secret: "cs_xyz" }),
    );

    const result = await createPaymentIntent({
      idempotencyKey: "o1",
      amount: "10.00",
      metadata: {},
    });

    expect(result).toEqual({ id: "pi_abc", clientSecret: "cs_xyz" });
  });

  it("returns null clientSecret when Stripe returns null", async () => {
    mockPaymentIntentsCreate.mockResolvedValueOnce(
      fakePI({ id: "pi_abc", client_secret: null }),
    );

    const result = await createPaymentIntent({
      idempotencyKey: "o1",
      amount: "10.00",
      metadata: {},
    });

    expect(result).toEqual({ id: "pi_abc", clientSecret: null });
  });

  it("maps Stripe errors through mapStripeError", async () => {
    const stripeError = new Stripe.errors.StripeError({
      type: "api_error",
      message: "boom",
    } as any);
    mockPaymentIntentsCreate.mockRejectedValueOnce(stripeError);

    await expect(
      createPaymentIntent({ idempotencyKey: "o1", amount: "10.00", metadata: {} }),
    ).rejects.toThrow();
  });
});

// ── retrievePaymentIntent ──────────────────────────────────────

describe("retrievePaymentIntent", () => {
  it("retrieves the PI from Stripe and returns it", async () => {
    const pi = fakePI({ id: "pi_123", status: "requires_confirmation" as any });
    mockPaymentIntentsRetrieve.mockResolvedValueOnce(pi);

    const result = await retrievePaymentIntent("pi_123");

    expect(mockPaymentIntentsRetrieve).toHaveBeenCalledWith("pi_123");
    expect(result).toEqual(pi);
  });

  it("maps Stripe errors", async () => {
    mockPaymentIntentsRetrieve.mockRejectedValueOnce(
      new Stripe.errors.StripeError({ type: "api_error", message: "boom" } as any),
    );

    await expect(retrievePaymentIntent("pi_123")).rejects.toThrow();
  });
});

// ── confirmPaymentIntent ───────────────────────────────────────

describe("confirmPaymentIntent", () => {
  it("confirms the PI and returns it", async () => {
    const pi = fakePI({ id: "pi_123", status: "succeeded" as any });
    mockPaymentIntentsConfirm.mockResolvedValueOnce(pi);

    const result = await confirmPaymentIntent("pi_123");

    expect(mockPaymentIntentsConfirm).toHaveBeenCalledWith("pi_123");
    expect(result).toEqual(pi);
  });

  it("maps Stripe errors", async () => {
    mockPaymentIntentsConfirm.mockRejectedValueOnce(
      new Stripe.errors.StripeError({ type: "api_error", message: "boom" } as any),
    );

    await expect(confirmPaymentIntent("pi_123")).rejects.toThrow();
  });
});

// ── cancelPaymentIntent ────────────────────────────────────────

describe("cancelPaymentIntent", () => {
  it("cancels the PI and returns it", async () => {
    const pi = fakePI({ id: "pi_123", status: "canceled" as any });
    mockPaymentIntentsCancel.mockResolvedValueOnce(pi);

    const result = await cancelPaymentIntent("pi_123");

    expect(mockPaymentIntentsCancel).toHaveBeenCalledWith("pi_123");
    expect(result).toEqual(pi);
  });

  it("maps Stripe errors", async () => {
    mockPaymentIntentsCancel.mockRejectedValueOnce(
      new Stripe.errors.StripeError({ type: "api_error", message: "boom" } as any),
    );

    await expect(cancelPaymentIntent("pi_123")).rejects.toThrow();
  });
});

// ── createRefund ───────────────────────────────────────────────

describe("createRefund", () => {
  it("creates a refund with the correct payment_intent and amount in cents", async () => {
    mockRefundsCreate.mockResolvedValueOnce(fakeRefund({ id: "re_xyz" }));

    const result = await createRefund({
      paymentIntentId: "pi_abc",
      amount: "50.00",
    });

    const [callArgs] = mockRefundsCreate.mock.calls[0];
    expect(callArgs.payment_intent).toBe("pi_abc");
    expect(callArgs.amount).toBe(5000);
    expect(result).toEqual({ id: "re_xyz" });
  });

  it("maps Stripe errors", async () => {
    mockRefundsCreate.mockRejectedValueOnce(
      new Stripe.errors.StripeError({ type: "api_error", message: "boom" } as any),
    );

    await expect(
      createRefund({ paymentIntentId: "pi_abc", amount: "10.00" }),
    ).rejects.toThrow();
  });
});

// ── createTransfer ─────────────────────────────────────────────

describe("createTransfer", () => {
  it("creates a transfer with the correct amount, currency, destination, and metadata", async () => {
    mockTransfersCreate.mockResolvedValueOnce(fakeTransfer({ id: "tr_xyz" }));

    const result = await createTransfer({
      amount: "95.00",
      destination: "acct_seller_1",
      metadata: { order_id: "o1", buyer_id: "b1", seller_id: "s1" },
    });

    const [callArgs] = mockTransfersCreate.mock.calls[0];
    expect(callArgs.amount).toBe(9500);
    expect(callArgs.currency).toBe("usd");
    expect(callArgs.destination).toBe("acct_seller_1");
    expect(callArgs.metadata).toEqual({ order_id: "o1", buyer_id: "b1", seller_id: "s1" });
    expect(result).toEqual({ id: "tr_xyz" });
  });

  it("throws a 502 TRANSFER_FAILED AppError on StripeError", async () => {
    const stripeError = new Stripe.errors.StripeError({
      type: "api_error",
      message: "Transfer failed",
    } as any);
    mockTransfersCreate.mockRejectedValueOnce(stripeError);

    await expect(
      createTransfer({ amount: "10.00", destination: "acct_x", metadata: {} }),
    ).rejects.toThrow("Stripe transfer failed");
  });

  it("re-throws non-Stripe errors as-is", async () => {
    const genericError = new Error("network error");
    mockTransfersCreate.mockRejectedValueOnce(genericError);

    await expect(
      createTransfer({ amount: "10.00", destination: "acct_x", metadata: {} }),
    ).rejects.toThrow("network error");
  });
});

// ── retrieveAccount ────────────────────────────────────────────

describe("retrieveAccount", () => {
  it("retrieves a Stripe account by ID and returns it", async () => {
    const account = { id: "acct_123", charges_enabled: true, payouts_enabled: false };
    mockAccountsRetrieve.mockResolvedValueOnce(account);

    const result = await retrieveAccount("acct_123");

    expect(mockAccountsRetrieve).toHaveBeenCalledWith("acct_123");
    expect(result).toEqual(account);
  });

  it("maps Stripe errors through mapStripeError", async () => {
    mockAccountsRetrieve.mockRejectedValueOnce(
      new Stripe.errors.StripeError({ type: "api_error", message: "boom" } as any),
    );

    await expect(retrieveAccount("acct_123")).rejects.toThrow();
  });
});

// ── createAccount ──────────────────────────────────────────────

describe("createAccount", () => {
  it("creates a Stripe Express account with transfers and card_payments capabilities", async () => {
    const account = { id: "acct_xyz" };
    mockAccountsCreate.mockResolvedValueOnce(account);

    const result = await createAccount();

    const [callArgs] = mockAccountsCreate.mock.calls[0];
    expect(callArgs.type).toBe("express");
    expect(callArgs.capabilities).toEqual({
      transfers: { requested: true },
      card_payments: { requested: true },
    });
    expect(result).toEqual(account);
  });

  it("maps Stripe errors through mapStripeError", async () => {
    mockAccountsCreate.mockRejectedValueOnce(
      new Stripe.errors.StripeError({ type: "api_error", message: "boom" } as any),
    );

    await expect(createAccount()).rejects.toThrow();
  });
});

// ── createAccountLink ──────────────────────────────────────────

describe("createAccountLink", () => {
  it("creates an account link with the correct parameters", async () => {
    const link = { url: "https://connect.stripe.com/setup/t" };
    mockAccountLinksCreate.mockResolvedValueOnce(link);

    const result = await createAccountLink({
      account: "acct_xyz",
      refreshUrl: "https://app.example/refresh",
      returnUrl: "https://app.example/return",
    });

    const [callArgs] = mockAccountLinksCreate.mock.calls[0];
    expect(callArgs.account).toBe("acct_xyz");
    expect(callArgs.refresh_url).toBe("https://app.example/refresh");
    expect(callArgs.return_url).toBe("https://app.example/return");
    expect(callArgs.type).toBe("account_onboarding");
    expect(result).toEqual(link);
  });

  it("maps Stripe errors through mapStripeError", async () => {
    mockAccountLinksCreate.mockRejectedValueOnce(
      new Stripe.errors.StripeError({ type: "api_error", message: "boom" } as any),
    );

    await expect(
      createAccountLink({ account: "a", refreshUrl: "r", returnUrl: "u" }),
    ).rejects.toThrow();
  });
});
