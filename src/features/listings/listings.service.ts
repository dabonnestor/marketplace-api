import { db, schema } from "../../db/index.js";
import { eq, and, sql, gte, lte, desc } from "drizzle-orm";
import { NotFoundError, ForbiddenError } from "../../shared/errors.js";
import type { CreateListingInput, UpdateListingInput, ListListingsQuery } from "./listings.schemas.js";

export async function create(data: CreateListingInput, sellerId: string) {
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
  const [listing] = await db
    .select()
    .from(schema.listings)
    .where(eq(schema.listings.id, id))
    .limit(1);

  if (!listing) {
    throw new NotFoundError("Listing", id);
  }

  return listing;
}

export async function update(id: string, data: UpdateListingInput, sellerId: string) {
  const listing = await getById(id);

  if (listing.sellerId !== sellerId) {
    throw new ForbiddenError("You can only update your own listings");
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
    throw new ForbiddenError("You can only delete your own listings");
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

  const offset = (query.page - 1) * query.limit;

  const [results, [{ count }]] = await Promise.all([
    db
      .select()
      .from(schema.listings)
      .where(and(...conditions))
      .orderBy(desc(schema.listings.createdAt))
      .limit(query.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.listings)
      .where(and(...conditions)),
  ]);

  return {
    data: results,
    pagination: {
      page: query.page,
      limit: query.limit,
      total: count,
      totalPages: Math.ceil(count / query.limit),
    },
  };
}

export async function getBySeller(sellerId: string, page: number, limit: number) {
  const offset = (page - 1) * limit;

  const [results, [{ count }]] = await Promise.all([
    db
      .select()
      .from(schema.listings)
      .where(eq(schema.listings.sellerId, sellerId))
      .orderBy(desc(schema.listings.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.listings)
      .where(eq(schema.listings.sellerId, sellerId)),
  ]);

  return {
    data: results,
    pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
  };
}
