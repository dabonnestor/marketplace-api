import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./index.js";
import { logger } from "../shared/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(__dirname, "migrations");

async function runMigrations() {
  logger.info("Running database migrations...");
  await migrate(db, { migrationsFolder });
  logger.info("Migrations complete.");
  process.exit(0);
}

runMigrations().catch((err) => {
  logger.error(err, "Migration failed");
  process.exit(1);
});
