import test from "node:test";
import assert from "node:assert/strict";
import { formatBytes } from "../src/format.js";

test("bytes stay bytes", () => assert.equal(formatBytes(512), "512 B"));
test("exactly one kilobyte", () => assert.equal(formatBytes(1024), "1 KB"));
test("rounds to the nearest tenth", () => assert.equal(formatBytes(2007), "2 KB"));
test("keeps one decimal", () => assert.equal(formatBytes(1536), "1.5 KB"));
test("megabytes", () => assert.equal(formatBytes(5 * 1024 * 1024), "5 MB"));
