import { describe, expect, it } from "vitest";
import { createToolDraftReader } from "../src/toolDraft.ts";

/** Feed fragments in order; collect the code per edit and the last path reported. */
function drain(tool: string, fragments: readonly string[]): { path: string | null; edits: string[] } {
  const reader = createToolDraftReader(tool);
  if (reader === null) throw new Error(`${tool} is not a draft tool`);
  let path: string | null = null;
  const edits: string[] = [];
  for (const fragment of fragments) {
    for (const update of reader.push(fragment)) {
      if (update.path !== null) path = update.path;
      edits[update.edit] = (edits[update.edit] ?? "") + update.append;
    }
  }
  return { path, edits };
}

// Escapes of every kind, including a surrogate pair, so a split can land inside each.
const CODE = 'const greet = "hi";\n\t// caf\u00e9 \ud83d\ude00 \\ done';
const PROPOSE = `{"path":"src/app.ts","contents":${JSON.stringify(CODE).replace("\u00e9", "\\u00e9").replace("\ud83d\ude00", "\\ud83d\\ude00")},"summary":"x"}`;

describe("createToolDraftReader", () => {
  it("decodes propose_edit contents and its path from one fragment", () => {
    expect(PROPOSE).toContain("\\u00e9");
    expect(drain("propose_edit", [PROPOSE])).toEqual({ path: "src/app.ts", edits: [CODE] });
  });

  it("gives the same result for every two-way split, including inside escapes", () => {
    for (let cut = 1; cut < PROPOSE.length; cut += 1) {
      expect(drain("propose_edit", [PROPOSE.slice(0, cut), PROPOSE.slice(cut)])).toEqual({ path: "src/app.ts", edits: [CODE] });
    }
  });

  it("gives the same result fed one character at a time", () => {
    expect(drain("propose_edit", [...PROPOSE])).toEqual({ path: "src/app.ts", edits: [CODE] });
  });

  it("streams code before the call is complete", () => {
    const reader = createToolDraftReader("propose_edit")!;
    reader.push('{"path":"a.ts","contents":"line one\\nline');
    expect(reader.push(" two")).toEqual([{ path: "a.ts", edit: 0, append: " two" }]);
  });

  it("splits one fragment that ends one replacement and starts the next", () => {
    const reader = createToolDraftReader("edit_file")!;
    reader.push('{"path":"a.ts","edits":[{"old_string":"x","new_string":"on');
    expect(reader.push('e"},{"old_string":"y","new_string":"tw')).toEqual([
      { path: "a.ts", edit: 0, append: "e" },
      { path: "a.ts", edit: 1, append: "tw" },
    ]);
  });

  it("numbers each replacement in edit_file's edits and never leaks old_string", () => {
    const json = '{"path":"a.ts","edits":[{"old_string":"OLD1","new_string":"one"},{"old_string":"OLD2","new_string":"two {\\"x\\": [1]}"}]}';
    for (let cut = 1; cut < json.length; cut += 1) {
      const result = drain("edit_file", [json.slice(0, cut), json.slice(cut)]);
      expect(result).toEqual({ path: "a.ts", edits: ["one", 'two {"x": [1]}'] });
    }
  });

  it("treats a top-level new_string as edit 0", () => {
    const json = '{"path":"b.ts","old_string":"OLD","new_string":"fresh"}';
    expect(drain("edit_file", [json])).toEqual({ path: "b.ts", edits: ["fresh"] });
  });

  it("keeps code that arrives before the path, and reports the path when it closes", () => {
    expect(drain("propose_edit", ['{"contents":"abc",', '"path":"late.ts"}'])).toEqual({ path: "late.ts", edits: ["abc"] });
  });

  it("ignores key-like text inside other string values", () => {
    const json = '{"summary":"set \\"contents\\": nope","path":"c.ts","contents":"yes"}';
    expect(drain("propose_edit", [json])).toEqual({ path: "c.ts", edits: ["yes"] });
  });

  it("reports nothing when a fragment adds no code and no new path", () => {
    const reader = createToolDraftReader("propose_edit")!;
    expect(reader.push('{"path":"a.ts",')).toEqual([{ path: "a.ts", edit: 0, append: "" }]);
    expect(reader.push("  ")).toEqual([]);
    expect(reader.push('"summary":"s"')).toEqual([]);
  });

  it("has no reader for tools that do not write code", () => {
    expect(createToolDraftReader("read_file")).toBeNull();
    expect(createToolDraftReader("run_command")).toBeNull();
  });
});
