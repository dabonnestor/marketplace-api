import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../shared/errors.js";
import { getStatus } from "./seller.service.js";

export async function requireOnboarding(req: Request, _res: Response, next: NextFunction) {
  const { chargesEnabled } = await getStatus(req.user!.sub);

  if (!chargesEnabled) {
    return next(new AppError(400, "ONBOARDING_REQUIRED", "Seller must complete Stripe Connect onboarding before creating listings"));
  }

  next();
}
