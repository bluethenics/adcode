/**
 * The composer's `/` commands, shared by the window that offers them and the main process
 * that sends them.
 *
 * A command travels as what the person typed - `/fix the login bug` - so that is what their
 * message bubble shows and what the conversation is titled after. Only the request to the
 * model is expanded into the command's full instruction, here, in one place, so a retry, a
 * queued follow-up and a scheduled message all mean the same thing as the first send.
 */

export type SlashKind = "prompt" | "action" | "diff";

export interface SlashCommand {
  readonly id: string;
  readonly hint: string;
  readonly kind: SlashKind;
  /** The instruction the model receives; the person's own words follow it. */
  readonly prompt?: string;
}

/**
 * "Check my app": look at it the way a visitor would, then fix what is broken. Shared by
 * `/check` and the Check My Running App command, so the two ask for the same thing.
 */
export const CHECK_APP_PROMPT =
  "Look at my running app with view_page, at desktop width and at phone width (390x844). Click through the main links, buttons and forms, and fix everything that is broken: console errors, failed requests, broken images, text or layout that spills sideways. Look again after each fix to confirm it, then show me the result with open_preview. ";

/**
 * Prompts are written the way a senior engineer would ask: name the outcome, the
 * verification, and what not to do. The trailing space leaves room for the person's words.
 */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { id: "check", hint: "Look at the running app and fix what is wrong", kind: "prompt", prompt: `${CHECK_APP_PROMPT}Pay most attention to: ` },
  { id: "fix", hint: "Find the root cause and fix it", kind: "prompt", prompt: "Find the root cause of this problem and fix it, then run the tests or typecheck to confirm the fix: " },
  { id: "explain", hint: "Explain code in plain words", kind: "prompt", prompt: "Explain how this works, step by step and in plain words, pointing at the files and lines involved: " },
  { id: "test", hint: "Write tests and run them", kind: "prompt", prompt: "Write focused tests for this with the project's existing test setup, run them, and fix any failures: " },
  { id: "review", hint: "Review my uncommitted changes", kind: "diff", prompt: "Review the attached uncommitted changes for bugs, edge cases, security problems and missing tests. List concrete findings with file and line, most severe first, and say plainly if you find nothing. Do not change files yet." },
  { id: "commit", hint: "Write a commit message for my changes", kind: "diff", prompt: "Write a concise commit message for the attached changes: a short imperative subject line, a blank line, then the why in two or three lines. Do not change files." },
  { id: "plan", hint: "Plan first, change nothing yet", kind: "prompt", prompt: "Read the relevant code first, then write a short numbered plan for this, with the files each step touches and the risks. Do not propose edits until I say go: " },
  { id: "refactor", hint: "Clean up, same behaviour", kind: "prompt", prompt: "Refactor this for readability and simplicity without changing its behaviour, then run the tests to prove it: " },
  { id: "optimize", hint: "Find and fix what is slow", kind: "prompt", prompt: "Find the real performance bottlenecks here and fix the worst ones, explaining the expected gain of each: " },
  { id: "security", hint: "Audit for vulnerabilities", kind: "prompt", prompt: "Audit this for security vulnerabilities (injection, auth, secrets, unsafe input, path traversal). Report concrete findings with severity, file and line, then propose fixes: " },
  { id: "docs", hint: "Write or update documentation", kind: "prompt", prompt: "Write clear documentation for this in the project's existing style - a README section or doc comments - with a usage example: " },
  { id: "build", hint: "Build a feature end to end", kind: "prompt", prompt: "Build this end to end: read the code it touches, make the change, add or update tests, and run them: " },
  { id: "init", hint: "Write AGENTS.md: how this project works, for every agent", kind: "prompt", prompt: "Read this project - its README, package files, build and test setup, folder layout and a few representative source files - then write AGENTS.md at the root: how to install, build, run and test it (exact commands), how the code is organised, the conventions it follows, and the gotchas a newcomer would hit. Under 80 lines, specific to this project, no generic advice. If AGENTS.md already exists, improve it and keep what is still true. " },
  { id: "helpers", hint: "Split the work across helpers that run at once", kind: "prompt", prompt: "Split this into independent parts and hand them to helpers with delegate_task, so they run at the same time: explore helpers for research, build helpers for separate files. Then check their work, fix what they missed, and tell me what changed: " },
  { id: "new", hint: "Start a new conversation", kind: "action" },
  { id: "history", hint: "Open past conversations", kind: "action" },
  { id: "model", hint: "Switch provider or model", kind: "action" },
  { id: "preview", hint: "Show the live preview here", kind: "action" },
  { id: "team", hint: "Split the task across AI roles", kind: "action" },
  { id: "schedule", hint: "Send a message later", kind: "action" },
  { id: "compact", hint: "Summarise the older conversation to make room", kind: "action" },
  { id: "sleep", hint: "Sleep or shut down the computer when the work is done", kind: "action" },
  { id: "phone", hint: "Chat with this computer from your phone", kind: "action" },
];

