import { zodToJsonSchema } from "zod-to-json-schema";
import { createOrderSchema } from "./orders.schemas.js";

const orderSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string", format: "uuid" },
    buyerId: { type: "string", format: "uuid" },
    sellerId: { type: "string", format: "uuid" },
    listingId: { type: "string", format: "uuid" },
    status: { type: "string", enum: ["pending", "paid", "shipped", "delivered", "completed", "disputed", "cancelled", "expired", "refunded"] },
    subtotal: { type: "string" },
    shippingCost: { type: "string" },
    platformFee: { type: "string" },
    total: { type: "string" },
    sellerPayout: { type: "string" },
    stripePaymentIntentId: { type: "string" },
    stripeTransferId: { type: "string" },
    stripeRefundId: { type: "string" },
    preDisputeStatus: { type: "string", enum: ["pending", "paid", "shipped", "delivered", "completed", "disputed", "cancelled", "expired", "refunded"] },
    paidAt: { type: "string", format: "date-time" },
    shippedAt: { type: "string", format: "date-time" },
    deliveredAt: { type: "string", format: "date-time" },
    completedAt: { type: "string", format: "date-time" },
    refundedAt: { type: "string", format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const orderCreatedSchema = {
  ...orderSchema,
  properties: {
    ...orderSchema.properties,
    clientSecret: { type: "string" },
  },
};

export const orderSchemas = {
  CreateOrderRequest: zodToJsonSchema(createOrderSchema) as any,
  Order: orderSchema,
  OrderCreated: orderCreatedSchema,
};

export const orderPaths = {
  "/api/v1/orders": {
    post: {
      tags: ["Orders"],
      summary: "Create an order from a listing (buyer)",
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/CreateOrderRequest" } } },
      },
      responses: {
        "201": { description: "Order created with PaymentIntent client secret for frontend confirmation", content: { "application/json": { schema: { $ref: "#/components/schemas/OrderCreated" } } } },
        "400": { description: "Validation error or self-purchase" },
        "401": { description: "Not authenticated" },
        "404": { description: "Listing not found" },
      },
    },
  },
  "/api/v1/orders/buyer/purchases": {
    get: {
      tags: ["Orders"],
      summary: "List buyer's purchases",
      parameters: [
        { name: "page", in: "query", schema: { type: "integer", default: 1 } },
        { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        { name: "status", in: "query", schema: { type: "string" } },
      ],
      responses: {
        "200": {
          description: "Paginated orders",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: { type: "array", items: { $ref: "#/components/schemas/Order" } },
                  pagination: { $ref: "#/components/schemas/Pagination" },
                },
              },
            },
          },
        },
      },
    },
  },
  "/api/v1/orders/seller/sales": {
    get: {
      tags: ["Orders"],
      summary: "List seller's sales",
      parameters: [
        { name: "page", in: "query", schema: { type: "integer", default: 1 } },
        { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        { name: "status", in: "query", schema: { type: "string" } },
      ],
      responses: {
        "200": {
          description: "Paginated orders",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: { type: "array", items: { $ref: "#/components/schemas/Order" } },
                  pagination: { $ref: "#/components/schemas/Pagination" },
                },
              },
            },
          },
        },
      },
    },
  },
  "/api/v1/orders/{id}": {
    get: {
      tags: ["Orders"],
      summary: "Get a single order (buyer or seller only)",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
      responses: {
        "200": { description: "Order", content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } },
        "403": { description: "Not a participant" },
        "404": { description: "Not found" },
      },
    },
  },
  "/api/v1/orders/{id}/status": {
    patch: {
      tags: ["Orders"],
      summary: "Transition order status",
      description:
        "State machine: paid → shipped (seller) → delivered (seller) → completed (buyer). Completing an order triggers a Stripe transfer to the seller. Disputed is also valid from certain states. The transitions `paid`, `cancelled`, and `refunded` must use their dedicated endpoints (POST /pay, POST /cancel, POST /refund).",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["status"],
              properties: {
                status: {
                  type: "string",
                  enum: ["shipped", "delivered", "completed", "disputed"],
                },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Status updated", content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } },
        "400": { description: "Invalid transition" },
        "403": { description: "Not authorized for this transition" },
        "502": { description: "Stripe transfer failed" },
      },
    },
  },
  "/api/v1/orders/{id}/refund": {
    post: {
      tags: ["Orders"],
      summary: "Refund an order (buyer only)",
      description: "Creates a full Stripe refund for the PaymentIntent and transitions the order to refunded. The platform absorbs the Stripe processing fee.",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
      responses: {
        "200": { description: "Order refunded", content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } },
        "400": { description: "Invalid transition" },
        "401": { description: "Not authenticated" },
        "403": { description: "Not the buyer" },
        "502": { description: "Stripe API error" },
      },
    },
  },
  "/api/v1/orders/{id}/pay": {
    post: {
      tags: ["Orders"],
      summary: "Pay for an order (buyer only)",
      description: "Confirms the Stripe PaymentIntent and transitions the order to paid. If the PaymentIntent was not created at order time, it is lazily created here.",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
      responses: {
        "200": { description: "Order paid", content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } },
        "400": { description: "Order expired or invalid transition" },
        "401": { description: "Not authenticated" },
        "402": { description: "PAYMENT_FAILED — card declined or payment refused" },
        "403": { description: "Not the buyer" },
        "404": { description: "Order not found" },
        "502": { description: "PAYMENT_SERVICE_UNAVAILABLE — Stripe API error" },
      },
    },
  },
  "/api/v1/orders/{id}/cancel": {
    post: {
      tags: ["Orders"],
      summary: "Cancel a pending order (buyer only)",
      description: "Cancels the Stripe PaymentIntent if one exists and releases the listing back to active.",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
      responses: {
        "200": { description: "Order cancelled", content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } },
        "400": { description: "Invalid transition" },
        "401": { description: "Not authenticated" },
        "403": { description: "Not the buyer" },
        "404": { description: "Order not found" },
        "502": { description: "Stripe API error when cancelling PaymentIntent" },
      },
    },
  },
};
