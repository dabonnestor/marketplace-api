import { webhooksRouter } from "./webhooks.routes.js";
import { webhookPaths } from "./openapi.js";
import type { FeatureDescriptor } from "../../shared/feature-registry.js";

export const feature: FeatureDescriptor = {
  router: webhooksRouter,
  path: "/api/v1/webhooks",
  openApiPaths: webhookPaths,
  openApiSchemas: {},
};
