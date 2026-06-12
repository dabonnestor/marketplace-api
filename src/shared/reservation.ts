import { db, schema } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import { expireIfStale } from "./order-lifecycle/expiry.js";

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

export async function resolveListingStatus(
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
