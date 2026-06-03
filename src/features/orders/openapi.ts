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
    stripeRefundId: { type: "string" },
    paidAt: { type: "string", format: "date-time" },
    shippedAt: { type: "string", format: "date-time" },
    deliveredAt: { type: "string", format: "date-time" },
    completedAt: { type: "string", format: "date-time" },
    refundedAt: { type: "string", format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

export const orderSchemas = {
  CreateOrderRequest: zodToJsonSchema(createOrderSchema) as any,
  Order: orderSchema,
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
        "201": { description: "Order created", content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } },
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
        "State machine: pending → paid (buyer) → shipped (seller) → delivered (seller) → completed (buyer). Disputed and cancelled are also valid from certain states.",
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
                  enum: ["paid", "shipped", "delivered", "completed", "disputed", "cancelled"],
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
};
