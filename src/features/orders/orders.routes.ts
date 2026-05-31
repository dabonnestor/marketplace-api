import { Router } from "express";
import { authenticate } from "../../shared/middleware/auth.js";
import { validate } from "../../shared/middleware/validate.js";
import { asyncHandler } from "../../shared/middleware/async-handler.js";
import { createOrderSchema, listOrdersSchema } from "./orders.schemas.js";
import * as ordersService from "./orders.service.js";

export const ordersRouter = Router();

// All order routes require authentication
ordersRouter.use(authenticate);

// Specific routes must come before /:id param routes

// Buyer: list my purchases
ordersRouter.get("/buyer/purchases", validate(listOrdersSchema, "query"), asyncHandler(async (req, res) => {
  const { page, limit, status } = req.query as any;
  const result = await ordersService.listBuyerOrders(req.user!.sub, page, limit, status);
  res.json(result);
}));

// Seller: list my sales
ordersRouter.get("/seller/sales", validate(listOrdersSchema, "query"), asyncHandler(async (req, res) => {
  const { page, limit, status } = req.query as any;
  const result = await ordersService.listSellerOrders(req.user!.sub, page, limit, status);
  res.json(result);
}));

// Buyer: create order from a listing
ordersRouter.post("/", validate(createOrderSchema), asyncHandler(async (req, res) => {
  const order = await ordersService.createOrder(req.user!.sub, req.body.listingId);
  res.status(201).json(order);
}));

// Get single order (accessible by buyer or seller)
ordersRouter.get("/:id", asyncHandler(async (req, res) => {
  const order = await ordersService.getOrder(req.params.id as string, req.user!.sub);
  res.json(order);
}));

// Transition order status
ordersRouter.patch("/:id/status", asyncHandler(async (req, res) => {
  const { status } = req.body;
  const order = await ordersService.transitionStatus(req.params.id as string, status, req.user!.sub);
  res.json(order);
}));
