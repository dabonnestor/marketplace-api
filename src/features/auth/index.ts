import rateLimit from "express-rate-limit";
import { authRouter } from "./auth.routes.js";
import { authPaths, authSchemas } from "./openapi.js";
import type { FeatureDescriptor } from "../../shared/feature-registry.js";

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "test" ? 1000 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

export const feature: FeatureDescriptor = {
  router: authRouter,
  path: "/api/v1/auth",
  middlewares: [authLimiter],
  openApiPaths: authPaths,
  openApiSchemas: authSchemas,
};
