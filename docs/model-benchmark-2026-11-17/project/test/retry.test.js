import test from "node:test";
import assert from "node:assert/strict";
import { retry } from "../src/retry.js";

const failing = (times) => { let calls = 0; const fn = async () => { calls += 1; if (calls <= times) throw new Error(`fail ${calls}`); return "ok"; }; return { fn, calls: () => calls }; };

test("returns the first success", async () => { const f = failing(0); assert.equal(await retry(f.fn), "ok"); assert.equal(f.calls(), 1); });
test("retries a rejected promise", async () => { const f = failing(2); assert.equal(await retry(f.fn, { attempts: 3, delayMs: 1 }), "ok"); assert.equal(f.calls(), 3); });
test("makes exactly `attempts` calls, then rejects with the last error", async () => {
  const f = failing(10);
  await assert.rejects(retry(f.fn, { attempts: 4, delayMs: 1 }), /fail 4/);
  assert.equal(f.calls(), 4);
});
test("doubles the wait between tries", async () => {
  const f = failing(2); const start = Date.now();
  await retry(f.fn, { attempts: 3, delayMs: 40 });
  assert.ok(Date.now() - start >= 115, "waits 40 ms then 80 ms");
});
