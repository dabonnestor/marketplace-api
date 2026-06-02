const onboardResponseSchema = {
  type: "object" as const,
  properties: {
    url: { type: "string" },
  },
};

const onboardStatusSchema = {
  type: "object" as const,
  properties: {
    onboarded: { type: "boolean" },
    charges_enabled: { type: "boolean" },
    payouts_enabled: { type: "boolean" },
  },
};

export const sellerSchemas = {
  OnboardResponse: onboardResponseSchema,
  OnboardStatus: onboardStatusSchema,
};

export const sellerPaths = {
  "/api/v1/seller/onboard": {
    post: {
      tags: ["Seller"],
      summary: "Create a Stripe Connect Express account and return an onboarding link",
      responses: {
        "200": {
          description: "Onboarding URL",
          content: { "application/json": { schema: { $ref: "#/components/schemas/OnboardResponse" } } },
        },
        "401": { description: "Not authenticated" },
      },
    },
  },
  "/api/v1/seller/onboard/status": {
    get: {
      tags: ["Seller"],
      summary: "Get the seller's Stripe Connect onboarding status",
      responses: {
        "200": {
          description: "Onboarding status",
          content: { "application/json": { schema: { $ref: "#/components/schemas/OnboardStatus" } } },
        },
        "401": { description: "Not authenticated" },
      },
    },
  },
};
