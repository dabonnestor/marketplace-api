import "dotenv/config";

// Override for tests
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/marketplace_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-that-is-at-least-32-chars-long!!!";
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "test-refresh-secret-that-is-at-least-32-chars!!";
process.env.NODE_ENV = "test";
