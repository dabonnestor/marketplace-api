import { db, schema } from "../../db/index.js";
import { eq, and } from "drizzle-orm";

export const ORDER_EXPIRY_MS = 30 * 60 * 1000;

export function isOrderExpired(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() > ORDER_EXPIRY_MS;
}

export async function expireOrderAndReleaseListing(orderId: string, listingId: string) {
  await db
    .update(schema.orders)
    .set({ status: "expired", updatedAt: new Date() })
    .where(eq(schema.orders.id, orderId));
  await db
    .update(schema.listings)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(schema.listings.id, listingId));
}

export async function getPendingOrderOnListing(listingId: string) {
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.listingId, listingId), eq(schema.orders.status, "pending")))
    .limit(1);
  return order ?? null;
}
