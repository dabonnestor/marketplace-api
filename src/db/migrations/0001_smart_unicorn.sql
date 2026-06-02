ALTER TYPE "public"."order_status" ADD VALUE 'expired';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'refunded';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stripe_payment_intent_id" varchar;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stripe_transfer_id" varchar;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stripe_refund_id" varchar;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pre_dispute_status" "order_status";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refunded_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_account_id" varchar;