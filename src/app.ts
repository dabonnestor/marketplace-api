import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import { logger } from "./shared/logger.js";
import { registerFeatures } from "./shared/feature-registry.js";
import { feature as auth } from "./features/auth/index.js";
import { feature as listings } from "./features/listings/index.js";
import { feature as orders } from "./features/orders/index.js";
import { feature as seller } from "./features/seller/index.js";
import { feature as webhooks } from "./features/webhooks/index.js";
import { errorHandler } from "./shared/middleware/error-handler.js";

const { mount, spec } = registerFeatures([auth, listings, orders, seller, webhooks]);

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

  // Raw body parsing for Stripe webhooks (before JSON parser)
  app.use("/api/v1/webhooks", express.raw({ type: "application/json" }));
  app.use(express.json({ limit: "1mb" }));

  // Logging
  app.use(pinoHttp({ logger }));

  // Global rate limiter
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: process.env.NODE_ENV === "test" ? 1000 : 1000,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // API docs
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(spec));
  app.get("/api/docs.json", (_req, res) => res.json(spec));

  // Routes
  mount(app);

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
