import { pgTable, uuid, varchar, timestamp, integer, decimal, text, index, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userRoleEnum = pgEnum("user_role", ["buyer", "seller"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  stripeAccountId: varchar("stripe_account_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "paid",
  "shipped",
  "delivered",
  "completed",
  "disputed",
  "cancelled",
  "expired",
  "refunded",
]);

export const listings = pgTable(
  "listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => users.id),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description").notNull(),
    price: decimal("price", { precision: 12, scale: 2 }).notNull(),
    category: varchar("category", { length: 100 }).notNull(),
    condition: varchar("condition", { length: 50 }).notNull(),
    shippingCost: decimal("shipping_cost", { precision: 10, scale: 2 }).notNull().default("0"),
    images: text("images").array().notNull().default([]),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("listings_seller_id_idx").on(table.sellerId),
    index("listings_category_idx").on(table.category),
    index("listings_status_idx").on(table.status),
    index("listings_search_idx").using(
      "gin",
      sql`(to_tsvector('english', coalesce(${table.title}, '') || ' ' || coalesce(${table.description}, '')))`,
    ),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    buyerId: uuid("buyer_id")
      .notNull()
      .references(() => users.id),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => users.id),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id),
    status: orderStatusEnum("status").notNull().default("pending"),
    subtotal: decimal("subtotal", { precision: 12, scale: 2 }).notNull(),
    shippingCost: decimal("shipping_cost", { precision: 10, scale: 2 }).notNull().default("0"),
    platformFee: decimal("platform_fee", { precision: 10, scale: 2 }).notNull(),
    total: decimal("total", { precision: 12, scale: 2 }).notNull(),
    sellerPayout: decimal("seller_payout", { precision: 12, scale: 2 }).notNull(),
    stripePaymentIntentId: varchar("stripe_payment_intent_id"),
    stripeClientSecret: varchar("stripe_client_secret"),
    stripeTransferId: varchar("stripe_transfer_id"),
    stripeRefundId: varchar("stripe_refund_id"),
    preDisputeStatus: orderStatusEnum("pre_dispute_status"),
    paidAt: timestamp("paid_at"),
    shippedAt: timestamp("shipped_at"),
    deliveredAt: timestamp("delivered_at"),
    completedAt: timestamp("completed_at"),
    refundedAt: timestamp("refunded_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("orders_buyer_id_idx").on(table.buyerId),
    index("orders_seller_id_idx").on(table.sellerId),
    index("orders_status_idx").on(table.status),
  ],
);
