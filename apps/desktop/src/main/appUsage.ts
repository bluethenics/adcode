/**
 * "Help improve ADCode": daily counts of which features are used, so the team learns what to
 * improve and what nobody finds.
 *
 * The window reports fixed names - `cmd:` a command id, `page:` a page, `event:` a product
 * event, `addon:` a plugin add-on from the directory - and this keeps a count per name per
 * UTC day on disk. Once a day, every finished day is sent as one report and forgotten. A name
 * that is not in that shape is never counted, so nothing a person typed can travel this way.
 *
 * Turning the setting off stops counting and deletes what was not sent yet. Failure is silent
 * and bounded: a day not delivered within three days is dropped, never retried for ever.
 */
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, ipcMain } from "electron";
import { CHANNELS } from "../shared/api.ts";
import { DiskFileStore, FetchHttpTransport, SystemClock } from "./adPorts.ts";
import { apiBaseUrl, createBackendTokens } from "./backend.ts";
import { currentSettings, onSettingsChanged } from "./settings.ts";

export const USAGE_SETTING = "adcode.privacy.usageStats";
/** The same shape the service accepts (services/api/src/appUsage.ts). */
const NAME = /^(?:cmd|page|event|addon):[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const MAX_NAMES_PER_DAY = 400;
const MAX_COUNT = 100_000;
const KEEP_DAYS = 3;
const SAVE_DELAY_MS = 5_000;
const FLUSH_EVERY_MS = 6 * 60 * 60_000;

type Days = Record<string, Record<string, number>>;

const filePath = (): string => join(app.getPath("userData"), "app-usage.json");
const utcDay = (at: number): string => new Date(at).toISOString().slice(0, 10);

let days: Days | null = null;
let saveTimer: NodeJS.Timeout | null = null;
let flushing = false;

const enabled = (): boolean => currentSettings()[USAGE_SETTING] !== false;

async function load(): Promise<Days> {
  if (days !== null) return days;
  try {
    const parsed = JSON.parse(await readFile(filePath(), "utf8")) as unknown;
    days = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Days : {};
  } catch {
    days = {};
  }
  return days;
}

function scheduleSave(): void {
  if (saveTimer !== null) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void (async () => {
      await mkdir(dirname(filePath()), { recursive: true });
      await writeFile(filePath(), JSON.stringify(days ?? {}));
    })().catch(() => undefined);
  }, SAVE_DELAY_MS);
  saveTimer.unref?.();
}

/** Count one use. Fire-and-forget; anything that is not a fixed name is ignored. */
export function recordUsage(name: unknown): void {
  if (typeof name !== "string" || !NAME.test(name) || !enabled()) return;
  void load().then((all) => {
    const day = utcDay(Date.now());
    const counts = all[day] ?? (all[day] = {});
    if (!(name in counts) && Object.keys(counts).length >= MAX_NAMES_PER_DAY) return;
    counts[name] = Math.min(MAX_COUNT, (counts[name] ?? 0) + 1);
    scheduleSave();
  }).catch(() => undefined);
}

/** Send every finished day, oldest first; forget what was delivered or is too old to send. */
async function flush(): Promise<void> {
  if (flushing || !enabled()) return;
  flushing = true;
  try {
    const all = await load();
    const today = utcDay(Date.now());
    const oldest = utcDay(Date.now() - KEEP_DAYS * 86_400_000);
    const tokens = createBackendTokens({ http: new FetchHttpTransport([]), clock: new SystemClock(), store: new DiskFileStore(join(app.getPath("userData"), "ads")) });
    for (const day of Object.keys(all).sort()) {
      if (day >= today) continue;
      if (day < oldest || Object.keys(all[day]!).length === 0) { delete all[day]; continue; }
      const token = await tokens.getToken();
      if (!token.ok) break;
      const response = await fetch(`${apiBaseUrl()}/app-usage`, {
        method: "POST",
        headers: { authorization: `Bearer ${token.value}`, "content-type": "application/json" },
        body: JSON.stringify({ day, counts: all[day] }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
      if (response === null) break;
      // Delivered, or refused for good (malformed, rate-limited for the day): either way, done with it.
      if (response.ok || response.status === 400 || response.status === 429) delete all[day];
      else break;
    }
    scheduleSave();
  } catch {
    // Silent: the next flush tries again, and days past the window fall away.
  } finally {
    flushing = false;
  }
}

export function registerAppUsage(): void {
  ipcMain.on(CHANNELS.appUsageRecord, (_event, name: unknown) => recordUsage(name));
  // Off means off: what was counted and not sent is deleted at once.
  onSettingsChanged((values) => {
    if (values[USAGE_SETTING] !== false) return;
    days = {};
    void rm(filePath(), { force: true }).catch(() => undefined);
  });
  setTimeout(() => void flush(), 60_000).unref?.();
  setInterval(() => void flush(), FLUSH_EVERY_MS).unref?.();
}
