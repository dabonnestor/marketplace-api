export const webhookPaths = {
  "/api/v1/webhooks/stripe": {
    post: {
      tags: ["Webhooks"],
      summary: "Stripe webhook receiver",
      description:
        "Receives Stripe events (payment_intent.*, charge.dispute.*, account.updated), verifies the Stripe signature, and updates order state accordingly.",
      security: [],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", description: "Raw Stripe event payload" },
          },
        },
      },
      responses: {
        "200": {
          description: "Event received",
          content: {
            "application/json": {
              schema: { type: "object", properties: { received: { type: "boolean" } } },
            },
          },
        },
        "401": {
          description: "Invalid or missing Stripe signature",
        },
      },
    },
  },
};
