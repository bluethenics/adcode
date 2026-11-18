import test from "node:test";
import assert from "node:assert/strict";
import { total } from "../src/cart.js";

test("sums price times quantity", () => assert.equal(total([{ price: 250, qty: 2 }, { price: 100, qty: 1 }]), 600));
test("applies a percentage discount", () => assert.equal(total([{ price: 1000, qty: 1 }], 10), 900));
test("rounds to whole cents", () => assert.equal(total([{ price: 333, qty: 1 }], 50), 167));
test("never goes below zero", () => assert.equal(total([{ price: 100, qty: 1 }], 150), 0));
