import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  IDLE_MS,
  decideCompletion,
  initialCompletionState,
  normalizeInlineCompletion,
  type CompletionEvent,
  type CompletionState,
} from "../src/completion.ts";

/**
 * Brief §1: "No AI feature may block a keystroke. Ever, under any latency or failure
 * condition." §5.3: "the completion request is fired on an idle callback and abandoned
 * the instant the user types again."
 *
 * That makes inline completion a state machine, and a state machine is exhaustively
 * testable - the same treatment the ad scheduler got, for the same reason: this is a
 * behaviour a user judges the product on, and a bug here is felt on every keystroke.
 */
const start = initialCompletionState(1000);

/** Drive a sequence of events and return the effects in order. */
function run(events: readonly CompletionEvent[], from: CompletionState = start) {
  let state = from;
  const effects: string[] = [];

  for (const event of events) {
    const next = decideCompletion(state, event);
    state = next.state;
    effects.push(next.effect.kind);
  }

  return { state, effects };
}

const keystroke = (at: number): CompletionEvent => ({ kind: "keystroke", at });
const idle = (at: number): CompletionEvent => ({ kind: "idle-elapsed", at });

describe("the keystroke rule", () => {
  it("never requests on the keystroke itself", () => {
    const { effects } = run([keystroke(1000)]);
    expect(effects).toEqual(["none"]);
  });

  it("requests only once the idle period has actually elapsed", () => {
    const { effects } = run([keystroke(1000), idle(1000 + IDLE_MS - 1)]);
    expect(effects).toEqual(["none", "none"]);

    const settled = run([keystroke(1000), idle(1000 + IDLE_MS)]);
    expect(settled.effects).toEqual(["none", "request"]);
  });

  it("abandons an in-flight request the instant the user types again", () => {
    const { effects } = run([
      keystroke(1000),
      idle(1000 + IDLE_MS),
      keystroke(1000 + IDLE_MS + 5),
    ]);

    expect(effects).toEqual(["none", "request", "cancel"]);
  });

  it("restarts the idle clock on every keystroke", () => {
    // Typing continuously must never produce a request, however long it goes on.
    const events: CompletionEvent[] = [];
    for (let i = 0; i < 50; i++) {
      events.push(keystroke(1000 + i * (IDLE_MS - 1)));
      events.push(idle(1000 + i * (IDLE_MS - 1) + IDLE_MS - 1));
    }

    expect(run(events).effects).not.toContain("request");
  });
});

describe("stale responses", () => {
  it("shows a response that matches the live request", () => {
    const first = decideCompletion(start, keystroke(1000));
    const second = decideCompletion(first.state, idle(1000 + IDLE_MS));

    expect(second.effect.kind).toBe("request");
    if (second.effect.kind !== "request") throw new Error("expected a request");

    const shown = decideCompletion(second.state, {
      kind: "response",
      requestId: second.effect.requestId,
      text: "const x = 1;",
    });

    expect(shown.effect.kind).toBe("show");
  });

  it("discards a response whose request was superseded", () => {
    // The response arrives after the user typed again. Showing it would put stale ghost
    // text under a cursor that has already moved.
    const first = decideCompletion(start, keystroke(1000));
    const second = decideCompletion(first.state, idle(1000 + IDLE_MS));
    if (second.effect.kind !== "request") throw new Error("expected a request");

    const typed = decideCompletion(second.state, keystroke(1000 + IDLE_MS + 1));

    const late = decideCompletion(typed.state, {
      kind: "response",
      requestId: second.effect.requestId,
      text: "stale",
    });

    expect(late.effect.kind).toBe("none");
  });

  it("discards a response with an unknown request id", () => {
    const late = decideCompletion(start, { kind: "response", requestId: 9999, text: "x" });
    expect(late.effect.kind).toBe("none");
  });

  it("issues a new request id each time, so ids cannot collide", () => {
    const a = decideCompletion(decideCompletion(start, keystroke(1000)).state, idle(1000 + IDLE_MS));
    if (a.effect.kind !== "request") throw new Error("expected a request");

    const b = decideCompletion(
      decideCompletion(a.state, keystroke(5000)).state,
      idle(5000 + IDLE_MS),
    );
    if (b.effect.kind !== "request") throw new Error("expected a request");

    expect(b.effect.requestId).not.toBe(a.effect.requestId);
  });
});

