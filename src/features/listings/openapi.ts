import { zodToJsonSchema } from "zod-to-json-schema";
import { createListingSchema, updateListingSchema } from "./listings.schemas.js";

const listingSchema = {
  type: "object" as const,
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
    status: { type: "string", enum: ["active", "reserved", "sold"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

export const listingSchemas = {
  CreateListingRequest: zodToJsonSchema(createListingSchema) as any,
  UpdateListingRequest: zodToJsonSchema(updateListingSchema) as any,
  Listing: listingSchema,
};

export const listingPaths = {
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
        "400": { description: "Validation error or onboarding required", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
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
};
