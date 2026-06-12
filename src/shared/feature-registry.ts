import type { Router, RequestHandler, Express } from "express";
import { createOpenApiRegistry } from "./openapi.js";

export interface FeatureDescriptor {
  router: Router;
  path: string;
  middlewares?: RequestHandler[];
  openApiPaths: Record<string, unknown>;
  openApiSchemas: Record<string, unknown>;
}

export function registerFeatures(features: FeatureDescriptor[]) {
  const registry = createOpenApiRegistry();

  for (const feature of features) {
    registry.register(feature.openApiPaths, feature.openApiSchemas);
  }

  const spec = registry.build();

  function mount(app: Express) {
    for (const feature of features) {
      const handlers = feature.middlewares ?? [];
      app.use(feature.path, ...handlers, feature.router);
    }
  }

  return { mount, spec };
}
