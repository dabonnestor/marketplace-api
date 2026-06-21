import { ordersRouter } from "./orders.routes.js";
import { orderPaths, orderSchemas } from "./openapi.js";
import type { FeatureDescriptor } from "../../shared/feature-registry.js";

export const feature: FeatureDescriptor = {
  router: ordersRouter,
  path: "/api/v1/orders",
  openApiPaths: orderPaths,
  openApiSchemas: orderSchemas,
};

// Public API — other features import only from this barrel
export { getStatus, isAvailable, expireIfStale } from "./reservation.js";
export { transitionOrder } from "./order-lifecycle/index.js";
