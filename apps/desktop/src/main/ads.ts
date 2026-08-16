/**
 * Where the ad client meets the IDE.
 *
 * The ad client runs here, in the main process, not in the renderer - and that follows
 * from the CSP rather than from taste. §1 requires a strict policy, `connect-src 'self'`
 * is part of it, and a renderer under that policy cannot reach an ad server at all. The
 * renderer's whole job is to paint a toast and report what happened to it.
 *
 * §9's governing rule applies to every line here: the ad client may fail in any way, and
 * the worst permitted outcome is that the user sees no ad. Nothing in this file may throw
 * into startup, editing, or the terminal.
 */
import { join } from "node:path";
import { BrowserWindow, app, shell } from "electron";
import {
  buildSponsorsView,
  createAdClient,
  createAdRenderer,
  createAdService,
  createAssetCache,
  createFirebaseAuth,
  createReceiptQueue,
  formatMicros,
  type AdService,
  type Balance,
  type FrequencyPreset,
  type NotificationHandle,
  type NotificationSink,
  type Receipt,
  type SponsoredNotification,
  type ThemeKind,
  type TokenProvider,
} from "@adcode/ads";
import { CHANNELS, type EarningsSnapshot, type SponsoredToast } from "../shared/api.ts";
import { DiskFileStore, FetchHttpTransport, SystemClock, toDataUrl } from "./adPorts.ts";
import { currentSettings } from "./settings.ts";

/** §8.1: the 60s tick that asks the scheduler whether now is a moment to interrupt. */
const TICK_MS = 60_000;

/**
 * §9 requires the ad client to fail invisibly, which also makes it impossible to debug
 * by observation - a silent no-op and a working system look identical from outside. This
 * flag is the way back in. Off by default, so the shipped behaviour is still silence.
 */
const DEBUG = process.env["ADCODE_AD_DEBUG"] === "1";

function debug(message: string, detail?: unknown): void {
  if (!DEBUG) return;
  process.stderr.write(`[ads] ${message}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}\n`);
}

interface AdRuntime {
  start(): Promise<void>;
  stop(): void;
  notePainted(creativeId: string): void;
  noteDismissed(creativeId: string): void;
  noteClicked(creativeId: string): void;
  setSuppressed(suppressed: boolean): void;
  setWindowFocused(focused: boolean): void;
  setThemeKind(theme: ThemeKind): void;
  setWorkspaceSignals(languageIds: string[], filenames: string[]): void;
}

function broadcast(channel: string, ...args: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, ...args);
  }
}

/**
 * A token provider for pointing at the local mock server.
 *
 * Real identity is Firebase anonymous auth, which needs a project and an API key. Without
 * one the client would fail closed and no ad would ever show, which is correct but makes
 * the feature impossible to see while building it.
 */
function staticTokenProvider(token: string): TokenProvider {
  return {
    getToken: async () => ({ ok: true, value: token }),
    invalidate: () => undefined,
  };
}

