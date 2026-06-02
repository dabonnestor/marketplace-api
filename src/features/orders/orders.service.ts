import { db, schema } from "../../db/index.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { NotFoundError, ForbiddenError, AppError } from "../../shared/errors.js";
import { ensureParticipant } from "../../shared/guards.js";
import { paginate } from "../../shared/pagination.js";
import { PLATFORM_FEE_PERCENT } from "./orders.schemas.js";
import { transition, type OrderStatus } from "./state-machine.js";

export async function createOrder(buyerId: string, listingId: string) {
  // Verify listing exists and is active
  const [listing] = await db
    .select()
    .from(schema.listings)
    .where(and(eq(schema.listings.id, listingId), eq(schema.listings.status, "active")))
    .limit(1);

  if (!listing) {
    throw new NotFoundError("Listing", listingId);
  }

  if (listing.sellerId === buyerId) {
    throw new AppError(400, "SELF_PURCHASE", "You cannot buy your own listing");
  }

  const subtotal = Number(listing.price);
  const shippingCost = Number(listing.shippingCost);
  const platformFee = Math.round((subtotal * PLATFORM_FEE_PERCENT) / 100 * 100) / 100;
  const total = subtotal + shippingCost;
  const sellerPayout = total - platformFee;

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

  // Mark listing as sold
  await db
    .update(schema.listings)
    .set({ status: "sold", updatedAt: new Date() })
    .where(eq(schema.listings.id, listingId));

  return order;
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

  return order;
}

export async function transitionStatus(
  orderId: string,
  newStatus: OrderStatus,
  userId: string,
) {
  const order = await getOrder(orderId, userId);
  const currentStatus = order.status as OrderStatus;
  const role = order.buyerId === userId ? "buyer" : "seller";

  const result = transition(currentStatus, newStatus, role, order.preDisputeStatus as OrderStatus | undefined);

  if (!result.allowed) {
    if (result.errorCode === "FORBIDDEN") {
      throw new ForbiddenError(result.error!);
    }
    throw new AppError(400, result.errorCode ?? "INVALID_TRANSITION", result.error!);
  }

  const updates: Record<string, unknown> = { status: newStatus, updatedAt: new Date() };
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
