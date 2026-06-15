import { db, schema } from "../../../db/index.js";
import { eq, and, sql } from "drizzle-orm";

export const ORDER_EXPIRY_MINUTES = 30;

async function expireOrderAndReleaseListingIfStale(
  orderId: string,
  listingId: string,
): Promise<boolean> {
  const [updated] = await db
    .update(schema.orders)
    .set({ status: "expired", updatedAt: new Date() })
    .where(
      and(
        eq(schema.orders.id, orderId),
        eq(schema.orders.status, "pending"),
        sql`${schema.orders.createdAt} < now() - interval '${sql.raw(String(ORDER_EXPIRY_MINUTES))} minutes'`,
      ),
    )
    .returning();

  if (updated) {
    await db
      .update(schema.listings)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(schema.listings.id, listingId));
    return true;
  }
  return false;
}

export async function expireIfStale(order: {
  id: string;
  listingId: string;
  status: string;
}): Promise<boolean> {
  if (order.status !== "pending") return false;
  return expireOrderAndReleaseListingIfStale(order.id, order.listingId);
}
