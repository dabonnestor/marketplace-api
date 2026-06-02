export type OrderStatus = "pending" | "paid" | "shipped" | "delivered" | "completed" | "disputed" | "cancelled" | "expired" | "refunded";
export type OrderRole = "buyer" | "seller";

export interface TransitionResult {
  allowed: boolean;
  timestampField?: string;
  error?: string;
  errorCode?: string;
}

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["paid", "cancelled", "expired"],
  paid: ["shipped", "disputed", "refunded"],
  shipped: ["delivered", "disputed", "refunded"],
  delivered: ["completed", "disputed", "refunded"],
  completed: [],
  disputed: ["refunded"],
  cancelled: [],
  expired: [],
  refunded: [],
};

const TIMESTAMP_FIELDS: Record<string, string> = {
  paid: "paidAt",
  shipped: "shippedAt",
  delivered: "deliveredAt",
  completed: "completedAt",
  refunded: "refundedAt",
};

const ROLE_RESTRICTIONS: Record<string, OrderRole> = {
  paid: "buyer",
  cancelled: "buyer",
  shipped: "seller",
  delivered: "seller",
  completed: "buyer",
  refunded: "buyer",
};

export function transition(from: OrderStatus, to: OrderStatus, role: OrderRole, preDisputeStatus?: OrderStatus): TransitionResult {
  const allowedTargets = VALID_TRANSITIONS[from];
  const isAllowed = allowedTargets.includes(to) || (from === "disputed" && preDisputeStatus === to);

  if (!isAllowed) {
    return {
      allowed: false,
      error: `Cannot transition order from '${from}' to '${to}'`,
      errorCode: "INVALID_TRANSITION",
    };
  }

  const requiredRole = ROLE_RESTRICTIONS[to];
  if (requiredRole && role !== requiredRole) {
    const label = requiredRole === "buyer" ? "Only the buyer" : "Only the seller";
    return {
      allowed: false,
      error: `${label} can mark the order as ${to}`,
      errorCode: "FORBIDDEN",
    };
  }

  return {
    allowed: true,
    timestampField: TIMESTAMP_FIELDS[to],
  };
}
