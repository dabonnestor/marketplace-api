import { db, schema } from "../../db/index.js";
import { eq, and, sql } from "drizzle-orm";

export const ORDER_EXPIRY_MINUTES = 30;

export async function expireOrderAndReleaseListing(
  orderId: string,
  listingId: string,
) {
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
    .where(
      and(
        eq(schema.orders.listingId, listingId),
        eq(schema.orders.status, "pending"),
      ),
    )
    .limit(1);
  return order ?? null;
}

export async function expireOrderAndReleaseListingIfStale(
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

export async function resolveListingReservation(
  listingId: string,
): Promise<string> {
  const [listing] = await db
    .select()
    .from(schema.listings)
    .where(eq(schema.listings.id, listingId))
    .limit(1);

  if (!listing) {
    return "not_found";
  }

  if (listing.status === "reserved") {
    const pendingOrder = await getPendingOrderOnListing(listingId);
    if (pendingOrder) {
      const expired = await expireOrderAndReleaseListingIfStale(
        pendingOrder.id,
        listingId,
      );
      if (expired) return "active";
    }
  }

  return listing.status;
}
