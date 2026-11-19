import test from "node:test";
import assert from "node:assert/strict";
import { priceOf } from "../src/shop/prices.js";
import * as prices from "../src/shop/prices.js";
import { orderLines } from "../src/shop/order.js";
import { invoice } from "../src/shop/invoice.js";

const catalogue = [{ sku: "pen", cents: 150 }, { sku: "pad", cents: 400 }];

test("getPrice is renamed to priceOf everywhere", () => {
  assert.equal(priceOf(catalogue, "pad"), 400);
  assert.equal("getPrice" in prices, false, "the old name is gone");
});
test("unknown products still throw", () => assert.throws(() => priceOf(catalogue, "ink"), /unknown sku ink/));
test("order lines use the renamed function", () => assert.deepEqual(orderLines(catalogue, [{ sku: "pen", qty: 3 }]), [{ sku: "pen", qty: 3, cents: 450 }]));
test("invoice still adds up", () => assert.equal(invoice(catalogue, [{ sku: "pen", qty: 2 }, { sku: "pad", qty: 1 }]), "pen x2 @ 150 = 300\npad x1 @ 400 = 400\ntotal 700"));
