/**
 * Filing a bug report, a feature request, or a question.
 *
 * Runs in the main process for the same reason the ad client does: `connect-src 'self'`
 * is part of the CSP, so a renderer cannot reach the backend at all. The renderer's job
 * is the form; this file's job is the round trip.
 *
 * What leaves the machine is exactly what the user typed, plus the app version and the
 * platform. Not the workspace path, not open filenames, not the contents of anything. A
 * bug report is not a licence to read someone's source, and the two fields we do send are
 * the two triage actually asks for first.
 */
import { join } from "node:path";
import { app, ipcMain } from "electron";
import { CHANNELS, type ReportInput, type ReportResult } from "../shared/api.ts";
import { DiskFileStore, FetchHttpTransport, SystemClock } from "./adPorts.ts";
import { apiBaseUrl, createBackendTokens } from "./backend.ts";

const TIMEOUT_MS = 15_000;

/** Mirrors `services/api/src/contract.ts`. Rejected here so the user is told immediately. */
const LIMITS = { title: 120, body: 4000 } as const;

const KINDS: ReadonlySet<string> = new Set(["bug", "feature", "help", "other"]);

export function registerSupportIpc(): void {
  ipcMain.handle(CHANNELS.supportSubmitReport, async (_event, input: ReportInput): Promise<ReportResult> => {
    const title = typeof input?.title === "string" ? input.title.trim() : "";
    const body = typeof input?.body === "string" ? input.body.trim() : "";
    const kind = typeof input?.kind === "string" ? input.kind : "";

    if (!KINDS.has(kind)) return { ok: false, message: "Pick what kind of report this is." };
    if (title.length === 0) return { ok: false, message: "A one-line summary is required." };
    if (title.length > LIMITS.title) {
      return { ok: false, message: `Keep the summary under ${LIMITS.title} characters.` };
    }
    if (body.length === 0) return { ok: false, message: "Describe what happened." };
    if (body.length > LIMITS.body) {
      return { ok: false, message: `Keep the description under ${LIMITS.body} characters.` };
    }

    try {
      const clock = new SystemClock();
      const store = new DiskFileStore(join(app.getPath("userData"), "ads"));
      const http = new FetchHttpTransport([]);
      const tokens = createBackendTokens({ http, clock, store });

      const token = await tokens.getToken();
      if (!token.ok) return { ok: false, message: "Could not sign in to send this. Try again shortly." };

      const response = await fetch(`${apiBaseUrl()}/reports`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token.value}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind,
          title,
          body,
          appVersion: app.getVersion(),
          platform: process.platform,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.status === 429) {
        return { ok: false, message: "Too many reports just now. Try again in a minute." };
      }
      if (!response.ok) {
        return { ok: false, message: "The server would not accept it. Try again shortly." };
      }

      const parsed = (await response.json()) as { reportId?: unknown };
      const reportId = typeof parsed.reportId === "string" ? parsed.reportId : null;

      return reportId === null
        ? { ok: false, message: "The server gave an answer we did not understand." }
        : { ok: true, reportId };
    } catch {
      // Offline is the common case here and it is not the user's fault, so it gets a
      // sentence that says what to do rather than an error code.
      return { ok: false, message: "Could not reach the server. Check your connection." };
    }
  });
}
