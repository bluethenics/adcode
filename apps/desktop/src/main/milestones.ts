/**
 * Reporting how far a first session got - and remembering when this install first worked.
 *
 * The activity reporter flushes every five minutes, and 394 of the first 419 installs were
 * gone in under five, so the people whose first session went wrong were exactly the ones
 * nothing ever heard from. Milestones go a few seconds after they happen instead, and wait
 * on disk if the network is down, so a session that ends early still says how far it got.
 *
 * What leaves the machine is a fixed word and a time - see `shared/milestones.ts`. Each
 * name is sent at most once per launch: enough for "did this person ever send a prompt"
 * and "did they come back", and nowhere near a keystroke log.
 *
 * It also keeps `firstValueAt`, the first assistant turn that worked. `newcomerHold` reads
 * it to keep ads out of the minutes before ADCode has done anything for the person.
 *
 * §9 governs every failure: the worst outcome is that a milestone is not counted.
 */
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, ipcMain } from "electron";
import { CHANNELS } from "../shared/api.ts";
import { isMilestone, newcomerHold, type FirstRunState, type MilestoneName } from "../shared/milestones.ts";
import { DiskFileStore, FetchHttpTransport, SystemClock } from "./adPorts.ts";
import { apiBaseUrl, createBackendTokens } from "./backend.ts";

const FLUSH_DELAY_MS = 3_000;
const RETRY_MS = 60_000;
const TIMEOUT_MS = 10_000;
/** A machine offline for weeks keeps the earliest of these and drops the rest. */
const MAX_PENDING = 40;

type MilestoneFile = { -readonly [K in keyof FirstRunState]: FirstRunState[K] } & {
  pending: { name: MilestoneName; at: number }[];
};

const filePath = (): string => join(app.getPath("userData"), "milestones.json");

let state: MilestoneFile | null = null;
let loading: Promise<MilestoneFile> | null = null;
const sentThisLaunch = new Set<MilestoneName>();
let flushTimer: NodeJS.Timeout | null = null;
let flushing = false;

/**
 * Read the file, or start it.
 *
 * An install that was already welcomed before this version shipped is not a newcomer: it
 * starts with `firstValueAt` set, so an update never takes a returning person's ads away for
 * a quarter of an hour while it decides whether they have had a good day.
 */
function load(): Promise<MilestoneFile> {
  if (state !== null) return Promise.resolve(state);
  loading ??= (async () => {
    try {
      const parsed = JSON.parse(await readFile(filePath(), "utf8")) as Partial<MilestoneFile>;
      const now = Date.now();
      state = {
        firstLaunchAt: typeof parsed.firstLaunchAt === "number" ? parsed.firstLaunchAt : now,
        firstValueAt: typeof parsed.firstValueAt === "number" ? parsed.firstValueAt : null,
        pending: Array.isArray(parsed.pending)
          ? parsed.pending.filter((item) => isMilestone(item?.name) && typeof item?.at === "number").slice(0, MAX_PENDING)
          : [],
      };
    } catch {
      const now = Date.now();
      const welcomedBefore = await stat(join(app.getPath("userData"), "onboarding.json")).then(() => true, () => false);
      state = { firstLaunchAt: now, firstValueAt: welcomedBefore ? now : null, pending: [] };
      await save();
    }
    return state;
  })();
  return loading;
}

async function save(): Promise<void> {
  if (state === null) return;
  try {
    await mkdir(dirname(filePath()), { recursive: true });
    await writeFile(filePath(), JSON.stringify(state), "utf8");
  } catch {
    // Unsaved is unsent-after-a-crash, nothing worse.
  }
}

function scheduleFlush(delay: number): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, delay);
  flushTimer.unref?.();
}

async function flush(): Promise<void> {
  if (flushing) return;
  const current = await load();
  if (current.pending.length === 0) return;
  flushing = true;
  const batch = current.pending.slice(0, MAX_PENDING);
  try {
    const clock = new SystemClock();
    const tokens = createBackendTokens({
      http: new FetchHttpTransport([]),
      clock,
      store: new DiskFileStore(join(app.getPath("userData"), "ads")),
    });
    const token = await tokens.getToken();
    if (!token.ok) throw new Error("no token");
    const response = await fetch(`${apiBaseUrl()}/milestones`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.value}`, "content-type": "application/json" },
      body: JSON.stringify({ milestones: batch }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // A 400 will never be accepted - an older service that does not know a name. Retrying
    // forever would block every milestone behind it.
    if (!response.ok && response.status !== 400) throw new Error(`HTTP ${response.status}`);
    current.pending = current.pending.filter((item) => !batch.includes(item));
    await save();
  } catch {
    scheduleFlush(RETRY_MS);
  } finally {
    flushing = false;
  }
}

/** Note a milestone. Fire-and-forget; repeats within one launch are ignored. */
export function recordMilestone(name: MilestoneName): void {
  if (sentThisLaunch.has(name)) return;
  sentThisLaunch.add(name);
  void (async () => {
    const current = await load();
    const at = Date.now();
    if (current.pending.length < MAX_PENDING) current.pending.push({ name, at });
    if (name === "turn_ok" && current.firstValueAt === null) current.firstValueAt = at;
    await save();
    scheduleFlush(FLUSH_DELAY_MS);
  })().catch(() => undefined);
}

/**
 * Whether ads should wait for this install's first success. Synchronous, for the ad
 * scheduler's tick: before the file has been read it answers "hold", which costs at most
 * the first tick of a launch.
 */
export function adsHeldForNewcomer(now: number): boolean {
  if (state === null) {
    void load();
    return true;
  }
  return newcomerHold(state, now);
}

export function registerMilestoneIpc(): void {
  ipcMain.on(CHANNELS.milestoneRecord, (_event, name: unknown) => {
    if (isMilestone(name)) recordMilestone(name);
  });
  // Anything a previous launch could not send goes now.
  void load().then(() => scheduleFlush(FLUSH_DELAY_MS));
}
