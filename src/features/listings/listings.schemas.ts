import { z } from "zod";

export const createListingSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().min(1),
  price: z.coerce.number().positive().max(9999999999),
  category: z.string().min(1).max(100),
  condition: z.string().min(1).max(50),
  shippingCost: z.coerce.number().nonnegative().default(0),
  images: z.array(z.string().url()).max(10).default([]),
});

export const updateListingSchema = createListingSchema.partial();

export const listListingsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  category: z.string().optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  search: z.string().optional(),
});

export const myListingsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateListingInput = z.infer<typeof createListingSchema>;
export type UpdateListingInput = z.infer<typeof updateListingSchema>;
export type ListListingsQuery = z.infer<typeof listListingsSchema>;
export type MyListingsQuery = z.infer<typeof myListingsSchema>;
