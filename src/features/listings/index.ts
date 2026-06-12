import { listingsRouter } from "./listings.routes.js";
import { listingPaths, listingSchemas } from "./openapi.js";
import type { FeatureDescriptor } from "../../shared/feature-registry.js";

export const feature: FeatureDescriptor = {
  router: listingsRouter,
  path: "/api/v1/listings",
  openApiPaths: listingPaths,
  openApiSchemas: listingSchemas,
};
