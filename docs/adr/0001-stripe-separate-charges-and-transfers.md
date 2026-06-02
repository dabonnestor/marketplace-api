# ADR 0001: Separate Charges and Transfers for Stripe Connect

## Status

Accepted (2026-06-01)

## Context

The marketplace needs to integrate Stripe for payment processing. The PRD specifies "the platform holds payments via Stripe Connect." Stripe Connect offers multiple integration models:

- **Destination charges**: Charge on the platform account, funds route directly to connected seller accounts with an application fee deducted. Funds don't sit in the platform balance.
- **Separate charges and transfers**: Charge on the platform account, funds land in the platform's Stripe balance. Later, explicitly transfer a portion to the seller's connected account.
- **Direct charges**: Charge on the seller's connected account (platform never touches the funds), with an application fee to the platform.
- **Separate auth and capture**: Authorize at order time, capture later (e.g., at shipment).

The platform's business model requires: charging the buyer at payment time, holding funds until the buyer confirms delivery, then paying the seller. The holding period is the key constraint.

## Decision

Use **separate charges and transfers**. The platform charges the buyer's card immediately (PaymentIntent with `capture_method: "automatic"`), funds settle to the platform's Stripe balance, and a transfer to the seller's connected account is executed when the order reaches `completed` status.

## Alternatives Considered

### Destination charges

Rejected because funds route directly to the seller's account with only the application fee going to the platform. The platform cannot hold the seller's portion of funds — they're already in the seller's Stripe balance. This violates the "platform holds payments" requirement.

### Direct charges

Rejected because the platform never touches the funds. The buyer's charge goes directly to the seller's connected account. The platform has no ability to hold, refund, or intermediate the transaction.

### Separate auth and capture

Rejected because it adds complexity for a holding period between order creation and payment (7-day auth expiry, uncaptured authorizations visible on the buyer's card). The platform's model is: pay immediately, hold until delivery, pay seller. Auth-and-capture solves a different problem (pay-at-shipment).

## Consequences

- The platform's Stripe balance holds buyer funds between charge (order `paid`) and transfer (order `completed`)
- The platform is the merchant of record for all charges — handles disputes, refunds, and compliance
- Sellers must complete Stripe Connect onboarding before creating their first listing (Express connected accounts)
- The platform absorbs Stripe processing fees on refunds (the fee is not returned by Stripe)
- A webhook endpoint is required for async Stripe events (disputes) and as a safety net for PaymentIntent confirmation
