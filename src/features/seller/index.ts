import { sellerRouter } from "./seller.routes.js";
import { sellerPaths, sellerSchemas } from "./openapi.js";
import type { FeatureDescriptor } from "../../shared/feature-registry.js";

export const feature: FeatureDescriptor = {
  router: sellerRouter,
  path: "/api/v1/seller",
  openApiPaths: sellerPaths,
  openApiSchemas: sellerSchemas,
};
