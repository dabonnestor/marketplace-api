import "dotenv/config";
import { z } from "zod";

const dbEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
});

const parsed = dbEnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("DATABASE_URL is required for database connection");
  process.exit(1);
}

export const dbConfig = Object.freeze(parsed.data);
