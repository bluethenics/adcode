/**
 * Desktop feature use: which parts of ADCode people actually use, so the team knows what to
 * improve and what nobody can find.
 *
 * The editor counts uses locally - a command run, a page opened, a product event, an add-on
 * shown - and sends one report per day: the day and a map from fixed names to counts. Nothing
 * else. No account id is stored (the request is authenticated only so strangers cannot flood
 * it), no project, file, prompt or free text can be expressed, and a person can turn the whole
 * thing off with "Help improve ADCode" in Settings.
 *
 * Stored as daily totals per name, plus how many installs reported that name that day, which
 * is all the admin view needs and all it can ever show.
 */

/** `cmd:` a command id, `page:` a page, `event:` a product event, `addon:` a plugin add-on. */
export const APP_USAGE_NAME = /^(?:cmd|page|event|addon):[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
export const APP_USAGE_LIMITS = { names: 400, count: 100_000, daysBack: 3 } as const;

export interface AppUsageReport {
  /** UTC day, "YYYY-MM-DD". */
  readonly day: string;
  readonly counts: Readonly<Record<string, number>>;
}

export interface AppUsageRow {
  readonly day: string;
  readonly name: string;
  readonly uses: number;
  /** Installs that reported this name on this day. */
  readonly clients: number;
}

export interface AppUsageStore {
  add(report: AppUsageReport): Promise<void>;
  read(startDay: string, endDay: string): Promise<AppUsageRow[]>;
}

export const utcDay = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** A report as it arrives, or null when anything about it is not what the editor sends. */
export function parseAppUsage(raw: unknown, now: number): AppUsageReport | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== "day" && key !== "counts")) return null;
  const day = value["day"];
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const at = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(at) || at > now || now - at > (APP_USAGE_LIMITS.daysBack + 1) * 86_400_000) return null;
  const counts = value["counts"];
  if (typeof counts !== "object" || counts === null || Array.isArray(counts)) return null;
  const entries = Object.entries(counts as Record<string, unknown>);
  if (entries.length === 0 || entries.length > APP_USAGE_LIMITS.names) return null;
  const clean: Record<string, number> = {};
  for (const [name, count] of entries) {
    if (!APP_USAGE_NAME.test(name)) return null;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > APP_USAGE_LIMITS.count) return null;
    clean[name] = count;
  }
  return { day, counts: clean };
}

export interface AppUsageSummaryRow {
  readonly name: string;
  readonly kind: "cmd" | "page" | "event" | "addon";
  readonly label: string;
  readonly uses: number;
  /** Install-days that used it: an install using it on 3 days counts 3. */
  readonly clientDays: number;
  /** Uses in the newer half of the range against the older half, or null with no older uses. */
  readonly trend: number | null;
}

export interface AppUsageSummary {
  readonly days: number;
  readonly reportingDays: number;
  readonly totalUses: number;
  readonly top: readonly AppUsageSummaryRow[];
  /** The least used commands that anyone used at all - candidates for being hard to find. */
  readonly rare: readonly AppUsageSummaryRow[];
  readonly byKind: Readonly<Record<AppUsageSummaryRow["kind"], number>>;
}

/** What the admin page shows: the most used, the barely used, and which way each is going. */
export function summarizeAppUsage(rows: readonly AppUsageRow[], startDay: string, endDay: string): AppUsageSummary {
  const start = Date.parse(`${startDay}T00:00:00Z`), end = Date.parse(`${endDay}T00:00:00Z`);
  const days = Math.max(1, Math.round((end - start) / 86_400_000));
  const middle = start + (end - start) / 2;
  const by = new Map<string, { uses: number; clientDays: number; newer: number; older: number }>();
  const reportingDays = new Set<string>();
  const byKind = { cmd: 0, page: 0, event: 0, addon: 0 };
  let totalUses = 0;
  for (const row of rows) {
    const at = Date.parse(`${row.day}T00:00:00Z`);
    if (!Number.isFinite(at) || at < start || at >= end) continue;
    reportingDays.add(row.day);
    const entry = by.get(row.name) ?? { uses: 0, clientDays: 0, newer: 0, older: 0 };
    entry.uses += row.uses;
    entry.clientDays += row.clients;
    if (at >= middle) entry.newer += row.uses; else entry.older += row.uses;
    by.set(row.name, entry);
    totalUses += row.uses;
    const kind = row.name.slice(0, row.name.indexOf(":")) as keyof typeof byKind;
    if (kind in byKind) byKind[kind] += row.uses;
  }
  const summary = [...by].map(([name, entry]): AppUsageSummaryRow => {
    const kind = name.slice(0, name.indexOf(":")) as AppUsageSummaryRow["kind"];
    return { name, kind, label: name.slice(name.indexOf(":") + 1), uses: entry.uses, clientDays: entry.clientDays, trend: entry.older === 0 ? null : Math.round(((entry.newer - entry.older) / entry.older) * 100) };
  });
  const sorted = [...summary].sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
  return {
    days,
    reportingDays: reportingDays.size,
    totalUses,
    top: sorted.slice(0, 40),
    rare: sorted.filter((row) => row.kind === "cmd").reverse().slice(0, 20),
    byKind,
  };
}
