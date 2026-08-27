/**
 * Reading the result of evaluating an expression in a paused frame.
 *
 * The case worth testing hardest is the one that looks like success: the protocol returns a
 * normal response for a thrown exception and puts the throw in `exceptionDetails`. Reading
 * only `result` would print the exception's value as though the expression had evaluated to
 * it, so `throw new Error("nope")` would render as `Error: nope` with nothing to say that
 * anything went wrong.
 */
import { describe, it, expect } from "vitest";
import { evaluationFrom } from "../src/inspector.ts";

describe("a value", () => {
  it("reads a number", () => {
    expect(evaluationFrom({ result: { type: "number", value: 42 } })).toEqual({
      value: "42",
      type: "number",
      error: false,
    });
  });

  it("quotes a string, so it cannot be mistaken for an identifier", () => {
    expect(evaluationFrom({ result: { type: "string", value: "hi" } }).value).toBe('"hi"');
  });

  it("reads undefined as undefined rather than as nothing", () => {
    expect(evaluationFrom({ result: { type: "undefined" } })).toEqual({
      value: "undefined",
      type: "undefined",
      error: false,
    });
  });

  it("reads null", () => {
    expect(evaluationFrom({ result: { type: "object", subtype: "null" } }).value).toBe("null");
  });

  it("describes an object rather than printing [object Object]", () => {
    const result = evaluationFrom({
      result: { type: "object", description: "Array(3)", objectId: "{}" },
    });
    expect(result.value).toBe("Array(3)");
    expect(result.error).toBe(false);
  });
});

describe("a throw", () => {
  it("is an error, even though the protocol reports the call as successful", () => {
    const result = evaluationFrom({
      result: { type: "object", subtype: "error", description: "Error: nope" },
      exceptionDetails: {
        text: "Uncaught",
        exception: { type: "object", subtype: "error", description: "Error: nope" },
      },
    });
    expect(result.error).toBe(true);
    expect(result.value).toBe("Error: nope");
  });

  it("falls back to the protocol's own text when there is no exception object", () => {
    const result = evaluationFrom({
      result: { type: "undefined" },
      exceptionDetails: { text: "SyntaxError: Unexpected end of input" },
    });
    expect(result.error).toBe(true);
    expect(result.value).toBe("SyntaxError: Unexpected end of input");
  });
});

describe("a response that makes no sense", () => {
  it("is an error rather than an empty line", () => {
    expect(evaluationFrom(null).error).toBe(true);
    expect(evaluationFrom(undefined).error).toBe(true);
    expect(evaluationFrom("nonsense").error).toBe(true);
  });
});
