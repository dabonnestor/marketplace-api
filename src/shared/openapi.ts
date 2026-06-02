import { authPaths, authSchemas } from "../features/auth/openapi.js";
import { listingPaths, listingSchemas } from "../features/listings/openapi.js";
import { orderPaths, orderSchemas } from "../features/orders/openapi.js";
import { sellerPaths, sellerSchemas } from "../features/seller/openapi.js";

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
      ...authSchemas,
      ...listingSchemas,
      ...orderSchemas,
      ...sellerSchemas,
      Error: errorResponseSchema,
      Pagination: paginationSchema,
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

    ...authPaths,

    ...listingPaths,

    ...orderPaths,

    ...sellerPaths,
  },
};
