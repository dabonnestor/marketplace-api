import { db, schema } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { execute } from "../../shared/payments/payments-adapter.js";
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

  const { account } = await execute({ type: "retrieve_account", accountId: user.stripeAccountId });

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
    const { account } = await execute({ type: "create_account" });

    accountId = account.id;

    await db
      .update(schema.users)
      .set({ stripeAccountId: accountId })
      .where(eq(schema.users.id, userId));
  }

  const { accountLink } = await execute({
    type: "create_account_link",
    account: accountId,
    refreshUrl: `${config.FRONTEND_URL}/dashboard/seller/onboard`,
    returnUrl: `${config.FRONTEND_URL}/dashboard/seller/onboard`,
  });

  return { url: accountLink.url };
}
