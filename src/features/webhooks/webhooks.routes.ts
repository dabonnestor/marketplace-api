import { Router } from "express";
import { stripe } from "../../shared/payments/stripe-client.js";
import { config } from "../../shared/config.js";
import { logger } from "../../shared/logger.js";
import { asyncHandler } from "../../shared/middleware/async-handler.js";
import { handleStripeEvent } from "./webhooks.service.js";

export const webhooksRouter = Router();

webhooksRouter.post(
  "/stripe",
  asyncHandler(async (req, res) => {
    const signature = req.headers["stripe-signature"] as string | undefined;

    if (!signature) {
      res.status(401).json({ error: "Missing stripe-signature header" });
      return;
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, config.STRIPE_WEBHOOK_SECRET);
    } catch {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    try {
      await handleStripeEvent(event);
    } catch (err) {
      logger.error({ err, eventType: event.type }, "Webhook handler error");
    }

    res.json({ received: true });
  }),
);
