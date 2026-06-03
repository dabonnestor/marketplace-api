import { Router } from "express";
import { authenticate } from "../../shared/middleware/auth.js";
import { validate } from "../../shared/middleware/validate.js";
import { asyncHandler } from "../../shared/middleware/async-handler.js";
import { createOrderSchema, listOrdersSchema } from "./orders.schemas.js";
import { AppError } from "../../shared/errors.js";
import * as ordersService from "./orders.service.js";
import { completeOrder } from "./complete-order.js";

export const ordersRouter = Router();

// All order routes require authentication
ordersRouter.use(authenticate);

// Specific routes must come before /:id param routes

// Buyer: pay for an order
ordersRouter.post("/:id/pay", asyncHandler(async (req, res) => {
  const order = await ordersService.payOrder(req.params.id as string, req.user!.sub);
  res.json(order);
}));

// Buyer: cancel an order
ordersRouter.post("/:id/cancel", asyncHandler(async (req, res) => {
  const order = await ordersService.cancelOrder(req.params.id as string, req.user!.sub);
  res.json(order);
}));

// Buyer: complete an order (mark as received)
ordersRouter.post("/:id/complete", asyncHandler(async (req, res) => {
  const order = await completeOrder(req.params.id as string, req.user!.sub);
  res.json(order);
}));

// Buyer: request a refund
ordersRouter.post("/:id/refund", asyncHandler(async (req, res) => {
  const order = await ordersService.refundOrder(req.params.id as string, req.user!.sub);
  res.json(order);
}));

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
  if (status === "paid" || status === "cancelled" || status === "refunded" || status === "completed") {
    throw new AppError(400, "TRANSITION_REMOVED", `Use POST /api/v1/orders/:id/${status === "paid" ? "pay" : status === "cancelled" ? "cancel" : status === "refunded" ? "refund" : "complete"} instead`);
  }
  const order = await ordersService.transitionStatus(req.params.id as string, status, req.user!.sub);
  res.json(order);
}));
