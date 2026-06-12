import { db, schema } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { AppError, ForbiddenError } from "../../shared/errors.js";
import { transition, type OrderStatus } from "./state-machine.js";

export async function transitionOrder(
  order: { id: string; status: string; buyerId: string; sellerId: string; preDisputeStatus?: string | null },
  newStatus: OrderStatus,
  options?: { userId?: string; extraUpdates?: Record<string, unknown> },
) {
  const currentStatus = order.status as OrderStatus;

  let role: "buyer" | "seller" | undefined;
  if (options?.userId) {
    if (order.buyerId !== options.userId && order.sellerId !== options.userId) {
      throw new ForbiddenError("You are not a participant in this order");
    }
    role = order.buyerId === options.userId ? "buyer" : "seller";
  }

  const result = transition(
    currentStatus,
    newStatus,
    role,
    order.preDisputeStatus as OrderStatus | undefined,
  );

  if (!result.allowed) {
    if (result.errorCode === "FORBIDDEN") {
      throw new ForbiddenError(result.error!);
    }
    throw new AppError(
      400,
      result.errorCode ?? "INVALID_TRANSITION",
      result.error!,
    );
  }

  return executeTransition(order.id, newStatus, result, options?.extraUpdates);
}

async function executeTransition(
  orderId: string,
  newStatus: OrderStatus,
  result: { allowed: boolean; timestampField?: string },
  extraUpdates?: Record<string, unknown>,
) {
  const updates: Record<string, unknown> = {
    status: newStatus,
    updatedAt: new Date(),
    ...extraUpdates,
  };
  if (result.timestampField) {
    updates[result.timestampField] = new Date();
  }

  const [updated] = await db
    .update(schema.orders)
    .set(updates)
    .where(eq(schema.orders.id, orderId))
    .returning();

  return updated;
}
