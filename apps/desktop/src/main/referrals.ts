/**
 * Invites, wired to Electron: the real clipboard, this install's identity, and a small
 * file in `userData`. Every rule is in `referralClient.ts`.
 *
 * The clipboard is read here, in main, and only when the renderer asks - the welcome
 * opening, the window coming back into focus while it is open, or the Invite panel. The
 * text never crosses into the renderer and never leaves the machine unless it is exactly an
 * invite line or link.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, clipboard, ipcMain, shell } from "electron";
import { formatMicros, micros } from "@adcode/ads";
import { CHANNELS } from "../shared/api.ts";
import { DiskFileStore, FetchHttpTransport, SystemClock } from "./adPorts.ts";
import { apiBaseUrl, backendAccount, createBackendTokens } from "./backend.ts";
import { createReferralClient, EMPTY_REFERRAL_STATE, type ReferralClient, type ReferralLocalState } from "./referralClient.ts";

const filePath = (): string => join(app.getPath("userData"), "referrals.json");

let client: ReferralClient | null = null;

function referralClient(): ReferralClient {
  if (client !== null) return client;
  const deps = {
    http: new FetchHttpTransport([]),
    clock: new SystemClock(),
    store: new DiskFileStore(join(app.getPath("userData"), "ads")),
  };
  const tokens = createBackendTokens(deps);
  client = createReferralClient({
    apiBaseUrl,
    token: async () => {
      const token = await tokens.getToken();
      return token.ok ? token.value : null;
    },
    currentUid: () => backendAccount(deps)?.uid() ?? null,
    readClipboard: () => clipboard.readText(),
    load: async () => {
      try {
        const parsed = JSON.parse(await readFile(filePath(), "utf8")) as Partial<ReferralLocalState>;
        return {
          heldUids: Array.isArray(parsed.heldUids) ? parsed.heldUids.filter((u): u is string => typeof u === "string") : [],
          tried: Array.isArray(parsed.tried) ? parsed.tried.filter((c): c is string => typeof c === "string") : [],
          done: parsed.done === true,
        };
      } catch {
        return { ...EMPTY_REFERRAL_STATE };
      }
    },
    save: async (state) => {
      try {
        await mkdir(dirname(filePath()), { recursive: true });
        await writeFile(filePath(), JSON.stringify(state), "utf8");
      } catch {
        // Unsaved means a code may be tried once more next launch. Nothing worse.
      }
    },
    fetch: (input, init) => fetch(input, init),
    format: (value) => formatMicros(micros(value)),
    openExternal: (url) => shell.openExternal(url),
  });
  return client;
}

export function registerReferralIpc(): void {
  ipcMain.handle(CHANNELS.referralsGet, () => referralClient().get());
  ipcMain.handle(CHANNELS.referralsClaim, (_event, text: unknown) =>
    typeof text === "string" ? referralClient().claim(text) : { ok: false, error: "invalid" },
  );
  ipcMain.handle(CHANNELS.referralsCheckClipboard, () => referralClient().checkClipboard());
  ipcMain.handle(CHANNELS.referralsSetShowName, (_event, show: unknown) =>
    typeof show === "boolean" ? referralClient().setShowName(show) : null,
  );
  ipcMain.handle(CHANNELS.referralsShare, (_event, target: unknown) =>
    target === "x" || target === "threads" || target === "email" ? referralClient().share(target) : false,
  );
}
