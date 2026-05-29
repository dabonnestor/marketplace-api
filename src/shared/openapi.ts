import { zodToJsonSchema } from "zod-to-json-schema";
import {
  registerSchema,
  loginSchema,
  refreshSchema,
} from "../features/auth/auth.schemas.js";
import {
  createListingSchema,
  updateListingSchema,
  listListingsSchema,
} from "../features/listings/listings.schemas.js";
import {
  createOrderSchema,
  listOrdersSchema,
} from "../features/orders/orders.schemas.js";

const userResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    email: { type: "string", format: "email" },
    name: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const errorResponseSchema = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: { type: "object" },
      },
    },
  },
};

const paginationSchema = {
  type: "object",
  properties: {
    page: { type: "integer" },
    limit: { type: "integer" },
    total: { type: "integer" },
    totalPages: { type: "integer" },
  },
};

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Marketplace API",
    version: "1.0.0",
    description: "Two-sided marketplace for physical goods. Buyers browse listings and place orders. Sellers manage inventory and fulfill orders.",
    contact: { name: "API Support" },
  },
  servers: [
    { url: "http://localhost:3000", description: "Local development" },
  ],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    schemas: {
      RegisterRequest: zodToJsonSchema(registerSchema) as any,
      LoginRequest: zodToJsonSchema(loginSchema) as any,
      RefreshRequest: zodToJsonSchema(refreshSchema) as any,
      CreateListingRequest: zodToJsonSchema(createListingSchema) as any,
      UpdateListingRequest: zodToJsonSchema(updateListingSchema) as any,
      CreateOrderRequest: zodToJsonSchema(createOrderSchema) as any,
      User: userResponseSchema,
      Error: errorResponseSchema,
      Pagination: paginationSchema,
      Listing: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          sellerId: { type: "string", format: "uuid" },
          title: { type: "string" },
          description: { type: "string" },
          price: { type: "string" },
          category: { type: "string" },
          condition: { type: "string" },
          shippingCost: { type: "string" },
          images: { type: "array", items: { type: "string" } },
          status: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      Order: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          buyerId: { type: "string", format: "uuid" },
          sellerId: { type: "string", format: "uuid" },
          listingId: { type: "string", format: "uuid" },
          status: { type: "string", enum: ["pending", "paid", "shipped", "delivered", "completed", "disputed", "cancelled"] },
          subtotal: { type: "string" },
          shippingCost: { type: "string" },
          platformFee: { type: "string" },
          total: { type: "string" },
          sellerPayout: { type: "string" },
          paidAt: { type: "string", format: "date-time" },
          shippedAt: { type: "string", format: "date-time" },
          deliveredAt: { type: "string", format: "date-time" },
          completedAt: { type: "string", format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
    },
  },
  paths: {
    "/api/health": {
      get: {
        tags: ["Health"],
        summary: "Health check",
        security: [],
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" } } } } },
          },
        },
      },
    },

    // ── Auth ──
    "/api/v1/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Register a new user",
        security: [],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/RegisterRequest" } } },
        },
        responses: {
          "201": {
            description: "User created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    user: { $ref: "#/components/schemas/User" },
                    accessToken: { type: "string" },
                    refreshToken: { type: "string" },
                  },
                },
              },
            },
          },
          "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "409": { description: "Email already exists", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/api/v1/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Login with email and password",
        security: [],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/LoginRequest" } } },
        },
        responses: {
          "200": {
            description: "Login successful",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    user: { $ref: "#/components/schemas/User" },
                    accessToken: { type: "string" },
                    refreshToken: { type: "string" },
                  },
                },
              },
            },
          },
          "401": { description: "Invalid credentials", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/api/v1/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Refresh access token",
        security: [],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/RefreshRequest" } } },
        },
        responses: {
          "200": {
            description: "New tokens",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    accessToken: { type: "string" },
                    refreshToken: { type: "string" },
                  },
                },
              },
            },
          },
          "401": { description: "Invalid refresh token" },
        },
      },
    },
    "/api/v1/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Get current user",
        responses: {
          "200": { description: "Current user", content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } },
          "401": { description: "Not authenticated" },
        },
      },
    },

    // ── Listings ──
    "/api/v1/listings": {
      get: {
        tags: ["Listings"],
        summary: "List active listings with search and filters",
        security: [],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          { name: "category", in: "query", schema: { type: "string" } },
          { name: "minPrice", in: "query", schema: { type: "number" } },
          { name: "maxPrice", in: "query", schema: { type: "number" } },
          { name: "search", in: "query", schema: { type: "string" }, description: "Full-text search on title and description" },
        ],
        responses: {
          "200": {
            description: "Paginated listings",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/Listing" } },
                    pagination: { $ref: "#/components/schemas/Pagination" },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["Listings"],
        summary: "Create a new listing (seller)",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateListingRequest" } } },
        },
        responses: {
          "201": { description: "Listing created", content: { "application/json": { schema: { $ref: "#/components/schemas/Listing" } } } },
          "400": { description: "Validation error" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/api/v1/listings/mine": {
      get: {
        tags: ["Listings"],
        summary: "List the authenticated seller's own listings (active + sold)",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: {
          "200": {
            description: "Paginated seller listings",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/Listing" } },
                    pagination: { $ref: "#/components/schemas/Pagination" },
                  },
                },
              },
            },
          },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/api/v1/listings/{id}": {
      get: {
        tags: ["Listings"],
        summary: "Get a single listing",
        security: [],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "Listing", content: { "application/json": { schema: { $ref: "#/components/schemas/Listing" } } } },
          "404": { description: "Not found" },
        },
      },
      patch: {
        tags: ["Listings"],
        summary: "Update a listing (seller, owner only)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateListingRequest" } } },
        },
        responses: {
          "200": { description: "Listing updated", content: { "application/json": { schema: { $ref: "#/components/schemas/Listing" } } } },
          "401": { description: "Not authenticated" },
          "403": { description: "Not the owner" },
          "404": { description: "Not found" },
        },
      },
      delete: {
        tags: ["Listings"],
        summary: "Delete a listing (seller, owner only)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "204": { description: "Deleted" },
          "401": { description: "Not authenticated" },
          "403": { description: "Not the owner" },
          "404": { description: "Not found" },
        },
      },
    },

    // ── Orders ──
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
  },
};
