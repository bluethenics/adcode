import test from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/slug.js";

test("lowercases and joins words", () => assert.equal(slugify("Hello World"), "hello-world"));
test("drops punctuation and collapses separators", () => assert.equal(slugify("  Rock & Roll -- 2026!  "), "rock-roll-2026"));
test("removes accents", () => assert.equal(slugify("Crème Brûlée"), "creme-brulee"));
test("returns an empty string for nothing usable", () => assert.equal(slugify("!!!"), ""));
