import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import { logger } from "./shared/logger.js";
import { errorHandler } from "./shared/middleware/error-handler.js";
import { authRouter } from "./features/auth/auth.routes.js";
import { listingsRouter } from "./features/listings/listings.routes.js";
import { ordersRouter } from "./features/orders/orders.routes.js";
import { sellerRouter } from "./features/seller/seller.routes.js";
import { openApiSpec } from "./shared/openapi.js";

export function createApp() {
  const app = express();

  // Security — relaxed CSP for Swagger UI
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "validator.swagger.io"],
        },
      },
    }),
  );
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  // Logging
  app.use(pinoHttp({ logger }));

  // Global rate limiter
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // Auth rate limiter (stricter)
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // API docs
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
  app.get("/api/docs.json", (_req, res) => res.json(openApiSpec));

  // Routes
  app.use("/api/v1/auth", authLimiter, authRouter);
  app.use("/api/v1/listings", listingsRouter);
  app.use("/api/v1/orders", ordersRouter);
app.use("/api/v1/seller", sellerRouter);

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
