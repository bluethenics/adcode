/**
 * The import list's controls, as plain functions: what to scan, which listed conversations
 * show, in what order, which start ticked, and the choices remembered for next time.
 *
 * Kept out of moveIn.ts so the rules can be tested without a window.
 */
import type { ChatImportEntry, ChatImportOptions, ChatImportScanOptions, ChatImportTool } from "../../shared/api.ts";

export type ImportSort = "newest" | "oldest" | "messages" | "title";

export interface ImportView {
  /** Words that must all appear in the title or project folder, any case. */
  readonly query: string;
  /** Source names to show ("Claude Code", "Codex" …); empty shows every source. */
  readonly sources: readonly string[];
  readonly hideImported: boolean;
  readonly sort: ImportSort;
}

export const DEFAULT_VIEW: ImportView = { query: "", sources: [], hideImported: false, sort: "newest" };

/** The conversations the list shows for this view, in its order. */
export function filterImports(entries: readonly ChatImportEntry[], view: ImportView): ChatImportEntry[] {
  const words = view.query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = entries.filter((entry) => {
    if (view.hideImported && entry.imported === true) return false;
    if (view.sources.length > 0 && !view.sources.includes(entry.sourceName)) return false;
    if (words.length === 0) return true;
    const haystack = `${entry.title} ${entry.folder ?? ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  const order: Record<ImportSort, (a: ChatImportEntry, b: ChatImportEntry) => number> = {
    newest: (a, b) => b.updatedAt - a.updatedAt,
    oldest: (a, b) => a.updatedAt - b.updatedAt,
    messages: (a, b) => b.messages - a.messages || b.updatedAt - a.updatedAt,
    title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  };
  return shown.sort(order[view.sort]);
}

/** How many listed conversations each source has, for the filter chips. */
export function sourceCounts(entries: readonly ChatImportEntry[]): { readonly name: string; readonly count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.sourceName, (counts.get(entry.sourceName) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

/**
 * What starts ticked after a scan: everything not imported yet. The person came to bring
 * things over, so unticking is the one press; one already brought over stays as it is unless
 * they tick it to update it.
 */
export function initialSelection(entries: readonly ChatImportEntry[]): Set<string> {
  return new Set(entries.filter((entry) => entry.imported !== true).map((entry) => entry.key));
}

export interface ImportPrefs {
  readonly scan: Required<Pick<ChatImportScanOptions, "tools" | "perTool">> & { readonly sinceDays: number | null; readonly onlyCurrentProject: boolean };
  readonly import: { readonly skipImported: boolean; readonly lastMessages: number | null; readonly here: boolean };
}

export const ALL_TOOLS: readonly ChatImportTool[] = ["claude-code", "codex", "opencode"];
export const TOOL_NAMES: Readonly<Record<ChatImportTool, string>> = { "claude-code": "Claude Code", codex: "Codex", opencode: "OpenCode" };
export const SINCE_CHOICES: readonly { readonly days: number | null; readonly label: string }[] = [
  { days: null, label: "Any time" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 365, label: "Last year" },
];
export const PER_TOOL_CHOICES: readonly number[] = [50, 150, 500, 1000];
export const KEEP_CHOICES: readonly { readonly messages: number | null; readonly label: string }[] = [
  { messages: null, label: "Every message" },
  { messages: 200, label: "Latest 200 messages" },
  { messages: 50, label: "Latest 50 messages" },
];

export const DEFAULT_PREFS: ImportPrefs = {
  scan: { tools: ALL_TOOLS, perTool: 150, sinceDays: null, onlyCurrentProject: false },
  import: { skipImported: false, lastMessages: null, here: false },
};

const KEY = "adcode.moveIn.prefs";

/** The last choices, held to the lists above; anything unreadable falls back to the defaults. */
export function readPrefs(storage: Pick<Storage, "getItem"> | null): ImportPrefs {
  let raw: unknown = null;
  try { raw = JSON.parse(storage?.getItem(KEY) ?? "null"); } catch { raw = null; }
  const value = typeof raw === "object" && raw !== null ? raw as { scan?: Record<string, unknown>; import?: Record<string, unknown> } : {};
  const scan = value.scan ?? {}, chosen = value.import ?? {};
  const tools = Array.isArray(scan["tools"]) ? ALL_TOOLS.filter((tool) => (scan["tools"] as unknown[]).includes(tool)) : DEFAULT_PREFS.scan.tools;
  const perTool = PER_TOOL_CHOICES.includes(scan["perTool"] as number) ? scan["perTool"] as number : DEFAULT_PREFS.scan.perTool;
  const sinceDays = SINCE_CHOICES.some((choice) => choice.days === scan["sinceDays"]) ? scan["sinceDays"] as number | null : DEFAULT_PREFS.scan.sinceDays;
  const lastMessages = KEEP_CHOICES.some((choice) => choice.messages === chosen["lastMessages"]) ? chosen["lastMessages"] as number | null : DEFAULT_PREFS.import.lastMessages;
  return {
    scan: { tools: tools.length === 0 ? ALL_TOOLS : tools, perTool, sinceDays, onlyCurrentProject: scan["onlyCurrentProject"] === true },
    import: { skipImported: chosen["skipImported"] === true, lastMessages, here: chosen["here"] === true },
  };
}

export function writePrefs(storage: Pick<Storage, "setItem"> | null, prefs: ImportPrefs): void {
  try { storage?.setItem(KEY, JSON.stringify(prefs)); } catch { /* A private window: nothing to remember with. */ }
}

/** The import call's options from the remembered choices. */
export function importOptions(prefs: ImportPrefs): ChatImportOptions {
  return { skipImported: prefs.import.skipImported, lastMessages: prefs.import.lastMessages };
}

/** Keys in batches, so a long import can say how far it has got. */
export function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}
