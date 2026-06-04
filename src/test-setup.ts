import "dotenv/config";

process.env.DATABASE_URL =
  "postgresql://postgres:REMOVED_PASSWORD@localhost:5432/marketplace_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-that-is-at-least-32-chars-long!!!";
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "test-refresh-secret-that-is-at-least-32-chars!!";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_dummy";
process.env.BASE_URL = process.env.BASE_URL || "http://localhost:8080";
process.env.NODE_ENV = "test";
