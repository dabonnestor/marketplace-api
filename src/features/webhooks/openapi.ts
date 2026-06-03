export const webhookPaths = {
  "/api/v1/webhooks/stripe": {
    post: {
      tags: ["Webhooks"],
      summary: "Stripe webhook receiver",
      description:
        "Receives Stripe events (payment_intent.*, charge.dispute.*, account.updated) and updates order state accordingly. **Security:** This endpoint does not use JWT authentication. Instead, requests are authenticated by verifying the Stripe webhook signature header (`stripe-signature`). Reject any request that fails signature verification with a 401 response.",
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
