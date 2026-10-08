/**
 * Reading the code out of a tool call while the model is still writing it.
 *
 * Providers stream a call's arguments as JSON fragments, and the agent loop used to collect
 * them silently until the call was complete - so a 200-line file appeared all at once, after
 * the fact. This reads the fragments as they arrive and reports the two things a live window
 * needs: the file's path, once it is known, and the characters of new code since the last
 * fragment.
 *
 * Only the code a tool *writes* is reported: `contents` for `propose_edit`, and `new_string`
 * for `edit_file` - top level, or one per entry of `edits`, numbered so each replacement is
 * its own block. `old_string` is never reported; it is the text being replaced, not code
 * being written.
 *
 * A small streaming scanner rather than repeated `JSON.parse` of a growing prefix: parsing a
 * 100 KB file on every fragment is quadratic, and a prefix is not valid JSON anyway. Escapes
 * split across fragments - `\` in one, `n` in the next, or half of a `\uXXXX` - are carried
 * over, so every split of the same arguments decodes to the same text.
 *
 * Pure: no I/O, no timers.
 */

/** The tools whose arguments carry code worth watching being written. */
export const DRAFT_TOOL_NAMES: ReadonlySet<string> = new Set(["edit_file", "propose_edit"]);

export interface ToolDraftUpdate {
  /** The file being written, or null until its path has arrived in full. */
  readonly path: string | null;
  /** Which replacement this code belongs to: 0 for a whole file or a single replacement. */
  readonly edit: number;
  /** Code decoded since the previous fragment. Empty when only the path became known. */
  readonly append: string;
}

export interface ToolDraftReader {
  /** Feed the next fragment. Returns what it added, in order; empty when it added nothing. */
  push(fragment: string): readonly ToolDraftUpdate[];
}

type Frame =
  | { readonly kind: "object"; key: string | null; expectKey: boolean }
  | { readonly kind: "array"; index: number };

type StringRole = "key" | "path" | "code" | "skip";

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

export function createToolDraftReader(toolName: string): ToolDraftReader | null {
  if (!DRAFT_TOOL_NAMES.has(toolName)) return null;
  const codeKey = toolName === "propose_edit" ? "contents" : "new_string";

  const stack: Frame[] = [];
  let inString = false;
  let role: StringRole = "skip";
  let roleEdit = 0;
  let keyText = "";
  let pathText = "";
  /** Null outside an escape; "" right after a backslash; "u…" while reading a \uXXXX. */
  let escape: string | null = null;
  let pendingHigh: number | null = null;
  let path: string | null = null;

  /** What a string starting here is: a key, the path, code, or something to ignore. */
  function roleHere(): { role: StringRole; edit: number } {
    const top = stack.at(-1);
    if (top === undefined) return { role: "skip", edit: 0 };
    if (top.kind === "object" && top.expectKey) return { role: "key", edit: 0 };
    if (stack.length === 1 && top.kind === "object") {
      if (top.key === "path") return { role: "path", edit: 0 };
      if (top.key === codeKey) return { role: "code", edit: 0 };
    }
    if (toolName === "edit_file" && stack.length === 3) {
      const [root, list, entry] = stack as [Frame, Frame, Frame];
      if (root.kind === "object" && root.key === "edits" && list.kind === "array" && entry.kind === "object" && entry.key === "new_string") {
        return { role: "code", edit: list.index };
      }
    }
    return { role: "skip", edit: 0 };
  }

  return {
    push(fragment) {
      const updates: { path: string | null; edit: number; append: string }[] = [];
      const pathBefore = path;

      const write = (text: string): void => {
        if (role === "key") keyText += text;
        else if (role === "path") pathText += text;
        else if (role === "code") {
          const last = updates.at(-1);
          if (last !== undefined && last.edit === roleEdit) last.append += text;
          else updates.push({ path: null, edit: roleEdit, append: text });
        }
      };
      const flushHigh = (): void => {
        if (pendingHigh === null) return;
        write(String.fromCharCode(pendingHigh));
        pendingHigh = null;
      };
      const writeUnit = (code: number): void => {
        if (code >= 0xd800 && code <= 0xdbff) {
          flushHigh();
          pendingHigh = code;
        } else if (code >= 0xdc00 && code <= 0xdfff && pendingHigh !== null) {
          write(String.fromCharCode(pendingHigh, code));
          pendingHigh = null;
        } else {
          flushHigh();
          write(String.fromCharCode(code));
        }
      };

      for (const ch of fragment) {
        if (inString) {
          if (escape === null) {
            if (ch === "\\") escape = "";
            else if (ch === '"') {
              flushHigh();
              inString = false;
              const top = stack.at(-1);
              if (role === "key" && top?.kind === "object") top.key = keyText;
              if (role === "path") path = pathText;
            } else {
              flushHigh();
              write(ch);
            }
          } else if (escape === "") {
            if (ch === "u") escape = "u";
            else {
              escape = null;
              flushHigh();
              write(SIMPLE_ESCAPES[ch] ?? ch);
            }
          } else {
            escape += ch;
            if (escape.length === 5) {
              const code = Number.parseInt(escape.slice(1), 16);
              escape = null;
              if (Number.isFinite(code)) writeUnit(code);
            }
          }
          continue;
        }

        const top = stack.at(-1);
        switch (ch) {
          case '"': {
            const next = roleHere();
            role = next.role;
            roleEdit = next.edit;
            if (role === "key") keyText = "";
            if (role === "path") pathText = "";
            inString = true;
            break;
          }
          case "{":
            stack.push({ kind: "object", key: null, expectKey: true });
            break;
          case "[":
            stack.push({ kind: "array", index: 0 });
            break;
          case "}":
          case "]":
            stack.pop();
            break;
          case ":":
            if (top?.kind === "object") top.expectKey = false;
            break;
          case ",":
            if (top?.kind === "object") {
              top.expectKey = true;
              top.key = null;
            } else if (top?.kind === "array") top.index += 1;
            break;
          default:
            // Whitespace, numbers, true/false/null: nothing a live window shows.
            break;
        }
      }

      for (const update of updates) update.path = path;
      if (path !== pathBefore && updates.length === 0) updates.push({ path, edit: 0, append: "" });
      return updates;
    },
  };
}
