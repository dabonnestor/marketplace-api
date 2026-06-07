import Stripe from "stripe";
import { db, schema } from "../../db/index.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { ensureParticipant } from "../../shared/guards.js";
import { paginate } from "../../shared/pagination.js";
import { calculateOrderBreakdown } from "./commission.js";
import { transition, type OrderStatus } from "./state-machine.js";
import { stripe } from "../payments/stripe-client.js";
import { toCents } from "../payments/amount-utils.js";
import { mapStripeError } from "../payments/error-mapping.js";
import { resolveListingReservation, expireIfStale } from "./expiry.js";

export async function createOrGetPaymentIntent(order: {
  id: string;
  total: string;
  buyerId: string;
  sellerId: string;
  listingId: string;
}) {
  try {
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: toCents(order.total),
        currency: "usd",
        capture_method: "automatic",
        payment_method_types: ["card"],
        metadata: {
          order_id: order.id,
          buyer_id: order.buyerId,
          seller_id: order.sellerId,
          listing_id: order.listingId,
        },
      },
      { idempotencyKey: order.id },
    );

    await db
      .update(schema.orders)
      .set({ stripePaymentIntentId: paymentIntent.id, updatedAt: new Date() })
      .where(eq(schema.orders.id, order.id));

    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret ?? null,
    };
  } catch (err) {
    throw mapStripeError(err);
  }
}

export async function createOrder(buyerId: string, listingId: string) {
  // Verify listing exists
  const [listing] = await db
    .select()
    .from(schema.listings)
    .where(eq(schema.listings.id, listingId))
    .limit(1);

  if (!listing) {
    throw new NotFoundError("Listing", listingId);
  }

  const effectiveStatus = await resolveListingReservation(listingId);

  if (effectiveStatus === "reserved") {
    throw new ConflictError("This listing already has a pending order");
  }

  if (effectiveStatus !== "active") {
    throw new AppError(400, "LISTING_NOT_AVAILABLE", `Cannot order this listing (status: ${effectiveStatus})`);
  }

  if (listing.sellerId === buyerId) {
    throw new AppError(400, "SELF_PURCHASE", "You cannot buy your own listing");
  }

  const subtotal = Number(listing.price);
  const shippingCost = Number(listing.shippingCost);
  const { platformFee, total, sellerPayout } = calculateOrderBreakdown(subtotal, shippingCost);

  const [order] = await db
    .insert(schema.orders)
    .values({
      buyerId,
      sellerId: listing.sellerId,
      listingId,
      subtotal: subtotal.toString(),
      shippingCost: shippingCost.toString(),
      platformFee: platformFee.toString(),
      total: total.toString(),
      sellerPayout: sellerPayout.toString(),
      status: "pending",
    })
    .returning();

  // Mark listing as reserved
  await db
    .update(schema.listings)
    .set({ status: "reserved", updatedAt: new Date() })
    .where(eq(schema.listings.id, listingId));

  // Create Stripe PaymentIntent
  const { id: stripePaymentIntentId, clientSecret } =
    await createOrGetPaymentIntent({
      id: order.id,
      total: order.total,
      buyerId: buyerId,
      sellerId: listing.sellerId,
      listingId,
    });

  return { ...order, stripePaymentIntentId, clientSecret: clientSecret ?? undefined };
}

export async function payOrder(orderId: string, userId: string) {
  const order = await getOrder(orderId, userId);

  if (order.buyerId !== userId) {
    throw new ForbiddenError("Only the buyer can pay for this order");
  }

  // Lazy expiry: if pending and expired, transition to expired and release listing
  if (await expireIfStale(order)) {
    throw new AppError(400, "ORDER_EXPIRED", "This order has expired and can no longer be paid");
  }

  // Confirm the PaymentIntent
  let stripePaymentIntentId = order.stripePaymentIntentId;
  if (!stripePaymentIntentId) {
    // Lazily create a PaymentIntent if missing
    const pi = await createOrGetPaymentIntent({
      id: order.id,
      total: order.total,
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      listingId: order.listingId,
    });
    stripePaymentIntentId = pi.id;
  }

  try {
    await stripe.paymentIntents.confirm(stripePaymentIntentId);
  } catch (err) {
    // If confirm threw a Stripe error, the payment may have succeeded on
    // Stripe's side despite a network timeout or connection error on ours.
    if (err instanceof Stripe.errors.StripeError) {
      try {
        const pi = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
        if (pi.status === "succeeded" || pi.status === "processing") {
          return transitionStatus(orderId, "paid", userId, order);
        }
      } catch {
        // retrieve also failed — Stripe is genuinely unreachable
      }
    }
    throw mapStripeError(err);
  }

  return transitionStatus(orderId, "paid", userId, order);
}

