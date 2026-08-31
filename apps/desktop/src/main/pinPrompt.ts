/**
 * The one question ADCode asks about itself: would you like it on your taskbar?
 *
 * Split the way `releases.ts` is split. **This file** owns the facts it can see - how many
 * times this install has started, what has already been asked, which platform this is, and
 * whether a dock entry exists to pin. **`pinPromptPolicy.ts`** owns the rule, because
 * "how often may we interrupt somebody" is the part that deserves tests rather than a
 * comment. **The renderer** owns the moment, because only it knows the tour is finished.
 *
 * Why an app cannot simply pin itself is written at the top of `pinPromptPolicy.ts`. The
 * short version: Windows forbids it, macOS would require restarting the user's Dock, and
 * GNOME exposes it as an ordinary per-user setting - so exactly one of the three gets a
 * button that works, and the other two get accurate instructions.
 *
 * The counter is its own file in `userData` rather than a setting, for the reason
 * `onboarding.ts` gives: every setting is a row in the Settings sheet and needs a help
 * entry, and "launches so far" is not a preference anybody wants to find next to their
 * font size. A failed read counts as a fresh install and a failed write costs at most one
 * repeated question - never a crash, and never a card on every launch, because `shownAt`
 * is also held in memory for the life of the process.
 */
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { app, ipcMain } from "electron";
import { CHANNELS, type PinPromptOffer, type PinResult } from "../shared/api.ts";
import {
  decidePinPrompt,
  formatFavorites,
  parseFavorites,
  pinPromptContent,
  withFavorite,
  type PinPromptState,
} from "./pinPromptPolicy.ts";

const run = promisify(execFile);

/** A dock edit is a local setting write. Anything slower than this has gone wrong. */
const GSETTINGS_TIMEOUT_MS = 5_000;

/** The GNOME-derived desktops whose dock reads `org.gnome.shell favorite-apps`. */
const GNOME_DESKTOPS = ["gnome", "unity", "pop", "zorin", "ubuntu"];

interface PinPromptFile {
  readonly launches: number;
  readonly settled: boolean;
  readonly shownAt: readonly number[];
}

const EMPTY: PinPromptFile = { launches: 0, settled: false, shownAt: [] };

function filePath(): string {
  return join(app.getPath("userData"), "pin-prompt.json");
}

async function read(): Promise<PinPromptFile> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath(), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return EMPTY;

    const record = parsed as Record<string, unknown>;
    return {
      launches: typeof record["launches"] === "number" ? record["launches"] : 0,
      settled: record["settled"] === true,
      shownAt: Array.isArray(record["shownAt"])
        ? record["shownAt"].filter((one): one is number => typeof one === "number")
        : [],
    };
  } catch {
    // Missing on a fresh install, which is exactly when the question should be asked.
    return EMPTY;
  }
}

async function write(next: PinPromptFile): Promise<void> {
  try {
    const path = filePath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(next), "utf8");
  } catch {
    // §9: the worst permitted outcome is that a feature quietly does nothing. Here that
    // is one question asked twice, which is a great deal better than a failed launch.
  }
}

/*
 * The live state for this process. `current` is authoritative from the moment `counted`
 * resolves; the disk is a copy of it, written behind. Holding it in memory is what makes
 * "already asked on this launch" true even when the file cannot be written at all.
 */
let current: PinPromptFile = EMPTY;
let counted: Promise<void> = Promise.resolve();

async function countThisLaunch(): Promise<void> {
  const previous = await read();
  current = { ...previous, launches: previous.launches + 1 };
  await write(current);
}

function stateForPolicy(): PinPromptState {
  return { launches: current.launches, settled: current.settled, shownAt: current.shownAt };
}

/* ── The GNOME dock ───────────────────────────────────────────────────── */

/** Data directories a `.desktop` file may have been installed into, most specific first. */
function applicationDirs(): readonly string[] {
  const dirs = [join(homedir(), ".local", "share", "applications")];

  const xdg = process.env["XDG_DATA_DIRS"];
  const roots =
    xdg !== undefined && xdg.length > 0 ? xdg.split(":") : ["/usr/local/share", "/usr/share"];
  for (const root of roots) {
    if (root.length > 0) dirs.push(join(root, "applications"));
  }

  return dirs;
}

