import { db, schema } from "../../db/index.js";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { AppError } from "../../shared/errors.js";
import { stripe } from "../payments/stripe-client.js";
import { toCents } from "../payments/amount-utils.js";
import { logger } from "../../shared/logger.js";
import { transitionStatus, getOrder } from "./orders.service.js";

export async function createStripeTransfer(order: {
  id: string;
  sellerId: string;
  buyerId: string;
  sellerPayout: string;
}) {
  const [seller] = await db
    .select({ stripeAccountId: schema.users.stripeAccountId })
    .from(schema.users)
    .where(eq(schema.users.id, order.sellerId))
    .limit(1);

  try {
    const transfer = await stripe.transfers.create({
      amount: toCents(order.sellerPayout),
      currency: "usd",
      destination: seller!.stripeAccountId!,
      metadata: {
        order_id: order.id,
        buyer_id: order.buyerId,
        seller_id: order.sellerId,
      },
    });
    return transfer.id;
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      logger.error(
        { stripeRequestId: err.requestId, stripeType: err.type },
        "Stripe transfer failed",
      );
      throw new AppError(502, "TRANSFER_FAILED", "Stripe transfer failed");
    }
    throw err;
  }
}

export async function completeOrder(orderId: string, userId: string) {
  // Fetch the order first — if the transfer fails, the order stays in its current state
  const order = await getOrder(orderId, userId);

  // Create the transfer before transitioning, so a failure leaves the order untouched
  const stripeTransferId = await createStripeTransfer(order);

  // Transition to completed
  const updated = await transitionStatus(orderId, "completed", userId);

  // Save the transfer ID
  await db
    .update(schema.orders)
    .set({ stripeTransferId, updatedAt: new Date() })
    .where(eq(schema.orders.id, orderId));

  return { ...updated, stripeTransferId };
}
