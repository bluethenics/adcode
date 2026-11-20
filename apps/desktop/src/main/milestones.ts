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
 * Since 2.6.3 the same queue and the same request carry retention events - the funnel and
 * friction in `@adcode/retention` (first launch, first project, failed turns and why, limit
 * screens, crashes, how each session ended). Those go only while Help improve ADCode
 * (`adcode.privacy.usageStats`) is on; switching it off deletes any not yet sent. Every
 * event passes `LaunchBudget.admit`, which drops anything that is not a fixed name with a
 * fixed code, so no prompt, path, file or message can ride along.
 *
 * §9 governs every failure: the worst outcome is that a milestone is not counted.
 */
import { renameSync, writeFileSync } from "node:fs";
import { readFile, writeFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, ipcMain } from "electron";
import { LaunchBudget, MAX_EVENTS_PER_REQUEST, MAX_PENDING_EVENTS, VERSION, sanitizeEvent, type RetentionEvent, type RetentionEventName } from "@adcode/retention";
import { CHANNELS } from "../shared/api.ts";
import { isMilestone, newcomerHold, type FirstRunState, type MilestoneName } from "../shared/milestones.ts";
import { USAGE_SETTING } from "./appUsage.ts";
import { currentSettings, loadSettings, onSettingsChanged } from "./settings.ts";
import { onWorkspaceRootChanged } from "./workspace.ts";
import { DiskFileStore, FetchHttpTransport, SystemClock } from "./adPorts.ts";
import { apiBaseUrl, createBackendTokens } from "./backend.ts";
import { noteBuildPreview } from "./referrals.ts";

const FLUSH_DELAY_MS = 3_000;
const RETRY_MS = 60_000;
const TIMEOUT_MS = 10_000;
/** A machine offline for weeks keeps the earliest of these and drops the rest. */
const MAX_PENDING = 40;

/** The session in progress, kept on disk so the next launch knows whether this one quit. */
interface SessionMark {
  startedAt: number;
  beatAt: number;
  ended: boolean;
}

type MilestoneFile = { -readonly [K in keyof FirstRunState]: FirstRunState[K] } & {
  pending: { name: MilestoneName; at: number }[];
  /** Retention events not sent yet. */
  events: RetentionEvent[];
  /** Whether this install's first launch has been reported (or predates retention). */
  firstLaunchSent: boolean;
  session: SessionMark | null;
};

/** How often the session mark is refreshed, which bounds how wrong an unclean end's time is. */
const HEARTBEAT_MS = 5 * 60_000;

/**
 * Settings load after this module starts. Until they have, nobody knows whether the person
 * opted out, so events wait in memory (`early`) and nothing queued is sent or deleted.
 */
let settingsReady = false;
const early: [RetentionEventName, { code?: string; ms?: number; at: number }][] = [];
const retentionOn = (): boolean => settingsReady && currentSettings()[USAGE_SETTING] !== false;
const budget = new LaunchBudget();
let quittingForUpdate = false;

function sessionMark(raw: unknown): SessionMark | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { startedAt, beatAt, ended } = raw as Record<string, unknown>;
  return typeof startedAt === "number" && typeof beatAt === "number" && typeof ended === "boolean" ? { startedAt, beatAt, ended } : null;
}

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
        events: Array.isArray(parsed.events)
          ? parsed.events.map(sanitizeEvent).filter((event): event is RetentionEvent => event !== null).slice(0, MAX_PENDING_EVENTS)
          : [],
        // A file from before 2.6.3 belongs to an install whose first launch was long ago.
        firstLaunchSent: typeof parsed.firstLaunchSent === "boolean" ? parsed.firstLaunchSent : true,
        session: sessionMark(parsed.session),
      };
    } catch {
      const now = Date.now();
      const welcomedBefore = await stat(join(app.getPath("userData"), "onboarding.json")).then(() => true, () => false);
      state = { firstLaunchAt: now, firstValueAt: welcomedBefore ? now : null, pending: [], events: [], firstLaunchSent: welcomedBefore, session: null };
      await save();
    }
    return state;
  })();
  return loading;
}

let saveQueue: Promise<void> = Promise.resolve();
let saveCount = 0;

/**
 * Write the file: queued, and renamed into place.
 *
 * A plain write truncates first, so a second save, a reader or a crash between the two
 * halves could see half a file. The test that reads this file right after a flush caught
 * exactly that, and a torn file at the next launch reads as a brand-new install - which
 * costs `firstValueAt` and re-sends `first_launch`. Each save goes to its own temporary
 * name and is renamed over the file, so a reader sees the old file or the new one, never
 * half of either.
 */