/**
 * Slash commands that installed plugins add, or whose instruction they replace.
 *
 * Both processes keep a copy: the window offers and parses them, the main process expands
 * them into the request. A plugin command never shadows an action command (/new, /model) -
 * those open app UI rather than send words, and replacing one would break the app - and only
 * replaces a prompt command's instruction when its manifest said `overrides: true`.
 */
let pluginCommands: readonly SlashCommand[] = [];

export function setPluginSlashCommands(commands: readonly (SlashCommand & { readonly overrides?: boolean })[]): void {
  pluginCommands = commands.filter((command) => {
    const builtIn = SLASH_COMMANDS.find((one) => one.id === command.id);
    return builtIn === undefined ? command.overrides !== true : builtIn.kind !== "action" && command.overrides === true;
  }).map(({ id, hint, kind, prompt }) => (prompt === undefined ? { id, hint, kind } : { id, hint, kind, prompt }));
}

/** The built-in commands with plugin overrides applied, then the commands plugins add. */
export function allSlashCommands(): readonly SlashCommand[] {
  if (pluginCommands.length === 0) return SLASH_COMMANDS;
  const replaced = SLASH_COMMANDS.map((command) => pluginCommands.find((one) => one.id === command.id) ?? command);
  return [...replaced, ...pluginCommands.filter((one) => !SLASH_COMMANDS.some((command) => command.id === one.id))];
}

/**
 * A command typed out in full - `/fix the login bug` - and the words after it.
 *
 * Only a known command counts, and only as the whole first word, so a message that merely
 * starts with a path (`/etc/hosts is wrong`, `/src/app.ts fails`) is sent as written.
 */
export function parseSlashCommand(
  text: string,
  commands: readonly SlashCommand[] = allSlashCommands(),
): { readonly command: SlashCommand; readonly rest: string } | null {
  const match = /^\s*\/([A-Za-z][\w-]*)(?:\s+([\s\S]*))?$/.exec(text);
  if (match === null) return null;
  const id = match[1]!.toLowerCase();
  const command = commands.find((candidate) => candidate.id === id);
  return command === undefined ? null : { command, rest: (match[2] ?? "").trim() };
}

/**
 * What the model is asked when the person sends `text`: the command's instruction with their
 * words after it, or the text unchanged when it is not a prompt command.
 *
 * With no words, the instruction's dangling "...: " lead-in is closed as a sentence, so
 * `/explain` alone asks about "this" - the open file and selection, which ride every turn.
 */
export function expandSlashCommand(text: string, commands: readonly SlashCommand[] = allSlashCommands()): string {
  const parsed = parseSlashCommand(text, commands);
  if (parsed === null || parsed.command.prompt === undefined) return text;
  const prompt = parsed.command.prompt;
  if (parsed.rest.length > 0) return `${prompt}${/\s$/.test(prompt) ? "" : "\n\n"}${parsed.rest}`;
  const closed = prompt.replace(/\s*(?:Pay most attention to)?:\s*$/, "").trimEnd();
  return /[.!?]$/.test(closed) ? closed : `${closed}.`;
}
