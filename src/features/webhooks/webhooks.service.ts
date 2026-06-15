import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { db, schema } from "../../db/index.js";
import { logger } from "../../shared/logger.js";
import { AppError } from "../../shared/errors.js";
import { transitionOrder } from "../orders/order-lifecycle/transition-order.js";
import { expireIfStale } from "../orders/reservation.js";

export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "payment_intent.succeeded":
      return handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
    case "charge.dispute.created":
      return handleDisputeCreated(event.data.object as Stripe.Dispute);
    case "charge.dispute.closed":
      return handleDisputeClosed(event.data.object as Stripe.Dispute);
    case "account.updated":
      logger.info({ accountId: (event.data.object as Stripe.Account).id }, "account.updated webhook received");
      return;
    case "payment_intent.payment_failed":
      logger.info({ piId: (event.data.object as Stripe.PaymentIntent).id }, "payment_intent.payment_failed webhook received");
      return;
    default:
      logger.info({ eventType: event.type }, "Unhandled webhook event type");
  }
}

async function findOrderByPaymentIntent(piId: string) {
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.stripePaymentIntentId, piId))
    .limit(1);
  return order;
}

async function handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  const orderId = paymentIntent.metadata.order_id;
  if (!orderId) {
    logger.warn("payment_intent.succeeded webhook received without order_id in metadata");
    return;
  }

  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .limit(1);

  if (!order) {
    logger.warn({ orderId }, "payment_intent.succeeded webhook received for unknown order");
    return;
  }

  if (await expireIfStale(order)) {
    logger.info({ orderId }, "payment_intent.succeeded webhook: order expired, transitioned to expired");
    return;
  }

  try {
    await transitionOrder(order, "paid");
  } catch (err) {
    if (err instanceof AppError && err.code === "INVALID_TRANSITION") {
      logger.info({ orderId, currentStatus: order.status }, "payment_intent.succeeded webhook: transition not allowed (already processed)");
      return;
    }
    throw err;
  }

  logger.info({ orderId }, "Order marked as paid via webhook (safety net)");
}

async function handleDisputeCreated(dispute: Stripe.Dispute) {
  const piId = dispute.payment_intent as string;
  if (!piId) {
    logger.warn("charge.dispute.created webhook received without payment_intent");
    return;
  }

  const order = await findOrderByPaymentIntent(piId);
  if (!order) {
    logger.warn({ piId }, "charge.dispute.created webhook received for unknown payment intent");
    return;
  }

  try {
    await transitionOrder(order, "disputed", {
      extraUpdates: { preDisputeStatus: order.status },
    });
  } catch (err) {
    if (err instanceof AppError && err.code === "INVALID_TRANSITION") {
      logger.info({ orderId: order.id, currentStatus: order.status }, "charge.dispute.created webhook: transition not allowed (already processed)");
      return;
    }
    throw err;
  }

  logger.info({ orderId: order.id, preDisputeStatus: order.status }, "Order transitioned to disputed via webhook");
}

async function handleDisputeClosed(dispute: Stripe.Dispute) {
  const piId = dispute.payment_intent as string;
  if (!piId) {
    logger.warn("charge.dispute.closed webhook received without payment_intent");
    return;
  }

  const order = await findOrderByPaymentIntent(piId);
  if (!order) {
    logger.warn({ piId }, "charge.dispute.closed webhook received for unknown payment intent");
    return;
  }

  const preDisputeStatus = order.preDisputeStatus as string | null;

  if (dispute.status === "won") {
    if (!preDisputeStatus) {
      logger.warn({ orderId: order.id }, "charge.dispute.closed won but no preDisputeStatus stored");
      return;
    }

    try {
      await transitionOrder(order, preDisputeStatus as any, {
        extraUpdates: { preDisputeStatus: null },
      });
    } catch (err) {
      if (err instanceof AppError && err.code === "INVALID_TRANSITION") {
        logger.info({ orderId: order.id, currentStatus: order.status, preDisputeStatus }, "charge.dispute.closed won: transition not allowed (already processed)");
        return;
      }
      throw err;
    }

    logger.info({ orderId: order.id, restoredStatus: preDisputeStatus }, "Order reverted from disputed via webhook (dispute won)");
  } else if (dispute.status === "lost") {
    try {
      await transitionOrder(order, "refunded");
    } catch (err) {
      if (err instanceof AppError && err.code === "INVALID_TRANSITION") {
        logger.info({ orderId: order.id, currentStatus: order.status }, "charge.dispute.closed lost: transition not allowed (already processed)");
        return;
      }
      throw err;
    }

    logger.info({ orderId: order.id }, "Order transitioned to refunded via webhook (dispute lost)");
  }
}
