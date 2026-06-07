import { db, schema } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { stripe } from "../payments/stripe-client.js";
import { config } from "../../shared/config.js";

export async function getStatus(userId: string) {
  const [user] = await db
    .select({ stripeAccountId: schema.users.stripeAccountId })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user?.stripeAccountId) {
    return { onboarded: false, chargesEnabled: false, payoutsEnabled: false };
  }

  const account = await stripe.accounts.retrieve(user.stripeAccountId);

  return {
    onboarded: true,
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
  };
}

export async function onboard(userId: string) {
  const [user] = await db
    .select({ stripeAccountId: schema.users.stripeAccountId })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  let accountId = user?.stripeAccountId ?? null;

  if (!accountId) {
    const account = await stripe.accounts.create({
      type: "express",
      capabilities: {
        transfers: { requested: true },
        card_payments: { requested: true },
      },
    });

    accountId = account.id;

    await db
      .update(schema.users)
      .set({ stripeAccountId: accountId })
      .where(eq(schema.users.id, userId));
  }

  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${config.FRONTEND_URL}/dashboard/seller/onboard`,
    return_url: `${config.FRONTEND_URL}/dashboard/seller/onboard`,
    type: "account_onboarding",
  });

  return { url: accountLink.url };
}