describe("acceptance and dismissal", () => {
  function shown() {
    const a = decideCompletion(start, keystroke(1000));
    const b = decideCompletion(a.state, idle(1000 + IDLE_MS));
    if (b.effect.kind !== "request") throw new Error("expected a request");
    return decideCompletion(b.state, { kind: "response", requestId: b.effect.requestId, text: "ghost" }).state;
  }

  it("accepting clears the suggestion", () => {
    const after = decideCompletion(shown(), { kind: "accept" });
    expect(after.effect.kind).toBe("accept");
    expect(after.state.suggestion).toBeNull();
  });

  it("dismissing clears the suggestion without accepting it", () => {
    const after = decideCompletion(shown(), { kind: "dismiss" });
    expect(after.effect.kind).toBe("hide");
    expect(after.state.suggestion).toBeNull();
  });

  it("typing clears a shown suggestion", () => {
    const after = decideCompletion(shown(), keystroke(9999));
    expect(after.state.suggestion).toBeNull();
  });

  it("accepting nothing is a no-op rather than an error", () => {
    expect(decideCompletion(start, { kind: "accept" }).effect.kind).toBe("none");
  });
});

describe("disabled", () => {
  it("never requests when inline completion is switched off", () => {
    // §4: every feature is individually switchable.
    const off: CompletionState = { ...start, enabled: false };
    const { effects } = run([keystroke(1000), idle(1000 + IDLE_MS)], off);

    expect(effects).not.toContain("request");
  });
});

describe("provider text normalization", () => {
  it("keeps only insertable code and strips markdown fences", () => {
    expect(normalizeInlineCompletion("```ts\nreturn value;\n```")).toBe("return value;");
  });

  it("removes a repeated cursor prefix without changing a genuine suffix", () => {
    expect(normalizeInlineCompletion("const total = price * count;", "const total = ")).toBe(
      "price * count;",
    );
    expect(normalizeInlineCompletion("price * count;", "const total = ")).toBe("price * count;");
  });

  it("rejects explanations and bounds unexpectedly large replies", () => {
    expect(normalizeInlineCompletion("Here is the code you requested:\nreturn 1;")).toBe("");
    expect(normalizeInlineCompletion("x".repeat(10_000)).length).toBeLessThanOrEqual(2_048);
  });
});

describe("invariants", () => {
  const eventArb: fc.Arbitrary<CompletionEvent> = fc.oneof(
    fc.integer({ min: 0, max: 100_000 }).map((at) => ({ kind: "keystroke" as const, at })),
    fc.integer({ min: 0, max: 100_000 }).map((at) => ({ kind: "idle-elapsed" as const, at })),
    fc.integer({ min: 0, max: 20 }).map((requestId) => ({
      kind: "response" as const,
      requestId,
      text: "x",
    })),
    fc.constant({ kind: "accept" as const }),
    fc.constant({ kind: "dismiss" as const }),
  );

  it("never issues a request within the idle window of a keystroke", () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 200 }), (events) => {
        let state = start;
        // Seeded from the initial state, not null: a fresh state already carries the
        // moment it was created, so a request may legitimately fire before any keystroke
        // event appears in the sequence.
        let lastKeystrokeAt = start.lastKeystrokeAt;

        for (const event of events) {
          const next = decideCompletion(state, event);

          if (next.effect.kind === "request") {
            expect(event.kind).toBe("idle-elapsed");
            if (event.kind === "idle-elapsed") {
              expect(event.at - lastKeystrokeAt).toBeGreaterThanOrEqual(IDLE_MS);
            }
          }

          if (event.kind === "keystroke") lastKeystrokeAt = event.at;
          state = next.state;
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("never shows a suggestion from a superseded request", () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 200 }), (events) => {
        let state = start;

        for (const event of events) {
          const next = decideCompletion(state, event);

          if (next.effect.kind === "show") {
            expect(event.kind).toBe("response");
            if (event.kind === "response") {
              expect(event.requestId).toBe(state.inFlightRequestId);
            }
          }

          state = next.state;
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("never leaves a suggestion visible after a keystroke", () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 200 }), (events) => {
        let state = start;

        for (const event of events) {
          state = decideCompletion(state, event).state;
          if (event.kind === "keystroke") expect(state.suggestion).toBeNull();
        }
      }),
      { numRuns: 1000 },
    );
  });
});
