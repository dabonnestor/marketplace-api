import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { db, schema } from "../../db/index.js";
import { logger } from "../../shared/logger.js";
import { transition, type OrderStatus } from "../orders/state-machine.js";
import { executeTransition } from "../orders/orders.service.js";

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

  const currentStatus = order.status as OrderStatus;
  const result = transition(currentStatus, "paid");

  if (!result.allowed) {
    logger.info({ orderId, currentStatus }, "payment_intent.succeeded webhook: transition not allowed (already processed)");
    return;
  }

  await executeTransition(orderId, "paid", result);

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

  const currentStatus = order.status as OrderStatus;
  const result = transition(currentStatus, "disputed");

  if (!result.allowed) {
    logger.info({ orderId: order.id, currentStatus }, "charge.dispute.created webhook: transition not allowed (already processed)");
    return;
  }

  await executeTransition(order.id, "disputed", result, { preDisputeStatus: currentStatus });

  logger.info({ orderId: order.id, preDisputeStatus: currentStatus }, "Order transitioned to disputed via webhook");
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

  const currentStatus = order.status as OrderStatus;
  const disputeStatus = dispute.status;
  const preDisputeStatus = order.preDisputeStatus as OrderStatus | null;

  if (disputeStatus === "won") {
    if (!preDisputeStatus) {
      logger.warn({ orderId: order.id }, "charge.dispute.closed won but no preDisputeStatus stored");
      return;
    }

    const result = transition(currentStatus, preDisputeStatus, undefined, preDisputeStatus);

    if (!result.allowed) {
      logger.info({ orderId: order.id, currentStatus, preDisputeStatus }, "charge.dispute.closed won: transition not allowed (already processed)");
      return;
    }

    await executeTransition(order.id, preDisputeStatus, result, { preDisputeStatus: null });

    logger.info({ orderId: order.id, restoredStatus: preDisputeStatus }, "Order reverted from disputed via webhook (dispute won)");
  } else if (disputeStatus === "lost") {
    const result = transition(currentStatus, "refunded");

    if (!result.allowed) {
      logger.info({ orderId: order.id, currentStatus }, "charge.dispute.closed lost: transition not allowed (already processed)");
      return;
    }

    await executeTransition(order.id, "refunded", result);

    logger.info({ orderId: order.id }, "Order transitioned to refunded via webhook (dispute lost)");
  }
}
