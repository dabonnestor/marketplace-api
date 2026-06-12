import { config } from "./config.js";

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

const baseInfo = {
  title: "Marketplace API",
  version: "1.0.0",
  description:
    "Two-sided marketplace for physical goods. Buyers browse listings and place orders. Sellers manage inventory and fulfill orders.",
  contact: { name: "API Support" },
} as const;

const baseServers = [
  { url: config.BASE_URL, description: "Local development" },
] as const;

const securitySchemes = {
  bearerAuth: {
    type: "http" as const,
    scheme: "bearer" as const,
    bearerFormat: "JWT",
  },
};

const healthCheckPath = {
  "/api/health": {
    get: {
      tags: ["Health"],
      summary: "Health check",
      security: [],
      responses: {
        "200": {
          description: "OK",
          content: {
            "application/json": {
              schema: { type: "object" as const, properties: { status: { type: "string" as const } } },
            },
          },
        },
      },
    },
  },
} as const;

export interface OpenApiRegistry {
  register(paths: Record<string, unknown>, schemas: Record<string, unknown>): void;
  build(): {
    openapi: string;
    info: typeof baseInfo;
    servers: typeof baseServers;
    security: { bearerAuth: string[] }[];
    components: {
      securitySchemes: typeof securitySchemes;
      schemas: Record<string, unknown>;
    };
    paths: Record<string, unknown>;
  };
}

export function createOpenApiRegistry(): OpenApiRegistry {
  const features: { paths: Record<string, unknown>; schemas: Record<string, unknown> }[] = [];

  return {
    register(paths: Record<string, unknown>, schemas: Record<string, unknown>) {
      features.push({ paths, schemas });
    },

    build() {
      const mergedPaths: Record<string, unknown> = { ...healthCheckPath };
      const mergedSchemas: Record<string, unknown> = {};

      for (const f of features) {
        Object.assign(mergedPaths, f.paths);
        Object.assign(mergedSchemas, f.schemas);
      }

      return {
        openapi: "3.0.3",
        info: baseInfo,
        servers: baseServers,
        security: [{ bearerAuth: [] }],
        components: {
          securitySchemes,
          schemas: {
            ...mergedSchemas,
            Error: errorResponseSchema,
            Pagination: paginationSchema,
          },
        },
        paths: mergedPaths,
      };
    },
  };
}
