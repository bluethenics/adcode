/**
 * The debug log's shape and its privacy rules, with no Electron and no disk.
 *
 * A debug log is only useful if people are willing to send it, and they are only willing
 * if it cannot leak anything. So every line is redacted on the way *in*: API keys and
 * bearer tokens, e-mail addresses, the home directory and the open project's path. What
 * is left is what triage needs - which component failed, with what message, when, on
 * which versions and which model - and nothing about what the user was working on.
 */

export type DebugLevel = "error" | "warn" | "info";

export interface DebugEntry {
  readonly at: number;
  readonly level: DebugLevel;
  /** Which part of the app: `ai`, `ipc:fs:read`, `renderer`, `main`, ... */
  readonly source: string;
  readonly message: string;
}

export interface DebugEnvironment {
  readonly appVersion: string;
  readonly electron: string;
  readonly chrome: string;
  readonly node: string;
  readonly os: string;
  readonly locale: string;
  readonly provider: string;
  readonly model: string;
  readonly effort: string;
  readonly fileTools: boolean;
  readonly projectOpen: boolean;
  readonly windows: readonly string[];
}

/** One line of a log is never allowed to be a page. */
export const MAX_MESSAGE = 1_000;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replace secrets and personal paths. `paths` are replaced longest first, as named tokens. */
export function redact(text: string, paths: ReadonlyArray<readonly [path: string, token: string]> = []): string {
  let out = text
    // Provider keys by their published prefixes, then anything that follows "Bearer".
    .replace(/\b(?:sk-(?:ant-|proj-|or-)?|gsk_|xai-|pplx-|nvapi-|ghp_|gho_|github_pat_|hf_|AIza)[A-Za-z0-9_-]{8,}/g, "[redacted key]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/([?&](?:key|api_key|apikey|token|access_token)=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "[email]");
  const ordered = [...paths].filter(([path]) => path.length > 3).sort((a, b) => b[0].length - a[0].length);
  for (const [path, token] of ordered) {
    // Either separator and any case: Windows paths arrive in every combination.
    const pattern = escape(path.replace(/\\/g, "/")).replace(/\//g, "[\\\\/]");
    out = out.replace(new RegExp(pattern, "gi"), token);
  }
  return out;
}

export function clip(text: string, max = MAX_MESSAGE): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length <= max ? single : `${single.slice(0, max - 1)}…`;
}

const stamp = (at: number): string => new Date(at).toISOString().replace("T", " ").slice(0, 19);

export function formatEntry(entry: DebugEntry): string {
  return `${stamp(entry.at)} ${entry.level.toUpperCase().padEnd(5)} ${entry.source}: ${entry.message}`;
}

function header(env: DebugEnvironment, now: number): string[] {
  return [
    "ADCode debug log",
    `Generated: ${stamp(now)} UTC`,
    `ADCode ${env.appVersion} · Electron ${env.electron} · Chrome ${env.chrome} · Node ${env.node}`,
    `OS: ${env.os} · locale ${env.locale}`,
    `AI: ${env.provider} / ${env.model} · effort ${env.effort} · file tools ${env.fileTools ? "on" : "off"}`,
    `Project open: ${env.projectOpen ? "yes (name and path hidden)" : "no"} · windows: ${env.windows.join(", ") || "none"}`,
  ];
}

/** The whole log, for Save and Copy. */
export function formatReport(env: DebugEnvironment, entries: readonly DebugEntry[], now = Date.now()): string {
  return [
    ...header(env, now),
    "",
    entries.length === 0 ? "No events recorded yet." : `Events, oldest first (${entries.length}):`,
    ...entries.map(formatEntry),
    "",
  ].join("\n");
}

/**
 * The part that fits in a report form: the environment and the most recent problems.
 *
 * Errors and warnings only, newest kept when something has to go, and never longer than
 * `maxChars` - the report form's server takes 4,000 characters for the whole message.
 */
export function formatSummary(env: DebugEnvironment, entries: readonly DebugEntry[], maxChars: number, now = Date.now()): string {
  const lines = header(env, now).slice(2);
  const problems = entries.filter((entry) => entry.level !== "info").map((entry) => clip(formatEntry(entry), 240));
  const kept: string[] = [];
  let size = lines.join("\n").length + 40;
  for (const line of [...problems].reverse()) {
    if (size + line.length + 1 > maxChars) break;
    kept.unshift(line);
    size += line.length + 1;
  }
  const title = problems.length === 0
    ? "No recent errors recorded."
    : kept.length < problems.length
      ? `Recent problems (latest ${kept.length} of ${problems.length}):`
      : `Recent problems (${kept.length}):`;
  return [...lines, title, ...kept].join("\n").slice(0, maxChars);
}
