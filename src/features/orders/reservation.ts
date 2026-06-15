import { db, schema } from "../../db/index.js";
import { eq, and } from "drizzle-orm";
import { expireIfStale } from "./order-lifecycle/expiry.js";
export { expireIfStale };

async function getPendingOrderOnListing(listingId: string) {
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

async function resolveListingStatus(
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
      const expired = await expireIfStale(pendingOrder);
      if (expired) return "active";
    }
  }

  return listing.status;
}

/**
 * Can this listing be ordered? True only when the effective status is "active".
 */
export async function isAvailable(listingId: string): Promise<boolean> {
  const status = await resolveListingStatus(listingId);
  return status === "active";
}

/**
 * Effective listing status, with lazy expiry of stale reservations.
 */
export async function getStatus(listingId: string): Promise<string> {
  return resolveListingStatus(listingId);
}
