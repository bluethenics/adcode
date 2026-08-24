/**
 * Release notes, from the people who ship ADCode to the people running it.
 *
 * This is the only thing in the editor allowed to open a window somebody did not ask for,
 * so the rules around it are strict and they live in `@adcode/release` where they can be
 * tested exhaustively rather than in a comment here.
 *
 * The division of labour matters. **Main** owns the facts it can see: what has been
 * published, what version this build is, and which versions this machine has already been
 * shown - the last of those on disk, so it survives a restart. **The window** owns the
 * decision, because the renderer is the only side that knows whether the user is halfway
 * through a word. Main never sends a "show this now"; it sends what it knows.
 *
 * The seen file is written the moment a note is displayed rather than when it is
 * dismissed. Somebody who force-quits ADCode while the note is up has still seen it, and
 * replaying it would be exactly the behaviour this whole module exists to prevent.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { parseReleaseList } from "@adcode/release";
import { CHANNELS, type ReleaseAnnouncement, type ReleaseNote } from "../shared/api.ts";
import { apiBaseUrl } from "./backend.ts";

const FIRST_POLL_DELAY_MS = 25_000;
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;

/** Bounded so the file cannot grow without limit over years of releases. */
const MAX_REMEMBERED = 200;

interface SeenFile {
  readonly versions: readonly string[];
  /** Written on the first successful poll. Its presence is what "has run before" means. */
  readonly since: number;
}

function seenPath(): string {
  return join(app.getPath("userData"), "releases", "seen.json");
}

async function readSeen(): Promise<SeenFile | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(seenPath(), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;

    const record = parsed as Record<string, unknown>;
    const versions = Array.isArray(record["versions"])
      ? record["versions"].filter((one): one is string => typeof one === "string")
      : [];
    const since = typeof record["since"] === "number" ? record["since"] : Date.now();

    return { versions, since };
  } catch {
    // No file yet is the normal case on a first run, and a corrupt one is treated the
    // same way: the worst outcome is one note shown a second time.
    return null;
  }
}

async function writeSeen(file: SeenFile): Promise<void> {
  try {
    const path = seenPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({ versions: file.versions.slice(-MAX_REMEMBERED), since: file.since }),
      "utf8",
    );
  } catch {
    // A note shown twice is a much smaller problem than a crash on startup.
  }
}

/**
 * The published notes.
 *
 * No authentication: this is the same list the marketing site renders, and requiring a
 * token would mean a user who is not signed in never learns about a security fix.
 */
async function fetchReleases(): Promise<ReleaseNote[]> {
  const response = await fetch(`${apiBaseUrl()}/releases`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) return [];

  const parsed = (await response.json()) as { releases?: unknown };
  return parseReleaseList(parsed.releases);
}

let latest: readonly ReleaseNote[] = [];

async function announcementFrom(releases: readonly ReleaseNote[]): Promise<ReleaseAnnouncement> {
  const seen = await readSeen();
  return {
    releases,
    currentVersion: app.getVersion(),
    seenVersions: seen?.versions ?? [],
    hasRunBefore: seen !== null,
  };
}

async function markSeen(versions: readonly string[]): Promise<void> {
  const existing = await readSeen();
  const merged = new Set([...(existing?.versions ?? []), ...versions]);
  await writeSeen({ versions: [...merged], since: existing?.since ?? Date.now() });
}

export function startReleasePolling(): void {
  /*
   * `list` and `markSeen` are registered immediately rather than after the first poll, so
   * the Help menu's What's New entry works on a machine that has never reached the server.
   * It shows an empty list, which is honest, instead of failing on a missing handler.
   */
  ipcMain.handle(CHANNELS.releaseList, async (): Promise<ReleaseAnnouncement> => {
    if (latest.length === 0) {
      try {
        latest = await fetchReleases();
      } catch {
        // An empty What's New window beats an error dialog nobody asked to see.
      }
    }
    return announcementFrom(latest);
  });

  ipcMain.handle(CHANNELS.releaseMarkSeen, async (_event, raw: unknown): Promise<void> => {
    const versions = Array.isArray(raw)
      ? raw.filter((one): one is string => typeof one === "string")
      : [];
    if (versions.length > 0) await markSeen(versions);
  });

  const poll = async (): Promise<void> => {
    try {
      const releases = await fetchReleases();
      if (releases.length === 0) return;
      latest = releases;

      const announcement = await announcementFrom(releases);

      /*
       * A machine that has never run this before is quietly caught up: every note that
       * already existed is written off as seen, and nothing is shown. Everything is new
       * to somebody who just installed it, so the notes are for the *next* release.
       */
      if (!announcement.hasRunBefore) {
        await writeSeen({
          versions: releases.map((release) => release.version),
          since: Date.now(),
        });
        return;
      }

      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send(CHANNELS.releaseAnnouncement, announcement);
        }
      }
    } catch {
      // Silent, like the notice poller. A release note is never worth an error dialog.
    }
  };

  setTimeout(() => void poll(), FIRST_POLL_DELAY_MS);
  setInterval(() => void poll(), POLL_INTERVAL_MS);
}
