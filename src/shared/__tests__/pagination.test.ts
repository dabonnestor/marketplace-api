import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql, desc } from "drizzle-orm";
import { setupDb, cleanDb, closeDb, getDb } from "../../__tests__/helpers.js";
import * as schema from "../../db/schema.js";
import { paginate } from "../pagination.js";

const db = getDb();

beforeAll(async () => {
  await setupDb();
});

afterAll(async () => {
  await closeDb();
});

describe("paginate", () => {
  it("returns paginated results with correct shape", async () => {
    await cleanDb();

    // Create a user to satisfy FK constraint
    const [user] = await db
      .insert(schema.users)
      .values({
        email: "test@example.com",
        passwordHash: "hash",
        name: "Test User",
      })
      .returning();

    // Insert 3 listings for that user
    for (let i = 1; i <= 3; i++) {
      await db.insert(schema.listings).values({
        sellerId: user.id,
        title: `Item ${i}`,
        description: `Description ${i}`,
        price: (i * 10).toString(),
        category: "Books",
        condition: "New",
        shippingCost: "5.00",
        status: "active",
        images: [],
      });
    }

    const baseQuery = db
      .select()
      .from(schema.listings)
      .where(eq(schema.listings.status, "active"))
      .orderBy(desc(schema.listings.createdAt))
      ;

    const countQuery = db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.listings)
      .where(eq(schema.listings.status, "active"))
      ;

    const result = await paginate(baseQuery, countQuery, 1, 2);

    expect(result.data).toHaveLength(2);
    expect(result.pagination).toEqual({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
  });

  it("returns empty data and zero totals when no rows match", async () => {
    await cleanDb();

    const baseQuery = db
      .select()
      .from(schema.listings)
      .where(eq(schema.listings.status, "active"))
      ;

    const countQuery = db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.listings)
      .where(eq(schema.listings.status, "active"))
      ;

    const result = await paginate(baseQuery, countQuery, 1, 10);

    expect(result.data).toEqual([]);
    expect(result.pagination).toEqual({
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    });
  });
});
