import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createApp } from "../app.js";
import * as schema from "../db/schema.js";

const TEST_DB_URL =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/marketplace_test";

let pool: pg.Pool;

export function getDb() {
  if (!pool) {
    pool = new pg.Pool({ connectionString: TEST_DB_URL });
  }
  return drizzle(pool, { schema });
}

export function getApp() {
  return createApp();
}

let migrated = false;

export async function setupDb() {
  if (migrated) return;
  const db = getDb();

  // Drop and recreate schema for clean test state
  await db.execute("DROP SCHEMA public CASCADE");
  await db.execute("CREATE SCHEMA public");
  await db.execute("GRANT ALL ON SCHEMA public TO postgres");
  await db.execute("GRANT ALL ON SCHEMA public TO public");

  // Run Drizzle migrations
  await migrate(db, { migrationsFolder: "./src/db/migrations" });

  migrated = true;
}

export async function cleanDb() {
  const db = getDb();
  await db.delete(schema.orders);
  await db.delete(schema.listings);
  await db.delete(schema.users);
}

export async function closeDb() {
  if (pool) {
    await pool.end();
  }
}
