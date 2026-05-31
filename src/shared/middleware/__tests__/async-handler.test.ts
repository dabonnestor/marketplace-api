import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { asyncHandler } from "../async-handler.js";

function mockReq() {
  return {} as Request;
}

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response;
}

describe("asyncHandler", () => {
  it("wraps an async route handler and forwards rejections to next(err)", async () => {
    const error = new Error("service failure");
    const handler = asyncHandler(async (_req, _res) => {
      throw error;
    });

    const next = vi.fn() as NextFunction;
    await handler(mockReq(), mockRes(), next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it("calls the wrapped handler normally on success", async () => {
    const handler = asyncHandler(async (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const res = mockRes();
    const next = vi.fn() as NextFunction;
    await handler(mockReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(next).not.toHaveBeenCalled();
  });
});
