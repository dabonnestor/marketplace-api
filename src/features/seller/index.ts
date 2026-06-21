import { sellerRouter } from "./seller.routes.js";
import { sellerPaths, sellerSchemas } from "./openapi.js";
import type { FeatureDescriptor } from "../../shared/feature-registry.js";

export const feature: FeatureDescriptor = {
  router: sellerRouter,
  path: "/api/v1/seller",
  openApiPaths: sellerPaths,
  openApiSchemas: sellerSchemas,
};

// Public API — other features import only from this barrel
export { requireOnboarding } from "./require-onboarding.middleware.js";
