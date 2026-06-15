import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../../shared/errors.js";

const mockGetStatus = vi.fn();

vi.mock("../seller.service.js", () => ({
  getStatus: mockGetStatus,
}));

// Import after the mock so it resolves with the mocked dependency
const { requireOnboarding } = await import("../require-onboarding.middleware.js");

function mockReq(userId: string) {
  return { user: { sub: userId } } as unknown as Request;
}

function mockRes() {
  return {} as Response;
}

describe("requireOnboarding", () => {
  it("calls next() when seller is onboarded and charges are enabled", async () => {
    mockGetStatus.mockResolvedValueOnce({
      onboarded: true,
      chargesEnabled: true,
      payoutsEnabled: false,
    });

    const next = vi.fn() as NextFunction;
    await requireOnboarding(mockReq("seller-1"), mockRes(), next);

    expect(mockGetStatus).toHaveBeenCalledWith("seller-1");
    expect(next).toHaveBeenCalledWith();
  });

  it("calls next(error) when seller has no Stripe account", async () => {
    mockGetStatus.mockResolvedValueOnce({
      onboarded: false,
      chargesEnabled: false,
      payoutsEnabled: false,
    });

    const next = vi.fn() as NextFunction;
    await requireOnboarding(mockReq("seller-2"), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const error = vi.mocked(next).mock.calls[0][0] as unknown as AppError;
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe("ONBOARDING_REQUIRED");
  });

  it("calls next(error) when charges are not enabled", async () => {
    mockGetStatus.mockResolvedValueOnce({
      onboarded: true,
      chargesEnabled: false,
      payoutsEnabled: false,
    });

    const next = vi.fn() as NextFunction;
    await requireOnboarding(mockReq("seller-3"), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const error = vi.mocked(next).mock.calls[0][0] as unknown as AppError;
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe("ONBOARDING_REQUIRED");
  });
});
