import { db, schema } from "../../db/index.js";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../shared/errors.js";
import { ensureParticipant } from "../../shared/guards.js";
import { paginate } from "../../shared/pagination.js";
import { calculateOrderBreakdown } from "./commission.js";
import { transition, type OrderStatus } from "./state-machine.js";
import {
  createPaymentIntent,
  retrievePaymentIntent,
  confirmPaymentIntent,
  cancelPaymentIntent,
  createRefund,
  createTransfer,
} from "../../shared/payments/payments-adapter.js";
import { logger } from "../../shared/logger.js";
import { resolveListingStatus } from "../../shared/reservation.js";
import { expireIfStale } from "./expiry.js";

export async function createOrGetPaymentIntent(order: {
  id: string;
  total: string;
  buyerId: string;
  sellerId: string;
  listingId: string;
}) {
  const { id, clientSecret } = await createPaymentIntent({
    idempotencyKey: order.id,
    amount: order.total,
    metadata: {
      order_id: order.id,
      buyer_id: order.buyerId,
      seller_id: order.sellerId,
      listing_id: order.listingId,
    },
  });

  await db
    .update(schema.orders)
    .set({ stripePaymentIntentId: id, stripeClientSecret: clientSecret, updatedAt: new Date() })
    .where(eq(schema.orders.id, order.id));

  return { id, clientSecret };
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

  const effectiveStatus = await resolveListingStatus(listingId);

  if (effectiveStatus === "reserved") {
    throw new ConflictError("This listing already has a pending order");
  }

  if (effectiveStatus !== "active") {
    throw new AppError(
      400,
      "LISTING_NOT_AVAILABLE",
      `Cannot order this listing (status: ${effectiveStatus})`,
    );
  }

  if (listing.sellerId === buyerId) {
    throw new AppError(400, "SELF_PURCHASE", "You cannot buy your own listing");
  }

  const subtotal = Number(listing.price);
  const shippingCost = Number(listing.shippingCost);
  const { platformFee, total, sellerPayout } = calculateOrderBreakdown(
    subtotal,
    shippingCost,
  );

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

  return {
    ...order,
    stripePaymentIntentId,
    clientSecret: clientSecret ?? undefined,
  };
}

export async function payOrder(orderId: string, userId: string) {
  const order = await getOrder(orderId, userId);

  if (order.buyerId !== userId) {
    throw new ForbiddenError("Only the buyer can pay for this order");
  }

  if (order.status !== "pending") {
    // Webhook may have already transitioned the order to paid.
    // Return the order as-is instead of throwing — the caller wanted it paid, it is paid.
    if (order.status === "paid") {
      return order;
    }
    throw new AppError(
      400,
      "INVALID_TRANSITION",
      `Cannot pay an order with status '${order.status}'`,
    );
  }

  // Lazy expiry: if pending and expired, transition to expired and release listing
  if (await expireIfStale(order)) {
    throw new AppError(
      400,
      "ORDER_EXPIRED",
      "This order has expired and can no longer be paid",
    );
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

  const pi = await retrievePaymentIntent(stripePaymentIntentId);

  if (pi.status === "requires_confirmation") {
    await confirmPaymentIntent(stripePaymentIntentId);
  } else if (pi.status !== "succeeded" && pi.status !== "processing") {
    throw new AppError(
      400,
      "PAYMENT_NOT_CONFIRMED",
      `PaymentIntent status is '${pi.status}'. Complete payment on the frontend first.`,
    );
  }

  // Re-read after Stripe confirmation — the payment_intent.succeeded
  // webhook may have already transitioned the order to "paid".
  const current = await getOrder(orderId, userId);
  if (current.status === "paid") {
    return current;
  }

  return transitionOrder(current, "paid", { userId });
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
    await cancelPaymentIntent(order.stripePaymentIntentId);
  }

  const updated = await transitionOrder(order, "cancelled", { userId });

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

  // For pending orders, include the stored client_secret so the frontend
  // can re-mount the Stripe PaymentElement after a page refresh.
  if (order.status === "pending" && order.stripeClientSecret) {
    return { ...order, clientSecret: order.stripeClientSecret };
  }

  return order;
}