export function createAdRuntime(): AdRuntime {
  const clock = new SystemClock();
  const store = new DiskFileStore(join(app.getPath("userData"), "ads"));

  // Development points at the mock server, which advertises assets on the allowlisted
  // https host while serving bytes from localhost. The rewrite is the transport's job;
  // the validator still sees, and still enforces, https on an exact hostname.
  const devServer = process.env["ADCODE_AD_SERVER"];
  const firebaseKey = process.env["ADCODE_FIREBASE_API_KEY"];
  const assetHost = process.env["ADCODE_ASSET_HOST"] ?? "cdn.adcode.test";

  const rewrites: Array<readonly [string, string]> =
    devServer === undefined ? [] : [[`https://${assetHost}/assets`, `${devServer}/assets`]];

  const http = new FetchHttpTransport(rewrites);

  const tokens: TokenProvider =
    devServer !== undefined || firebaseKey === undefined
      ? staticTokenProvider("dev-token")
      : createFirebaseAuth({ http, clock, store, apiKey: firebaseKey });

  const client = createAdClient({
    http,
    tokens,
    clock,
    baseUrl: `${devServer ?? "https://api.adcode.dev"}/v1`,
    assetHost,
  });

  const assets = createAssetCache({ http, store, clock, allowedHost: assetHost });
  const queue = createReceiptQueue({ store });

  let suppressed = false;
  let windowFocused = true;
  let themeKind: ThemeKind = "dark";
  let languageIds: string[] = [];
  let filenames: string[] = [];
  let liveCreativeId: string | null = null;
  let clickUrl: string | null = null;
  let lastBalance: Balance | null = null;

  /**
   * The `NotificationSink` the ad client writes into. Everything it produces crosses to
   * the renderer as data - never a remote URL, so an advertiser never sees the user's IP.
   */
  const sink: NotificationSink = {
    show(notification: SponsoredNotification): NotificationHandle {
      liveCreativeId = notification.creativeId;
      clickUrl = notification.clickUrl;

      void deliver(notification);

      return {
        update: (next) => void deliver(next),
        dismiss: () => {
          liveCreativeId = null;
          clickUrl = null;
        },
      };
    },
  };

  async function deliver(notification: SponsoredNotification): Promise<void> {
    let logoDataUrl: string | null = null;

    try {
      const bytes = await assets.get(notification.logo);
      if (bytes.ok) logoDataUrl = toDataUrl(bytes.value);
      else debug("asset fetch rejected", bytes.error);
    } catch (error) {
      // A missing logo is a worse-looking toast, not a failure.
      debug("asset fetch threw", String(error));
    }

    debug("delivering toast", { creativeId: notification.creativeId, hasLogo: logoDataUrl !== null });

    const toast: SponsoredToast = {
      creativeId: notification.creativeId,
      advertiser: notification.advertiser,
      headline: notification.headline,
      body: notification.body,
      logoDataUrl,
      autoDismissMs: notification.autoDismissMs,
    };

    broadcast(CHANNELS.adShow, toast);
  }

  const adRenderer = createAdRenderer({
    sink,
    clock,
    isSuppressed: () => suppressed,
    onReceipt: (receipt: Receipt) => {
      void queue.enqueue(receipt).catch(() => undefined);
    },
  });

  const service: AdService = createAdService({
    clock,
    queue,
    renderer: adRenderer,
    client,
    assets,
    tokens,
    // Getters, not values: `adService` reads these on every tick, so a live view is
    // what makes the settings screen's switches take effect immediately rather than at
    // the next launch. §4's promise is that the user can switch anything off - a toggle
    // that needs a restart to mean anything does not keep it.
    settings: {
      get adsEnabled(): boolean {
        if (process.env["ADCODE_ADS_DISABLED"] === "1") return false;
        return currentSettings()["adcode.ads.enabled"] !== false;
      },
      get preset(): FrequencyPreset {
        const value = currentSettings()["adcode.ads.frequency"];
        return typeof value === "string" ? (value as FrequencyPreset) : "standard";
      },
      // Development only. Never remote-configurable - see AdServiceSettings.settleMs.
      ...(process.env["ADCODE_SETTLE_MS"] === undefined
        ? {}
        : { settleMs: Number(process.env["ADCODE_SETTLE_MS"]) }),
    },
    ide: {
      windowFocused: () => windowFocused,
      // Wired to the real debug session once the DAP client exists. Reporting `false`
      // here would be a claim this code cannot yet make honestly, but reporting `true`
      // would suppress every ad forever - so `false` stands with this note on it.
      debugActive: () => false,
      doNotDisturb: () => false,
      themeKind: () => themeKind,
      languageIds: () => languageIds,
      filenames: () => filenames,
    },
  });

  let timer: NodeJS.Timeout | null = null;

  async function pushEarnings(): Promise<void> {
    const balance = service.balance() ?? lastBalance;
    lastBalance = balance;

    const view = buildSponsorsView({ balance, history: [], config: service.config() });

    // Full precision here, not the compact cents form. One impression is worth about
    // 1,500 micros, and `formatMicrosCompact` renders that as "$0.00" - so a user's
    // first genuine earning would read as nothing at all. Both labels are still
    // server values formatted by the ledger; §1's rule is untouched.
    const snapshot: EarningsSnapshot = {
      availableLabel: balance === null ? view.availableLabel : formatMicros(balance.availableMicros),
      lifetimeLabel: balance === null ? view.lifetimeLabel : formatMicros(balance.lifetimeMicros),
      hasServerBalance: view.hasServerBalance,
    };

    broadcast(CHANNELS.earningsChanged, snapshot);
  }

  return {
    async start(): Promise<void> {
      debug("starting", { baseUrl: `${devServer ?? "https://api.adcode.dev"}/v1`, assetHost });

      try {
        await service.start();
        await pushEarnings();
        debug("started", { config: service.config() !== null, balance: service.balance() !== null });
      } catch (error) {
        // §9: never on the critical path. An ad failure at startup costs an ad.
        debug("start failed", String(error));
      }

      timer = setInterval(() => {
        void service
          .tick()
          .then(async () => {
            debug("tick", { reason: service.lastReason(), caps: service.effectiveCaps() });
            await pushEarnings();
          })
          .catch((error: unknown) => debug("tick failed", String(error)));
      }, TICK_MS);

      // Node keeps the process alive for pending timers; an ad tick must never be the
      // reason the app refuses to quit.
      timer.unref?.();
    },

    stop(): void {
      if (timer !== null) clearInterval(timer);
      timer = null;
      service.stop();
    },

    notePainted(creativeId: string): void {
      if (creativeId === liveCreativeId) service.onPainted();
    },

    noteDismissed(creativeId: string): void {
      if (creativeId !== liveCreativeId) return;
      service.dismiss();
      void pushEarnings();
    },

    noteClicked(creativeId: string): void {
      if (creativeId !== liveCreativeId) return;

      const url = clickUrl;
      service.click();

      // §1: "Ad clicks open via the system browser, https only. Never a webview, never
      // in-editor navigation."
      if (url !== null && url.startsWith("https://")) void shell.openExternal(url);
      void pushEarnings();
    },

    setSuppressed(next: boolean): void {
      suppressed = next;
    },

    setWindowFocused(focused: boolean): void {
      windowFocused = focused;
      service.onFocusChange(focused);
    },

    setThemeKind(theme: ThemeKind): void {
      themeKind = theme;
      service.onThemeChange(theme);
    },

    setWorkspaceSignals(nextLanguages: string[], nextFilenames: string[]): void {
      languageIds = nextLanguages;
      filenames = nextFilenames;
    },
  };
}
