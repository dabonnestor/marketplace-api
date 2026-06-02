import { Router } from "express";
import { authenticate } from "../../shared/middleware/auth.js";
import { asyncHandler } from "../../shared/middleware/async-handler.js";
import * as sellerService from "./seller.service.js";

export const sellerRouter = Router();

sellerRouter.post("/onboard", authenticate, asyncHandler(async (req, res) => {
  const result = await sellerService.onboard(req.user!.sub);
  res.json(result);
}));

sellerRouter.get("/onboard/status", authenticate, asyncHandler(async (req, res) => {
  const status = await sellerService.getStatus(req.user!.sub);
  res.json(status);
}));
