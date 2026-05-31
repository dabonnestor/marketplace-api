import { Router } from "express";
import { authenticate } from "../../shared/middleware/auth.js";
import { validate } from "../../shared/middleware/validate.js";
import { asyncHandler } from "../../shared/middleware/async-handler.js";
import {
  createListingSchema,
  updateListingSchema,
  listListingsSchema,
  myListingsSchema,
} from "./listings.schemas.js";
import * as listingsService from "./listings.service.js";

export const listingsRouter = Router();

// Public: list all active listings with search & filters
listingsRouter.get("/", validate(listListingsSchema, "query"), asyncHandler(async (req, res) => {
  const result = await listingsService.list(req.query as any);
  res.json(result);
}));

// Seller: list own listings (active + sold) for dashboard
listingsRouter.get("/mine", authenticate, validate(myListingsSchema, "query"), asyncHandler(async (req, res) => {
  const { page, limit } = req.query as any;
  const result = await listingsService.getBySeller(req.user!.sub, page, limit);
  res.json(result);
}));

// Public: get single listing
listingsRouter.get("/:id", asyncHandler(async (req, res) => {
  const listing = await listingsService.getById(req.params.id as string);
  res.json(listing);
}));

// Seller: create listing
listingsRouter.post("/", authenticate, validate(createListingSchema), asyncHandler(async (req, res) => {
  const listing = await listingsService.create(req.body, req.user!.sub);
  res.status(201).json(listing);
}));

// Seller: update listing
listingsRouter.patch("/:id", authenticate, validate(updateListingSchema), asyncHandler(async (req, res) => {
  const listing = await listingsService.update(req.params.id as string, req.body, req.user!.sub);
  res.json(listing);
}));

// Seller: delete listing
listingsRouter.delete("/:id", authenticate, asyncHandler(async (req, res) => {
  await listingsService.remove(req.params.id as string, req.user!.sub);
  res.status(204).send();
}));
