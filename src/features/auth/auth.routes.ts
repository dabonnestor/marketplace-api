import { Router } from "express";
import { validate } from "../../shared/middleware/validate.js";
import { authenticate } from "../../shared/middleware/auth.js";
import { asyncHandler } from "../../shared/middleware/async-handler.js";
import { registerSchema, loginSchema, refreshSchema } from "./auth.schemas.js";
import * as authService from "./auth.service.js";

export const authRouter = Router();

authRouter.post("/register", validate(registerSchema), asyncHandler(async (req, res) => {
  const result = await authService.register(req.body);
  res.status(201).json(result);
}));

authRouter.post("/login", validate(loginSchema), asyncHandler(async (req, res) => {
  const result = await authService.login(req.body);
  res.json(result);
}));

authRouter.post("/refresh", validate(refreshSchema), asyncHandler(async (req, res) => {
  const tokens = await authService.refresh(req.body.refreshToken);
  res.json(tokens);
}));

authRouter.get("/me", authenticate, asyncHandler(async (req, res) => {
  const user = await authService.getMe(req.user!.sub);
  res.json(user);
}));
