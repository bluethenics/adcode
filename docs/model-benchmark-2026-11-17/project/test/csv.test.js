import test from "node:test";
import assert from "node:assert/strict";
import { parseCsvLine } from "../src/csv.js";

test("splits plain fields", () => assert.deepEqual(parseCsvLine("a,b,c"), ["a", "b", "c"]));
test("keeps commas inside quotes", () => assert.deepEqual(parseCsvLine('1,"Smith, Jane",x'), ["1", "Smith, Jane", "x"]));
test("turns a doubled quote into one", () => assert.deepEqual(parseCsvLine('"say ""hi""",2'), ['say "hi"', "2"]));
test("keeps empty fields", () => assert.deepEqual(parseCsvLine("a,,c,"), ["a", "", "c", ""]));
test("keeps spaces inside quotes", () => assert.deepEqual(parseCsvLine('" padded ",b'), [" padded ", "b"]));
