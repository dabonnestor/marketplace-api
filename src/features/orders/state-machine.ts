export type OrderStatus = "pending" | "paid" | "shipped" | "delivered" | "completed" | "disputed" | "cancelled";
export type OrderRole = "buyer" | "seller";

export interface TransitionResult {
  allowed: boolean;
  timestampField?: string;
  error?: string;
  errorCode?: string;
}

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["paid", "cancelled"],
  paid: ["shipped", "disputed", "cancelled"],
  shipped: ["delivered", "disputed"],
  delivered: ["completed", "disputed"],
  completed: [],
  disputed: ["cancelled"],
  cancelled: [],
};

const TIMESTAMP_FIELDS: Record<string, string> = {
  paid: "paidAt",
  shipped: "shippedAt",
  delivered: "deliveredAt",
  completed: "completedAt",
};

const ROLE_RESTRICTIONS: Record<string, OrderRole> = {
  paid: "buyer",
  shipped: "seller",
  delivered: "seller",
  completed: "buyer",
};

export function transition(from: OrderStatus, to: OrderStatus, role: OrderRole): TransitionResult {
  const allowedTargets = VALID_TRANSITIONS[from];
  if (!allowedTargets.includes(to)) {
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
