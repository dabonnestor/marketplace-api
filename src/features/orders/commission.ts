export const PLATFORM_FEE_PERCENT = 10;

export function calculateOrderBreakdown(subtotal: number, shippingCost: number) {
  const platformFee = Math.round((subtotal * PLATFORM_FEE_PERCENT) / 100 * 100) / 100;
  const total = subtotal + shippingCost;
  const sellerPayout = total - platformFee;

  return {
    platformFee: platformFee.toFixed(2),
    total: total.toFixed(2),
    sellerPayout: sellerPayout.toFixed(2),
  };
}
