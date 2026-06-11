import Stripe from "stripe";
import { config } from "../config.js";

type StripeInstance = InstanceType<typeof Stripe>;

export const stripe: StripeInstance = new Stripe(config.STRIPE_SECRET_KEY);