/**
 * The name of this app's desktop entry, or null when it has none.
 *
 * A `.deb` install writes one; an AppImage that has never been integrated into the desktop
 * has not, and pinning an entry that does not exist produces a dock icon with a blank
 * square and no way to launch it. So it is checked rather than assumed.
 */
async function desktopEntryId(): Promise<string | null> {
  const candidates = [`${app.getName()}.desktop`, `${app.getName().toLowerCase()}.desktop`];

  for (const dir of applicationDirs()) {
    for (const candidate of candidates) {
      try {
        await access(join(dir, candidate));
        return candidate;
      } catch {
        // Not in this directory. Try the next.
      }
    }
  }

  return null;
}

function isGnomeSession(): boolean {
  const session = (process.env["XDG_CURRENT_DESKTOP"] ?? "").toLowerCase();
  return GNOME_DESKTOPS.some((name) => session.includes(name));
}

/**
 * Add ADCode to the GNOME dock.
 *
 * Never throws: every failure is a sentence the card can show above the manual steps,
 * because "it did not work and here is what to do instead" is the only useful outcome of
 * a button that could not do its job.
 */
async function pinToGnomeDock(): Promise<PinResult> {
  if (process.platform !== "linux") {
    return { ok: false, message: "This can only be done for you on Linux." };
  }

  if (!isGnomeSession()) {
    return { ok: false, message: "Your desktop does not let an app edit its dock." };
  }

  const entry = await desktopEntryId();
  if (entry === null) {
    return {
      ok: false,
      message: "ADCode has no desktop entry to pin - this is normal for a portable AppImage.",
    };
  }

  try {
    // `execFile` with an argument array, never a shell string: nothing here is
    // user-supplied, and it stays that way by construction rather than by care.
    const listed = await run("gsettings", ["get", "org.gnome.shell", "favorite-apps"], {
      timeout: GSETTINGS_TIMEOUT_MS,
    });

    const existing = parseFavorites(listed.stdout);
    const next = withFavorite(existing, entry);

    if (next.length === existing.length) {
      return { ok: true, message: "ADCode is already in your dock." };
    }

    await run("gsettings", ["set", "org.gnome.shell", "favorite-apps", formatFavorites(next)], {
      timeout: GSETTINGS_TIMEOUT_MS,
    });

    return { ok: true, message: "Pinned. ADCode is in your dock." };
  } catch {
    return { ok: false, message: "Your desktop did not accept the change." };
  }
}

/* ── IPC ──────────────────────────────────────────────────────────────── */

export function registerPinPromptIpc(): void {
  counted = countThisLaunch();

  ipcMain.handle(CHANNELS.pinPromptOffer, async (): Promise<PinPromptOffer> => {
    await counted;

    const content = pinPromptContent(process.platform);
    if (content === null) return { ask: false };
    if (!decidePinPrompt(stateForPolicy()).show) return { ask: false };

    /*
     * The button that really pins is offered only where it can really pin. Checking for
     * the desktop entry here rather than after the click means Linux users without one
     * are shown the same honest card Windows gets, instead of a button that apologises.
     */
    const canPin =
      content.pinLabel !== null && isGnomeSession() && (await desktopEntryId()) !== null;

    return {
      ask: true,
      content: {
        title: content.title,
        body: content.body,
        steps: content.steps,
        pinLabel: canPin ? content.pinLabel : null,
        howLabel: content.howLabel,
      },
    };
  });

  /*
   * Recorded when the card is drawn, not when it is answered - the same rule `releases.ts`
   * follows. Somebody who quits with the card on screen has been asked, and asking again
   * on the next launch is the behaviour this counter exists to prevent.
   */
  ipcMain.on(CHANNELS.pinPromptShown, (): void => {
    if (current.shownAt.includes(current.launches)) return;
    current = { ...current, shownAt: [...current.shownAt, current.launches] };
    void write(current);
  });

  ipcMain.handle(CHANNELS.pinPromptSettle, async (): Promise<void> => {
    current = { ...current, settled: true };
    await write(current);
  });

  ipcMain.handle(CHANNELS.pinPromptPin, async (): Promise<PinResult> => {
    const result = await pinToGnomeDock();
    if (result.ok) {
      current = { ...current, settled: true };
      await write(current);
    }
    return result;
  });
}
