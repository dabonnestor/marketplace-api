import { z } from "zod";

export const createOrderSchema = z.object({
  listingId: z.string().uuid(),
});

export const listOrdersSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.string().optional(),
});

export const PLATFORM_FEE_PERCENT = 10; // 10% commission

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
