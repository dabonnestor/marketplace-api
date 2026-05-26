import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createApp } from "../app.js";
import * as schema from "../db/schema.js";

const TEST_DB_URL = process.env.DATABASE_URL;

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

  // Drop all user objects from public and the drizzle tracking schema
  await db.execute(`
    DO $$ DECLARE
      r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
      FOR r IN (SELECT typname FROM pg_type WHERE typnamespace = 'public'::regnamespace) LOOP
        EXECUTE 'DROP TYPE IF EXISTS public.' || quote_ident(r.typname) || ' CASCADE';
      END LOOP;
    END $$;
  `);
  // Reset drizzle migration tracking so migrations re-apply from scratch
  await db.execute("DROP TABLE IF EXISTS drizzle.__drizzle_migrations");

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
