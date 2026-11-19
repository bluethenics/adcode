import { getPrice } from "./prices.js";

/** Line totals for an order: [{ sku, qty }] -> [{ sku, qty, cents }]. */
export function orderLines(catalogue, order) {
  return order.map((line) => ({ ...line, cents: getPrice(catalogue, line.sku) * line.qty }));
}
