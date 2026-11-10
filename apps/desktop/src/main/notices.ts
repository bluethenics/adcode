/**
 * Service notices, from the operators to everyone running the editor.
 *
 * This exists because `packages/ads` is required to fail silently (§9): when serving
 * breaks, the client shows nothing, which is right for a blip and wrong for an outage
 * people are already wondering about. This is the deliberate exception - a human wrote
 * the message and chose to send it. Nothing here ever fires automatically off an error.
 *
 * Two rules keep it from becoming nagware:
 *
 *   A notice is shown once per machine, ever. Dismissed ids are remembered on disk, so
 *   restarting the editor does not replay it.
 *
 *   Failure is silent. If the poll fails, there is no notice - the same rule the ad
 *   client follows, for the same reason.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { CHANNELS, type ServiceNotice } from "../shared/api.ts";
import { apiBaseUrl, createBackendTokens } from "./backend.ts";
import { DiskFileStore, FetchHttpTransport, SystemClock } from "./adPorts.ts";

const FIRST_POLL_DELAY_MS = 20_000;
const POLL_INTERVAL_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 10_000;

/** Bounded so a compromised or buggy server cannot paste an essay into the corner. */
const MAX_TITLE = 100;
const MAX_BODY = 500;
const MAX_NOTICES = 3;
const MAX_URL = 500;
const MAX_BUTTONS = 2;
const MAX_LABEL = 30;
const MAX_ALT = 200;

/** Every button link of the notices this session was sent, by notice id. Never leaves this process. */
const buttonLinks = new Map<string, string[]>();

/** An https address with a host, or null: the only kind of link or image a notice may carry. */
export function httpsOnly(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.includes(".") && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function seenPath(): string {
  return join(app.getPath("userData"), "notices", "seen.json");
}

async function readSeen(): Promise<Set<string>> {
  try {
    const raw = await readFile(seenPath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

async function writeSeen(seen: ReadonlySet<string>): Promise<void> {
  try {
    const path = seenPath();
    await mkdir(dirname(path), { recursive: true });
    // Keep the file from growing forever; the newest ids are the ones that matter.
    await writeFile(path, JSON.stringify([...seen].slice(-200)), "utf8");
  } catch {
    // A notice shown twice is a far smaller problem than a crash on startup.
  }
}

/** A notice as the window may see it, plus the links only this process keeps. */
export interface ValidNotice {
  readonly notice: ServiceNotice;
  readonly links: readonly string[];
}

/** The server is untrusted here exactly as it is for creatives. */
export function validate(raw: unknown): ValidNotice | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const id = r["noticeId"];
  const severity = r["severity"];
  const title = r["title"];
  const body = r["body"];

  if (typeof id !== "string" || id.length === 0 || id.length > 64) return null;
  if (severity !== "info" && severity !== "warning") return null;
  if (typeof title !== "string" || title.length === 0 || title.length > MAX_TITLE) return null;
  if (typeof body !== "string" || body.length === 0 || body.length > MAX_BODY) return null;

  // Extras degrade rather than reject: a notice about an outage still matters with its
  // image or a malformed button dropped.
  const imageUrl = r["imageUrl"] === undefined ? null : httpsOnly(r["imageUrl"]);
  const imageAlt = typeof r["imageAlt"] === "string" ? r["imageAlt"].slice(0, MAX_ALT) : "";
  const labels: string[] = [];
  const links: string[] = [];
  if (Array.isArray(r["buttons"])) {
    for (const button of r["buttons"].slice(0, MAX_BUTTONS)) {
      if (typeof button !== "object" || button === null) continue;
      const label = (button as Record<string, unknown>)["label"];
      const url = httpsOnly((button as Record<string, unknown>)["url"]);
      if (typeof label !== "string" || label.trim().length === 0 || label.length > MAX_LABEL || url === null) continue;
      labels.push(label.trim());
      links.push(url);
    }
  }

  return {
    notice: {
      noticeId: id, severity, title, body,
      ...(imageUrl === null ? {} : { imageUrl, imageAlt }),
      ...(labels.length === 0 ? {} : { buttons: labels }),
    },
    links,
  };
}

async function fetchNotices(): Promise<ValidNotice[]> {
  const clock = new SystemClock();
  const store = new DiskFileStore(join(app.getPath("userData"), "ads"));
  const http = new FetchHttpTransport([]);
  const tokens = createBackendTokens({ http, clock, store });

  const token = await tokens.getToken();
  if (!token.ok) return [];

  const response = await fetch(`${apiBaseUrl()}/notices`, {
    headers: { authorization: `Bearer ${token.value}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) return [];

  const parsed = (await response.json()) as { notices?: unknown };
  if (!Array.isArray(parsed.notices)) return [];

  return parsed.notices
    .map(validate)
    .filter((n): n is ValidNotice => n !== null)
    .slice(0, MAX_NOTICES);
}

export function startNoticePolling(): void {
  // The window names a notice and a button; the link comes from what this process validated.
  ipcMain.handle(CHANNELS.noticeOpen, async (_event, noticeId: unknown, button: unknown) => {
    if (typeof noticeId !== "string" || typeof button !== "number" || !Number.isInteger(button)) return;
    const url = buttonLinks.get(noticeId)?.[button];
    if (url !== undefined) await shell.openExternal(url);
  });

  const poll = async (): Promise<void> => {
    try {
      const notices = await fetchNotices();
      if (notices.length === 0) return;

      const seen = await readSeen();
      const fresh = notices.filter((n) => !seen.has(n.notice.noticeId));
      if (fresh.length === 0) return;

      for (const { notice, links } of fresh) if (links.length > 0) buttonLinks.set(notice.noticeId, [...links]);
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(CHANNELS.serviceNotice, fresh.map((n) => n.notice));
      }

      for (const { notice } of fresh) seen.add(notice.noticeId);
      await writeSeen(seen);
    } catch {
      // Silent, deliberately. See the note at the top of this file.
    }
  };

  setTimeout(() => void poll(), FIRST_POLL_DELAY_MS);
  setInterval(() => void poll(), POLL_INTERVAL_MS);
}