export async function transitionOrder(
  order: { id: string; status: string; buyerId: string; sellerId: string; preDisputeStatus?: string | null },
  newStatus: OrderStatus,
  options?: { userId?: string; extraUpdates?: Record<string, unknown> },
) {
  const currentStatus = order.status as OrderStatus;

  let role: "buyer" | "seller" | undefined;
  if (options?.userId) {
    // Re-check participant since we already validated in getOrder for user paths
    if (order.buyerId !== options.userId && order.sellerId !== options.userId) {
      throw new ForbiddenError("You are not a participant in this order");
    }
    role = order.buyerId === options.userId ? "buyer" : "seller";
  }

  const result = transition(
    currentStatus,
    newStatus,
    role,
    order.preDisputeStatus as OrderStatus | undefined,
  );

  if (!result.allowed) {
    if (result.errorCode === "FORBIDDEN") {
      throw new ForbiddenError(result.error!);
    }
    throw new AppError(
      400,
      result.errorCode ?? "INVALID_TRANSITION",
      result.error!,
    );
  }

  return executeTransition(order.id, newStatus, result, options?.extraUpdates);
}

async function executeTransition(
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
) {
  const order = await getOrder(orderId, userId);
  return transitionOrder(order, newStatus, { userId });
}

export async function listBuyerOrders(
  buyerId: string,
  page: number,
  limit: number,
  status?: string,
) {
  const conditions = [eq(schema.orders.buyerId, buyerId)];
  if (status) conditions.push(eq(schema.orders.status, status as any));

  const baseQuery = db
    .select({
      order: schema.orders,
      listingTitle: schema.listings.title,
      listingImage: sql<string>`${schema.listings.images}[1]`,
    })
    .from(schema.orders)
    .leftJoin(schema.listings, eq(schema.orders.listingId, schema.listings.id))
    .where(and(...conditions))
    .orderBy(desc(schema.orders.createdAt));

  const countQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.orders)
    .where(and(...conditions));

  const result = await paginate(baseQuery, countQuery, page, limit);
  return {
    data: result.data.map((row) => ({
      ...row.order,
      listingTitle: row.listingTitle,
      listingImage: row.listingImage,
    })),
    pagination: result.pagination,
  };
}

export async function listSellerOrders(
  sellerId: string,
  page: number,
  limit: number,
  status?: string,
) {
  const conditions = [eq(schema.orders.sellerId, sellerId)];
  if (status) conditions.push(eq(schema.orders.status, status as any));

  const baseQuery = db
    .select({
      order: schema.orders,
      listingTitle: schema.listings.title,
      listingImage: sql<string>`${schema.listings.images}[1]`,
    })
    .from(schema.orders)
    .leftJoin(schema.listings, eq(schema.orders.listingId, schema.listings.id))
    .where(and(...conditions))
    .orderBy(desc(schema.orders.createdAt));

  const countQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.orders)
    .where(and(...conditions));

  const result = await paginate(baseQuery, countQuery, page, limit);
  return {
    data: result.data.map((row) => ({
      ...row.order,
      listingTitle: row.listingTitle,
      listingImage: row.listingImage,
    })),
    pagination: result.pagination,
  };
}

export async function refundOrder(orderId: string, userId: string) {
  const order = await getOrder(orderId, userId);

  if (order.buyerId !== userId) {
    throw new ForbiddenError("Only the buyer can request a refund");
  }

  const { id: stripeRefundId } = await createRefund({
    paymentIntentId: order.stripePaymentIntentId!,
    amount: order.total,
  });

  const updated = await transitionOrder(order, "refunded", { userId });

  await db
    .update(schema.orders)
    .set({ stripeRefundId, updatedAt: new Date() })
    .where(eq(schema.orders.id, orderId));

  return { ...updated, stripeRefundId };
}

export async function completeOrder(orderId: string, userId: string) {
  const order = await getOrder(orderId, userId);

  const [seller] = await db
    .select({ stripeAccountId: schema.users.stripeAccountId })
    .from(schema.users)
    .where(eq(schema.users.id, order.sellerId))
    .limit(1);

  if (!seller?.stripeAccountId) {
    logger.error({ orderId, sellerId: order.sellerId }, "Seller has no Stripe account");
    throw new AppError(502, "TRANSFER_FAILED", "Stripe transfer failed");
  }

  const { id: stripeTransferId } = await createTransfer({
    amount: order.sellerPayout,
    destination: seller.stripeAccountId,
    metadata: {
      order_id: order.id,
      buyer_id: order.buyerId,
      seller_id: order.sellerId,
    },
  });

  const updated = await transitionOrder(order, "completed", { userId });

  await db
    .update(schema.orders)
    .set({ stripeTransferId, updatedAt: new Date() })
    .where(eq(schema.orders.id, orderId));

  return { ...updated, stripeTransferId };
}
