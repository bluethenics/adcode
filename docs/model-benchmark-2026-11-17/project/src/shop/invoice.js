import { getPrice } from "./prices.js";
import { orderLines } from "./order.js";

/** A one-line-per-item invoice with a total. */
export function invoice(catalogue, order) {
  const lines = orderLines(catalogue, order).map((line) => `${line.sku} x${line.qty} @ ${getPrice(catalogue, line.sku)} = ${line.cents}`);
  const total = orderLines(catalogue, order).reduce((sum, line) => sum + line.cents, 0);
  return [...lines, `total ${total}`].join("\n");
}
