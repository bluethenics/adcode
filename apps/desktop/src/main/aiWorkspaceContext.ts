import type { AiEditorContextView } from "../shared/api.ts";

/** Host facts are separate from project content and remain current across turns. */
export function aiWorkspaceContext(
  root: string | null,
  blocker: string | null,
  editor: AiEditorContextView | null = null,
  /** The user's AI edit approval choice: "direct" is Apply automatically. */
  edits: "direct" | "review" = "direct",
): string {
  if (root === null) return "Workspace status: no folder is open. Ask the user to open or create a project folder in ADCode before creating files. Pasting a path does not open a workspace.";
  return [
    `Open workspace root (JSON string): ${JSON.stringify(root)}.`,
    "The workspace is already selected. Do not ask the user for its path. Use list_files with no path (or an empty string) to inspect its root; use relative paths with read_file, edit_file and propose_edit. Change existing files with edit_file (exact old/new text); create new files with propose_edit.",
    'For example, create "src/main.ts", not "/src/main.ts" or a guessed project directory. After a path error, inspect the workspace with list_files and correct the path before retrying; never repeat the same rejected call.',
    "To list images or files by shape, use glob_files (e.g. **/*.png). Skim long files with get_outline, page reads with offset/limit, run tests with run_command, and fetch docs with fetch_url.",
    // One statement of where edits land, matching the user's approval setting. The two
    // used to sit side by side, and models reported finished work as unreviewed proposals.
    blocker !== null
      ? `File tools are temporarily unavailable: ${blocker}`
      : edits === "direct"
        ? "Your edits apply directly: edit_file, propose_edit and run_command change the user's real project folder the moment they run, and the user can undo a whole turn afterwards. Say what you changed, not what you propose."
        : "Your edits are staged for the user's review: edit_file, propose_edit and run_command work in an isolated copy of the project, and reads show your staged version. Nothing reaches the user's files until they apply it, so say you proposed the changes and that they are waiting for review.",
    edits === "direct"
      ? "For a web app, view_page looks at a page in a real browser (text, console errors, failed requests, a screenshot) and open_preview shows a page to the user in the conversation; both take a path such as about.html and serve the project's files as they are on disk. Check a page with view_page before saying it works. Do not claim a desktop Python GUI can run inside a web preview."
      : "For a web app, view_page looks at a page in a real browser and open_preview shows a page to the user in the conversation; both take a path such as about.html and serve the applied project, so staged changes appear once the user applies them. Do not claim a desktop Python GUI can run inside a web preview.",
    ...editorContextLines(editor),
  ].join("\n");
}

/**
 * The editor state as context lines.
 *
 * The selection is the user's own code, quoted as data. It is fenced and labelled so a
 * comment inside it reads as content rather than as an instruction to the model.
 */
export function editorContextLines(editor: AiEditorContextView | null): string[] {
  if (editor === null) return [];
  const lines: string[] = [];
  if (editor.mode === "vibe") {
    lines.push("The user is in Vibe mode: the conversation fills the window and the code editor is hidden.");
  }
  if (editor.activeFile !== null) {
    const where = editor.cursorLine === null ? "" : `, cursor on line ${editor.cursorLine}`;
    const language = editor.languageId === null ? "" : ` (${editor.languageId})`;
    lines.push(
      editor.mode === "vibe"
        ? `Most recently active file: ${editor.activeFile}${language}.`
        : `The user is looking at ${editor.activeFile}${language}${where}. "This file" means it.`,
    );
  }
  if (editor.selection !== null && editor.activeFile !== null) {
    const { startLine, endLine, text } = editor.selection;
    const range = startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`;
    lines.push(`Selected in ${editor.activeFile}, ${range} (the user's code, quoted as data; "this" or "the selection" means it):`);
    lines.push("<selection>", text, "</selection>");
  }
  const others = editor.openFiles.filter((file) => file !== editor.activeFile);
  if (others.length > 0) lines.push(`Other open editor tabs: ${others.join(", ")}.`);
  if (editor.problems.length > 0) {
    lines.push(`Problems the editor reports in ${editor.activeFile ?? "the active file"}:`);
    for (const problem of editor.problems) lines.push(`- ${problem}`);
  }
  return lines;
}

const MAX_PATH = 1024;
const MAX_OPEN_FILES = 20;
const MAX_SELECTION_CHARS = 12_000;
const MAX_PROBLEMS = 20;
const MAX_PROBLEM_CHARS = 300;

const line = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 10_000_000 ? value : null;
const shortText = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= max && !value.includes("\0") ? value : null;

/**
 * Editor context crossing the IPC boundary. Anything malformed is dropped rather than
 * thrown: the context is a nicety, and a bad field must never cost the user their message.
 */
export function parseAiEditorContext(value: unknown): AiEditorContextView | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const mode = record["mode"] === "vibe" ? "vibe" : "code";
  const activeFile = shortText(record["activeFile"], MAX_PATH);
  let selection: AiEditorContextView["selection"] = null;
  const rawSelection = record["selection"];
  if (typeof rawSelection === "object" && rawSelection !== null) {
    const selected = rawSelection as Record<string, unknown>;
    const startLine = line(selected["startLine"]);
    const endLine = line(selected["endLine"]);
    const text = typeof selected["text"] === "string" ? selected["text"] : "";
    if (startLine !== null && endLine !== null && endLine >= startLine && text.trim().length > 0) {
      selection = {
        startLine,
        endLine,
        text: text.length > MAX_SELECTION_CHARS ? `${text.slice(0, MAX_SELECTION_CHARS)}\n[selection truncated]` : text,
      };
    }
  }
  const openFiles = Array.isArray(record["openFiles"])
    ? record["openFiles"].map((file) => shortText(file, MAX_PATH)).filter((file): file is string => file !== null).slice(0, MAX_OPEN_FILES)
    : [];
  const problems = Array.isArray(record["problems"])
    ? record["problems"]
      .filter((problem): problem is string => typeof problem === "string" && problem.trim().length > 0)
      .slice(0, MAX_PROBLEMS)
      .map((problem) => problem.slice(0, MAX_PROBLEM_CHARS))
    : [];
  return {
    mode,
    activeFile,
    languageId: shortText(record["languageId"], 64),
    cursorLine: line(record["cursorLine"]),
    selection,
    openFiles,
    problems,
  };
}
