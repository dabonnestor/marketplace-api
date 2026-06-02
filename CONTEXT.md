# CONTEXT

## Platform

A two-sided marketplace where buyers purchase physical goods from sellers. The platform takes a 10% commission on each transaction and holds buyer funds until the order is completed, then transfers the net payout to the seller.

## User

A registered user with a single account. Any User can act as a Buyer or Seller depending on the action they are performing. The platform does not have distinct Buyer and Seller account types.

## Buyer

A User who purchases items. A Buyer browses listings, places orders, pays for orders, and confirms delivery. The same User can also be a Seller for their own listings.

## Seller

A User who lists items for sale. Before creating their first listing, a Seller must complete Stripe Connect onboarding (identity verification, bank details). A Seller manages their listings, marks orders as shipped and delivered, and receives payouts after the Buyer confirms completion.

## Listing

An item offered for sale by a Seller. A Listing has a title, description, price, shipping cost, category, condition, and images. A Listing's status is one of: `active` (visible in search), `reserved` (a Buyer has created an order but not yet paid), or `sold` (the order was paid). Only `active` listings appear in public search.

## Order

A transaction between a Buyer and a Seller for a specific Listing. An Order records the financial breakdown (subtotal, shipping cost, platform fee, total, seller payout) and progresses through a structured status lifecycle. Each Order is tied to exactly one Listing and one Buyer-Seller pair.

## Order Status

The state in the Order lifecycle. Valid statuses: `pending`, `paid`, `shipped`, `delivered`, `completed`, `disputed`, `cancelled`, `expired`, `refunded`. `completed`, `cancelled`, `expired`, and `refunded` are terminal.

## Reservation

When a Buyer creates an Order (status `pending`), the Listing is reserved for 30 minutes. During this window, the Listing status is `reserved` and no other Buyer can create an Order on it. If payment is not completed within the window, the Order expires, the Listing returns to `active`, and the Order becomes `expired` (terminal).

## Payment

A Stripe PaymentIntent created at Order creation and confirmed when the Buyer clicks "pay." The payment is captured immediately (not authorized-and-deferred). The full Order total is charged to the Buyer's card. Card details never touch the platform's servers — they are handled by Stripe.js on the client.

## Platform Fee

A 10% commission on the listing subtotal, calculated at Order creation. `platformFee = round(subtotal * 0.10, 2)`. The platform fee is retained in the platform's Stripe balance when the payout is transferred to the Seller.

## Payout

A Stripe Transfer from the platform's Stripe account to the Seller's connected Stripe account. Executed when the Order transitions to `completed`. The transfer amount is the `sellerPayout` (total minus platform fee). If the transfer fails, the `completed` transition is rejected and surfaced immediately.

## Refund

A full refund of the Order total to the Buyer's card, triggered by the Buyer. Only available for Orders that have been paid (`paid`, `shipped`, `delivered`). The platform absorbs the Stripe processing fee on refunds. A refunded Order is terminal (`refunded`).

## Dispute

A bank-initiated chargeback on a paid Order, detected via Stripe webhook. When a dispute is created, the Order transitions to `disputed` (non-terminal). If the platform wins the dispute, the Order reverts to its pre-dispute status. If the platform loses, the Order transitions to `refunded` (terminal).

## Cancellation

A Buyer-initiated abort of an Order before payment. Only valid from `pending` status — no money has moved. The Listing is released back to `active`. Post-payment reversals use the Refund flow, not Cancellation.

## Webhook

A Stripe event notification received at `POST /api/v1/webhooks/stripe`. Used for async Stripe events (disputes) and as a safety net for PaymentIntent confirmation. Signature-verified using the Stripe webhook signing secret. Webhook handlers are idempotent — replaying an event on an already-transitioned Order is a no-op.
