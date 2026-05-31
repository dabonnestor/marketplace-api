import { ForbiddenError } from "./errors.js";

export function ensureOwner(
  resource: { sellerId: string },
  userId: string,
): void {
  if (resource.sellerId !== userId) {
    throw new ForbiddenError("You can only modify your own resource");
  }
}

export function ensureParticipant(
  order: { buyerId: string; sellerId: string },
  userId: string,
): void {
  if (order.buyerId !== userId && order.sellerId !== userId) {
    throw new ForbiddenError("You are not a participant in this order");
  }
}
