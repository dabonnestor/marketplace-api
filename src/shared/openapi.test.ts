import { describe, it, expect } from "vitest";
import { createOpenApiRegistry } from "./openapi.js";

describe("OpenApiRegistry", () => {
  it("builds a minimal valid spec with common schemas even when no features are registered", () => {
    const registry = createOpenApiRegistry();

    const spec = registry.build();

    // Top-level OpenAPI fields
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.title).toBe("Marketplace API");
    expect(spec.servers).toBeDefined();
    expect(spec.security).toEqual([{ bearerAuth: [] }]);

    // Common schemas always present
    expect(spec.components.schemas.Error).toBeDefined();
    expect(spec.components.schemas.Pagination).toBeDefined();

    // Health check always present
    expect(spec.paths["/api/health"]).toBeDefined();
  });

  it("includes registered feature paths and schemas in the built spec", () => {
    const registry = createOpenApiRegistry();

    registry.register(
      { "/api/v1/foo": { get: { summary: "Get foo" } } },
      { Foo: { type: "object", properties: { name: { type: "string" } } } },
    );

    const spec = registry.build();

    expect(spec.paths["/api/v1/foo"]).toEqual({ get: { summary: "Get foo" } });
    expect(spec.components.schemas.Foo).toEqual({
      type: "object",
      properties: { name: { type: "string" } },
    });
  });

  it("merges paths and schemas from multiple feature registrations", () => {
    const registry = createOpenApiRegistry();

    registry.register(
      { "/api/v1/a": { get: { summary: "A" } } },
      { ASchema: { type: "object" } },
    );
    registry.register(
      { "/api/v1/b": { post: { summary: "B" } } },
      { BSchema: { type: "string" } },
    );

    const spec = registry.build();

    expect(spec.paths["/api/v1/a"]).toBeDefined();
    expect(spec.paths["/api/v1/b"]).toBeDefined();
    expect(spec.components.schemas.ASchema).toBeDefined();
    expect(spec.components.schemas.BSchema).toBeDefined();
    // Common schemas still present
    expect(spec.components.schemas.Error).toBeDefined();
  });

  it("preserves the bearer auth security scheme", () => {
    const registry = createOpenApiRegistry();

    const spec = registry.build();

    expect(spec.components.securitySchemes.bearerAuth).toEqual({
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
    });
  });
});