export async function cancelOrder(orderId: string, userId: string) {
  const order = await getOrder(orderId, userId);

  if (order.buyerId !== userId) {
    throw new ForbiddenError("Only the buyer can cancel this order");
  }

  // Lazy expiry: if pending and expired, transition to expired instead of cancelled
  if (await expireIfStale(order)) {
    const [refreshed] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);
    return refreshed;
  }

  // Cancel the PaymentIntent if exists
  if (order.stripePaymentIntentId) {
    try {
      await stripe.paymentIntents.cancel(order.stripePaymentIntentId);
    } catch (err) {
      throw mapStripeError(err);
    }
  }

  const updated = await transitionStatus(orderId, "cancelled", userId);

  // Release the listing
  await db
    .update(schema.listings)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(schema.listings.id, order.listingId));

  return updated;
}

export async function getOrder(orderId: string, userId: string) {
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .limit(1);

  if (!order) {
    throw new NotFoundError("Order", orderId);
  }

  ensureParticipant(order, userId);

  // For pending orders, return the client_secret so the frontend can
  // mount the Stripe PaymentElement after a page refresh.
  if (order.status === "pending" && order.stripePaymentIntentId) {
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: toCents(order.total),
        currency: "usd",
        capture_method: "automatic",
        payment_method_types: ["card"],
        metadata: {
          order_id: order.id,
          buyer_id: order.buyerId,
          seller_id: order.sellerId,
          listing_id: order.listingId,
        },
      },
      { idempotencyKey: order.id },
    );
    return { ...order, clientSecret: paymentIntent.client_secret ?? undefined };
  }

  return order;
}

export async function executeTransition(
  orderId: string,
  newStatus: OrderStatus,
  result: { allowed: boolean; timestampField?: string },
  extraUpdates?: Record<string, unknown>,
) {
  const updates: Record<string, unknown> = {
    status: newStatus,
    updatedAt: new Date(),
    ...extraUpdates,
  };
  if (result.timestampField) {
    updates[result.timestampField] = new Date();
  }

  const [updated] = await db
    .update(schema.orders)
    .set(updates)
    .where(eq(schema.orders.id, orderId))
    .returning();

  return updated;
}

export async function transitionStatus(
  orderId: string,
  newStatus: OrderStatus,
  userId: string,
  prefetchedOrder?: Awaited<ReturnType<typeof getOrder>>,
) {
  const order = prefetchedOrder ?? await getOrder(orderId, userId);
  const currentStatus = order.status as OrderStatus;
  const role = order.buyerId === userId ? "buyer" : "seller";

  const result = transition(currentStatus, newStatus, role, order.preDisputeStatus as OrderStatus | undefined);

  if (!result.allowed) {
    if (result.errorCode === "FORBIDDEN") {
      throw new ForbiddenError(result.error!);
    }
    throw new AppError(400, result.errorCode ?? "INVALID_TRANSITION", result.error!);
  }

  return executeTransition(orderId, newStatus, result);
}

export async function listBuyerOrders(buyerId: string, page: number, limit: number, status?: string) {
  const conditions = [eq(schema.orders.buyerId, buyerId)];
  if (status) conditions.push(eq(schema.orders.status, status as any));

  const baseQuery = db
    .select()
    .from(schema.orders)
    .where(and(...conditions))
    .orderBy(desc(schema.orders.createdAt));

  const countQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.orders)
    .where(and(...conditions));

  return paginate(baseQuery, countQuery, page, limit);
}

export async function listSellerOrders(sellerId: string, page: number, limit: number, status?: string) {
  const conditions = [eq(schema.orders.sellerId, sellerId)];
  if (status) conditions.push(eq(schema.orders.status, status as any));

  const baseQuery = db
    .select()
    .from(schema.orders)
    .where(and(...conditions))
    .orderBy(desc(schema.orders.createdAt));

  const countQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.orders)
    .where(and(...conditions));

  return paginate(baseQuery, countQuery, page, limit);
}

export async function refundOrder(orderId: string, userId: string) {
  const order = await getOrder(orderId, userId);

  if (order.buyerId !== userId) {
    throw new ForbiddenError("Only the buyer can request a refund");
  }

  let stripeRefundId: string;
  try {
    const refund = await stripe.refunds.create({
      payment_intent: order.stripePaymentIntentId!,
      amount: toCents(order.total),
    });
    stripeRefundId = refund.id;
  } catch (err) {
    throw mapStripeError(err);
  }

  const updated = await transitionStatus(orderId, "refunded", userId);

  await db
    .update(schema.orders)
    .set({ stripeRefundId, updatedAt: new Date() })
    .where(eq(schema.orders.id, orderId));

  return { ...updated, stripeRefundId };
}
