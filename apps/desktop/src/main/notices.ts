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
import { app, BrowserWindow } from "electron";
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

/** The server is untrusted here exactly as it is for creatives. */
function validate(raw: unknown): ServiceNotice | null {
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

  return { noticeId: id, severity, title, body };
}

async function fetchNotices(): Promise<ServiceNotice[]> {
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
    .filter((n): n is ServiceNotice => n !== null)
    .slice(0, MAX_NOTICES);
}

export function startNoticePolling(): void {
  const poll = async (): Promise<void> => {
    try {
      const notices = await fetchNotices();
      if (notices.length === 0) return;

      const seen = await readSeen();
      const fresh = notices.filter((n) => !seen.has(n.noticeId));
      if (fresh.length === 0) return;

      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(CHANNELS.serviceNotice, fresh);
      }

      for (const notice of fresh) seen.add(notice.noticeId);
      await writeSeen(seen);
    } catch {
      // Silent, deliberately. See the note at the top of this file.
    }
  };

  setTimeout(() => void poll(), FIRST_POLL_DELAY_MS);
  setInterval(() => void poll(), POLL_INTERVAL_MS);
}
