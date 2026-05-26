import { Router } from "express";
import { authenticate } from "../../shared/middleware/auth.js";
import { validate } from "../../shared/middleware/validate.js";
import {
  createListingSchema,
  updateListingSchema,
  listListingsSchema,
} from "./listings.schemas.js";
import * as listingsService from "./listings.service.js";

export const listingsRouter = Router();

// Public: list all active listings with search & filters
listingsRouter.get("/", validate(listListingsSchema, "query"), async (req, res, next) => {
  try {
    const result = await listingsService.list(req.query as any);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Public: get single listing
listingsRouter.get("/:id", async (req, res, next) => {
  try {
    const listing = await listingsService.getById(req.params.id as string);
    res.json(listing);
  } catch (err) {
    next(err);
  }
});

// Seller: create listing
listingsRouter.post("/", authenticate, validate(createListingSchema), async (req, res, next) => {
  try {
    const listing = await listingsService.create(req.body, req.user!.sub);
    res.status(201).json(listing);
  } catch (err) {
    next(err);
  }
});

// Seller: update listing
listingsRouter.patch("/:id", authenticate, validate(updateListingSchema), async (req, res, next) => {
  try {
    const listing = await listingsService.update(req.params.id as string, req.body, req.user!.sub);
    res.json(listing);
  } catch (err) {
    next(err);
  }
});

// Seller: delete listing
listingsRouter.delete("/:id", authenticate, async (req, res, next) => {
  try {
    await listingsService.remove(req.params.id as string, req.user!.sub);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
