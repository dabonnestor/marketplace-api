import { db, schema } from "../../db/index.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { paginate } from "../../shared/pagination.js";

export async function getOrder(orderId: string, userId: string) {
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .limit(1);

  if (!order) {
    throw new NotFoundError("Order", orderId);
  }

  if (order.buyerId !== userId && order.sellerId !== userId) {
    throw new ForbiddenError("You are not a participant in this order");
  }

  // For pending orders, include the stored client_secret so the frontend
  // can re-mount the Stripe PaymentElement after a page refresh.
  if (order.status === "pending" && order.stripeClientSecret) {
    return { ...order, clientSecret: order.stripeClientSecret };
  }

  return order;
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
