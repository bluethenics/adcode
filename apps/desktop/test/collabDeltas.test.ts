/**
 * The Monaco/Yjs index arithmetic.
 *
 * Tested against a plain string rather than a Monaco model, and that is the point: the whole
 * reason `deltas.ts` imports nothing is that this conversion is where the bugs live, and a test
 * that needed an editor would not exist.
 *
 * The round-trip property at the end is the real assertion. Any single case can be argued about;
 * "applying the produced edits to the original text yields what Yjs says the document now is"
 * either holds for arbitrary deltas or it does not.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { changeToOps, deltaToEdits, orderChanges } from "../src/renderer/collab/deltas.ts";
import type { OffsetEdit } from "../src/renderer/collab/deltas.ts";

/** Apply offset edits the way Monaco's `pushEditOperations` would: all against the original. */
function applyEdits(original: string, edits: readonly OffsetEdit[]): string {
  // Descending, so each splice leaves earlier offsets untouched.
  const ordered = [...edits].sort((a, b) => b.start - a.start);

  let text = original;
  for (const edit of ordered) {
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  }

  return text;
}

describe("deltaToEdits", () => {
  it("turns a leading insertion into an edit at offset zero", () => {
    expect(deltaToEdits([{ insert: "abc" }])).toEqual([{ start: 0, end: 0, text: "abc" }]);
  });

  it("advances past a retain before inserting", () => {
    expect(deltaToEdits([{ retain: 5 }, { insert: "X" }])).toEqual([
      { start: 5, end: 5, text: "X" },
    ]);
  });

  it("turns a delete into an empty replacement of its range", () => {
    expect(deltaToEdits([{ retain: 2 }, { delete: 3 }])).toEqual([
      { start: 2, end: 5, text: "" },
    ]);
  });

  it("does not advance the cursor past inserted text", () => {
    /*
     * The bug this file exists to prevent.
     *
     * Inserted text is not part of the document these offsets address, so an insertion must not
     * move the cursor. Advancing it shifts every later operation in the delta by the length of
     * the insertion - which shows up as characters landing a few positions off, and only when
     * two people edit the same line, which is exactly the case the feature is for.
     */
    const edits = deltaToEdits([{ insert: "ab" }, { retain: 1 }, { insert: "cd" }]);

    expect(edits).toEqual([
      { start: 0, end: 0, text: "ab" },
      { start: 1, end: 1, text: "cd" },
    ]);
  });

  it("handles a replacement expressed as delete then insert", () => {
    const edits = deltaToEdits([{ retain: 1 }, { delete: 2 }, { insert: "ZZ" }]);
    expect(applyEdits("abcdef", edits)).toBe("aZZdef");
  });

  it("ignores an operation it does not recognise", () => {
    // A delta carrying attributes or an unknown key must not become a phantom edit.
    expect(deltaToEdits([{ retain: 2 }, {} as never, { insert: "x" }])).toEqual([
      { start: 2, end: 2, text: "x" },
    ]);
  });

  it("returns nothing for an empty delta", () => {
    expect(deltaToEdits([])).toEqual([]);
  });

  it("reproduces what Yjs actually did, for arbitrary edits", () => {
    /*
     * The property that matters, checked against Yjs itself rather than against my reading of
     * its delta format. A real `Y.Text` is edited, its observer's delta is converted, and the
     * conversion is applied to the original string - the two must agree.
     */
    const scripts: { start: string; edit: (text: Y.Text) => void }[] = [
      { start: "hello world", edit: (t) => t.insert(0, "X") },
      { start: "hello world", edit: (t) => t.insert(5, "MIDDLE") },
      { start: "hello world", edit: (t) => t.insert(11, "END") },
      { start: "hello world", edit: (t) => t.delete(0, 5) },
      { start: "hello world", edit: (t) => t.delete(5, 6) },
      {
        start: "hello world",
        edit: (t) => {
          t.delete(0, 5);
          t.insert(0, "goodbye");
        },
      },
      {
        start: "one two three",
        edit: (t) => {
          t.insert(3, "!");
          t.insert(0, "@");
          t.delete(8, 3);
        },
      },
      { start: "", edit: (t) => t.insert(0, "from empty") },
      { start: "line one\nline two", edit: (t) => t.insert(8, "\nline inserted") },
      { start: "emoji 😀 here", edit: (t) => t.insert(0, "🎉") },
    ];

    for (const script of scripts) {
      const doc = new Y.Doc();
      const text = doc.getText("t");
      text.insert(0, script.start);

      /*
       * Every delta, in order - not just the last one.
       *
       * `observe` fires once per transaction, and each delta describes a change against the
       * document *as of that event*. An earlier version of this test kept only the final delta
       * and applied it to the original string, which failed the moment a script made two edits
       * in a row. Folding them is both the correct check and exactly what the binding does: one
       * update event, one batch of Monaco edits, repeated.
       */
      const deltas: (readonly Record<string, unknown>[])[] = [];
      text.observe((event) => {
        deltas.push(event.delta as readonly Record<string, unknown>[]);
      });

      script.edit(text);

      let converted = script.start;
      for (const delta of deltas) {
        converted = applyEdits(converted, deltaToEdits(delta as never));
      }

      expect(converted, JSON.stringify({ start: script.start, deltas })).toBe(text.toString());

      doc.destroy();
    }
  });
});

describe("changeToOps", () => {
  it("emits a delete before an insert for a replacement", () => {
    // Order matters: inserting first would place the new text inside the range about to go.
    expect(changeToOps({ rangeOffset: 3, rangeLength: 2, text: "XY" })).toEqual([
      { kind: "delete", index: 3, length: 2 },
      { kind: "insert", index: 3, text: "XY" },
    ]);
  });

  it("emits only an insert for a pure insertion", () => {
    expect(changeToOps({ rangeOffset: 7, rangeLength: 0, text: "abc" })).toEqual([
      { kind: "insert", index: 7, text: "abc" },
    ]);
  });

  it("emits only a delete for a pure deletion", () => {
    expect(changeToOps({ rangeOffset: 1, rangeLength: 4, text: "" })).toEqual([
      { kind: "delete", index: 1, length: 4 },
    ]);
  });

  it("emits nothing when nothing changed", () => {
    // An empty Yjs operation still produces an update, and an update that changes nothing is a
    // message to every peer for no reason - on a path that runs per keystroke.
    expect(changeToOps({ rangeOffset: 4, rangeLength: 0, text: "" })).toEqual([]);
  });
});

describe("orderChanges", () => {
  it("puts the latest offset first", () => {
    // Monaco documents this order already; sorting defensively costs nothing and a multi-cursor
    // edit arriving the other way round would corrupt text silently.
    const ordered = orderChanges([{ rangeOffset: 2 }, { rangeOffset: 40 }, { rangeOffset: 9 }]);
    expect(ordered.map((c) => c.rangeOffset)).toEqual([40, 9, 2]);
  });

  it("does not mutate its input", () => {
    const input = [{ rangeOffset: 1 }, { rangeOffset: 5 }];
    orderChanges(input);
    expect(input.map((c) => c.rangeOffset)).toEqual([1, 5]);
  });
});
