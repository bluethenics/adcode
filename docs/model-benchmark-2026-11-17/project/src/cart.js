/** A cart total in cents, after a percentage discount, never below zero. */
export function total(items, discountPercent = 0) {
  const sum = items.reduce((acc, item) => acc + item.price * item.qty, 0);
  const discounted = sum - discountPercent;
  return Math.max(0, Math.round(discounted));
}