function save(): Promise<void> {
  if (state === null) return Promise.resolve();
  const file = filePath();
  const temporary = `${file}.${Date.now().toString(36)}-${++saveCount}.tmp`;
  saveQueue = saveQueue.then(async () => {
    try {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(temporary, JSON.stringify(state), "utf8");
      await rename(temporary, file);
    } catch {
      // Unsaved is unsent-after-a-crash, nothing worse.
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  });
  return saveQueue;
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
  if (settingsReady && !retentionOn()) current.events = [];
  const events = retentionOn() ? current.events.slice(0, MAX_EVENTS_PER_REQUEST) : [];
  if (current.pending.length === 0 && events.length === 0) return;
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
      body: JSON.stringify({ ...(batch.length > 0 ? { milestones: batch } : {}), ...(events.length > 0 ? { events } : {}) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // A 400 will never be accepted - an older service that does not know a name. Retrying
    // forever would block every milestone behind it.
    if (!response.ok && response.status !== 400) throw new Error(`HTTP ${response.status}`);
    current.pending = current.pending.filter((item) => !batch.includes(item));
    current.events = current.events.filter((event) => !events.includes(event));
    await save();
    if (current.events.length > 0) scheduleFlush(FLUSH_DELAY_MS);
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
    // Something ADCode built is on screen: the one moment worth mentioning the invite link.
    if (name === "preview_opened") noteBuildPreview(current.firstValueAt);
    if (name === "preview_opened") recordRetention("preview_opened");
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

/**
 * Note a retention event. Fire-and-forget; dropped while Help improve ADCode is off, past
 * this launch's budget, or when it is not exactly a retention event.
 */
export function recordRetention(name: RetentionEventName, extra: { readonly code?: string; readonly ms?: number; readonly at?: number } = {}): void {
  if (!settingsReady) {
    if (early.length < 50) early.push([name, { ...extra, at: extra.at ?? Date.now() }]);
    return;
  }
  if (!retentionOn()) return;
  const event = budget.admit({
    name,
    at: extra.at ?? Date.now(),
    ...(extra.code === undefined ? {} : { code: extra.code }),
    ...(extra.ms === undefined ? {} : { ms: extra.ms }),
  });
  if (event === null) return;
  void (async () => {
    const current = await load();
    if (current.events.length < MAX_PENDING_EVENTS) current.events.push(event);
    await save();
    scheduleFlush(FLUSH_DELAY_MS);
  })().catch(() => undefined);
}

/** The updater is about to quit the app to install: this session ends as an update, not a quit. */
export function noteQuittingForUpdate(): void {
  quittingForUpdate = true;
}

/** Events the window may report: the screens it shows. Everything else is noted here, in main. */
const FROM_WINDOW: ReadonlySet<string> = new Set(["sign_in_needed", "limit_reached"]);

/**
 * A launch: how the last session ended, whether this is the first launch ever, the version
 * and the day. Then a heartbeat, so a crash's end time is never more than five minutes off.
 */
async function startSession(): Promise<void> {
  await loadSettings().catch(() => undefined);
  settingsReady = true;
  const current = await load();
  if (!retentionOn()) current.events = [];
  for (const [name, extra] of early.splice(0)) recordRetention(name, extra);
  const now = Date.now();
  const previous = current.session;
  if (previous !== null && !previous.ended) {
    recordRetention("session_end", { code: "unclean", ms: Math.max(0, previous.beatAt - previous.startedAt), at: previous.beatAt });
  }
  if (!current.firstLaunchSent) {
    current.firstLaunchSent = true;
    recordRetention("first_launch", { at: current.firstLaunchAt });
  }
  const version = app.getVersion();
  recordRetention("session_start", VERSION.test(version) ? { code: version } : {});
  recordRetention("day_active");
  current.session = { startedAt: now, beatAt: now, ended: false };
  await save();
  setInterval(() => {
    if (state?.session) state.session.beatAt = Date.now();
    void save();
    recordRetention("day_active");
  }, HEARTBEAT_MS).unref?.();
}

export function registerMilestoneIpc(): void {
  ipcMain.on(CHANNELS.milestoneRecord, (_event, name: unknown) => {
    if (isMilestone(name)) recordMilestone(name);
  });
  ipcMain.on(CHANNELS.retentionRecord, (_event, name: unknown, code: unknown) => {
    if (typeof name === "string" && FROM_WINDOW.has(name)) recordRetention(name as RetentionEventName, typeof code === "string" ? { code } : {});
  });
  // Off means off: what was noted and not sent is deleted at once.
  onSettingsChanged((values) => {
    if (values[USAGE_SETTING] !== false || state === null) return;
    state.events = [];
    void save();
  });
  onWorkspaceRootChanged((root) => {
    if (root !== null) recordRetention("project_opened");
  });
  app.on("render-process-gone", (_event, _contents, details) => {
    if (details.reason !== "clean-exit") recordRetention("renderer_gone", { code: details.reason });
  });
  app.on("child-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;
    if (details.type === "GPU") recordRetention("crash", { code: "gpu_gone" });
    else if (details.type === "Utility") recordRetention("crash", { code: "utility_gone" });
  });
  process.on("uncaughtException", () => recordRetention("crash", { code: "main_exception" }));
  // Written synchronously: the app exits before an async write or a request would finish,
  // and what is on disk is sent next launch.
  app.on("will-quit", () => {
    if (state === null) return;
    const now = Date.now();
    if (state.session !== null && !state.session.ended) {
      if (retentionOn()) {
        const event = budget.admit({ name: "session_end", at: now, code: quittingForUpdate ? "update" : "quit", ms: now - state.session.startedAt });
        if (event !== null && state.events.length < MAX_PENDING_EVENTS) state.events.push(event);
      }
      state.session = { ...state.session, beatAt: now, ended: true };
    }
    const file = filePath();
    const temporary = `${file}.quit.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(state), "utf8");
      renameSync(temporary, file);
    } catch {
      // §9.
    }
  });
  // Anything a previous launch could not send goes now.
  void load().then(() => scheduleFlush(FLUSH_DELAY_MS));
  void startSession().catch(() => undefined);
}

/** When this install first had an assistant turn that worked, or null if it never has. */
export async function firstValueAt(): Promise<number | null> {
  return (await load()).firstValueAt;
}
