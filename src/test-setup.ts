import "dotenv/config";

process.env.DATABASE_URL =
  "postgresql://postgres:ahmer112021@localhost:5432/marketplace_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-that-is-at-least-32-chars-long!!!";
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "test-refresh-secret-that-is-at-least-32-chars!!";
process.env.NODE_ENV = "test";
