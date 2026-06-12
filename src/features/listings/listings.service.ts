import { db, schema } from "../../db/index.js";
import { eq, and, sql, gte, lte, desc } from "drizzle-orm";
import { AppError, ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { paginate } from "../../shared/pagination.js";
import { retrieveAccount } from "../../shared/payments/payments-adapter.js";
import { resolveListingStatus } from "../../shared/reservation.js";
import type { CreateListingInput, UpdateListingInput, ListListingsQuery } from "./listings.schemas.js";

async function ensureOnboarded(sellerId: string) {
  const [user] = await db
    .select({ stripeAccountId: schema.users.stripeAccountId })
    .from(schema.users)
    .where(eq(schema.users.id, sellerId))
    .limit(1);

  if (!user?.stripeAccountId) {
    throw new AppError(400, "ONBOARDING_REQUIRED", "Seller must complete Stripe Connect onboarding before creating listings");
  }

  const account = await retrieveAccount(user.stripeAccountId);

  if (!account.charges_enabled) {
    throw new AppError(400, "ONBOARDING_REQUIRED", "Seller must complete Stripe Connect onboarding before creating listings");
  }
}

export async function create(data: CreateListingInput, sellerId: string) {
  await ensureOnboarded(sellerId);

  const [listing] = await db
    .insert(schema.listings)
    .values({
      ...data,
      price: data.price.toString(),
      shippingCost: data.shippingCost.toString(),
      sellerId,
    })
    .returning();
  return listing;
}

export async function getById(id: string) {
  const [row] = await db
    .select({
      listing: schema.listings,
      sellerName: schema.users.name,
    })
    .from(schema.listings)
    .leftJoin(schema.users, eq(schema.listings.sellerId, schema.users.id))
    .where(eq(schema.listings.id, id))
    .limit(1);

  if (!row) {
    throw new NotFoundError("Listing", id);
  }

  const listing = { ...row.listing, sellerName: row.sellerName };

  // Lazy expiry: if listing is reserved but the pending order has expired, release it
  listing.status = await resolveListingStatus(id);

  return listing;
}

export async function update(id: string, data: UpdateListingInput, sellerId: string) {
  const listing = await getById(id);

  if (listing.sellerId !== sellerId) {
    throw new ForbiddenError("You can only modify your own resource");
  }

  const setData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.title !== undefined) setData.title = data.title;
  if (data.description !== undefined) setData.description = data.description;
  if (data.price !== undefined) setData.price = data.price.toString();
  if (data.category !== undefined) setData.category = data.category;
  if (data.condition !== undefined) setData.condition = data.condition;
  if (data.shippingCost !== undefined) setData.shippingCost = data.shippingCost.toString();
  if (data.images !== undefined) setData.images = data.images;

  const [updated] = await db
    .update(schema.listings)
    .set(setData)
    .where(eq(schema.listings.id, id))
    .returning();

  return updated;
}

export async function remove(id: string, sellerId: string) {
  const listing = await getById(id);

  if (listing.sellerId !== sellerId) {
    throw new ForbiddenError("You can only modify your own resource");
  }

  await db.delete(schema.listings).where(eq(schema.listings.id, id));
}

export async function list(query: ListListingsQuery) {
  const conditions: ReturnType<typeof eq>[] = [];

  // Only show active listings
  conditions.push(eq(schema.listings.status, "active"));

  if (query.category) {
    conditions.push(eq(schema.listings.category, query.category));
  }

  if (query.minPrice) {
    conditions.push(gte(schema.listings.price, query.minPrice.toString()));
  }

  if (query.maxPrice) {
    conditions.push(lte(schema.listings.price, query.maxPrice.toString()));
  }

  if (query.search) {
    // Full-text search with tsvector
    conditions.push(
      sql`to_tsvector('english', coalesce(${schema.listings.title}, '') || ' ' || coalesce(${schema.listings.description}, '')) @@ plainto_tsquery('english', ${query.search})`,
    );
  }

  const baseQuery = db
    .select({
      listing: schema.listings,
      sellerName: schema.users.name,
    })
    .from(schema.listings)
    .leftJoin(schema.users, eq(schema.listings.sellerId, schema.users.id))
    .where(and(...conditions))
    .orderBy(desc(schema.listings.createdAt));

  const countQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.listings)
    .where(and(...conditions));

  const result = await paginate(baseQuery, countQuery, query.page, query.limit);
  return {
    data: result.data.map((row) => ({ ...row.listing, sellerName: row.sellerName })),
    pagination: result.pagination,
  };
}

export async function getBySeller(sellerId: string, page: number, limit: number) {
  const baseQuery = db
    .select({
      listing: schema.listings,
      sellerName: schema.users.name,
    })
    .from(schema.listings)
    .leftJoin(schema.users, eq(schema.listings.sellerId, schema.users.id))
    .where(eq(schema.listings.sellerId, sellerId))
    .orderBy(desc(schema.listings.createdAt));

  const countQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.listings)
    .where(eq(schema.listings.sellerId, sellerId));

  const result = await paginate(baseQuery, countQuery, page, limit);
  return {
    data: result.data.map((row) => ({ ...row.listing, sellerName: row.sellerName })),
    pagination: result.pagination,
  };
}
