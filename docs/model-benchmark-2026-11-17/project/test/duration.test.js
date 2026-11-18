import test from "node:test";
import assert from "node:assert/strict";
import { parseDuration } from "../src/duration.js";

test("hours and minutes", () => assert.equal(parseDuration("1h30m"), 5400));
test("seconds only", () => assert.equal(parseDuration("45s"), 45));
test("all three units", () => assert.equal(parseDuration("2h5m10s"), 7510));
test("ignores surrounding spaces", () => assert.equal(parseDuration(" 10m "), 600));
test("rejects nonsense", () => assert.throws(() => parseDuration("soon")));
