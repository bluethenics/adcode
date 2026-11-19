import test from "node:test";
import assert from "node:assert/strict";
import { LruCache } from "../src/lru.js";

test("stores and reads values", () => { const c = new LruCache(2); c.set("a", 1); assert.equal(c.get("a"), 1); assert.equal(c.get("b"), undefined); });
test("evicts the least recently used", () => { const c = new LruCache(2); c.set("a", 1); c.set("b", 2); c.get("a"); c.set("c", 3); assert.equal(c.has("b"), false); assert.equal(c.has("a"), true); assert.equal(c.size, 2); });
test("replacing a key refreshes it without growing", () => { const c = new LruCache(2); c.set("a", 1); c.set("b", 2); c.set("a", 9); c.set("c", 3); assert.equal(c.get("a"), 9); assert.equal(c.has("b"), false); assert.equal(c.size, 2); });
test("has does not refresh recency", () => { const c = new LruCache(2); c.set("a", 1); c.set("b", 2); c.has("a"); c.set("c", 3); assert.equal(c.has("a"), false); });
test("rejects a capacity below one", () => assert.throws(() => new LruCache(0), RangeError));
