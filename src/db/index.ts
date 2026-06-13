import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { dbConfig } from "../shared/db-config.js";
import * as schema from "./schema.js";

const pool = new pg.Pool({
  connectionString: dbConfig.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
export { schema };
