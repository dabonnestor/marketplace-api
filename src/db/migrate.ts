import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./index.js";
import { logger } from "../shared/logger.js";

async function runMigrations() {
  logger.info("Running database migrations...");
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  logger.info("Migrations complete.");
  process.exit(0);
}

runMigrations().catch((err) => {
  logger.error(err, "Migration failed");
  process.exit(1);
});
