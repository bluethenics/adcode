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
import { currentSettings, onSettingsChanged } from "./settings.ts";
import { apiBaseUrl, apiOrigin, createBackendTokens } from "./backend.ts";
import { isAccountBanned } from "./accountBan.ts";
import { adsHeldForNewcomer } from "./milestones.ts";
import { nextTickDelay, partnerEarnBody, partnerRetryDelay } from "./partnerNotification.ts";
import { currentDebugState } from "./debug.ts";
import { isAgentBrowserWindow } from "./agentBrowser.ts";
import { announceAiUsageChanged } from "./aiUsage.ts";
import { cardRateLabel, parseCardRate } from "./cardRate.ts";
import {
  isConversionRequest,
  parseConversionQuote,
  parseConversionResponse,
  type CreditConversionQuoteResult,
  type CreditConversionResult,
} from "../shared/creditConversion.ts";

/** §8.1: the 60s tick that asks the scheduler whether now is a moment to interrupt. */
const DEFAULT_TICK_MS = 60_000;
/** Partner cards this process claims in a minute, every network together: the server's CARDS_PAID_PER_MINUTE. */
const PARTNER_CLAIMS_PER_MINUTE = 3;

/**
 * How long a delivered toast may go unanswered before it is written off.
 *
 * The renderer owns the auto-dismiss timer, so in the normal case the toast comes down on
 * its own and reports back within `AUTO_DISMISS_MS`. If it never reports - the window was
 * reloaded, the renderer crashed and restored, the broadcast arrived when no window was
 * open - then `AdRenderer.present` keeps refusing to replace a toast that is not on screen
 * anywhere, and *no further ad ever shows for the rest of the session*. It fails exactly
 * the way §9 says an ad failure must, silently, which is what makes it worth a watchdog
 * rather than a log line.
 *
 * Dismissing through the service rather than dropping state directly, so the impression
 * rule still decides: `report` only credits an impression if the toast genuinely painted,
 * held focus, and lasted four seconds. A written-off toast that never painted earns
 * nothing, which is correct.
 *
 * The grace is five minutes rather than a few seconds, and that is the load-bearing
 * number. The renderer *pauses* its auto-dismiss while the pointer is over the card, so a
 * toast can legitimately stay up for as long as somebody is reading it - and writing one
 * off while they read would clear `liveCreativeId`, which is what `noteClicked` matches on.
 * The user would then click an ad that is still on screen and nothing at all would happen.
 * This exists to unwedge a session whose renderer is gone, not to enforce a deadline on a
 * reader, so it is set far beyond any plausible hover. The cost of the long wait is at most
 * one skipped card; every preset's gap is minutes anyway.
 */
const TOAST_WATCHDOG_GRACE_MS = 300_000;

/**
 * The tick interval. Development only, like `settleMs`, and for the same reason: a server
 * that could set this would be able to make the IDE more annoying than it ships.
 */
function tickMs(): number {
  const override = Number(process.env["ADCODE_AD_TICK_MS"]);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_TICK_MS;
}

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

/**
 * The frequency preset in effect.
 *
 * One definition, because the scheduler and the earnings report both need it and a report
 * that marked a different row as active than the one actually throttling the ads would be
 * worse than showing no marker at all.
 */
function presetFromSettings(): FrequencyPreset {
  const value = currentSettings()["adcode.ads.frequency"];
  return typeof value === "string" ? (value as FrequencyPreset) : "standard";
}

interface AdRuntime {
  start(): Promise<void>;
  stop(): void;
  notePainted(creativeId: string): void;
  /** The partner frame's answer for a slot it took: `empty` gives the slot back. */
  notePartnerResult(id: string, outcome: "shown" | "empty"): void;
  /** A partner counted an impression of this card on screen: claim its payout for this account. */
  notePartnerImpression(slotId: string, conversationId?: string): Promise<void>;
  noteDismissed(creativeId: string): void;
  noteClicked(creativeId: string): void;
  setSuppressed(suppressed: boolean): void;
  setWindowFocused(focused: boolean): void;
  setThemeKind(theme: ThemeKind): void;
  setWorkspaceSignals(languageIds: string[], filenames: string[]): void;
  /**
   * Ask the server for the balance now, and return what it said.
   *
   * The tick already refreshes this every sixty seconds. This exists so the report's refresh
   * button can answer "is it stuck, or is it just zero" without the user waiting out a minute.
   */
  refreshEarnings(): Promise<EarningsSnapshot>;
  /** `GET /v1/earnings/convert`: what converting earnings to AI credits would look like now. */
  conversionQuote(): Promise<CreditConversionQuoteResult>;
  /** `POST /v1/earnings/convert`, then the earnings and every credit display refresh. */
  convertToCredits(request: unknown): Promise<CreditConversionResult>;
}

/**
 * The one window a sponsored card is shown in.
 *
 * The focused window, because the scheduler only presents while one is focused - and
 * otherwise the first window still open, since the asset fetch in `deliver` can outlast a
 * focus change. One window, not all of them: the server records one receipt per card, so a
 * card painted in both the Vibe and the IDE window was two ads to the person looking at them
 * and one view on the advertiser's dashboard.
 */
function toastTarget(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused !== null && !focused.isDestroyed()) return focused;
  // Never the assistant's offscreen browser: a card painted there is a card nobody saw.
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && !isAgentBrowserWindow(window)) ?? null;
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
export function createAdRuntime(): AdRuntime {
  const clock = new SystemClock();
  const store = new DiskFileStore(join(app.getPath("userData"), "ads"));

  // Development points at the mock server, which advertises assets on the allowlisted
  // https host while serving bytes from localhost. The rewrite is the transport's job;
  // the validator still sees, and still enforces, https on an exact hostname.
  const devServer = process.env["ADCODE_AD_SERVER"];

  /*
   * The one host creative artwork may come from.
   *
   * This used to default to `cdn.adcode.test` in every build, including packaged ones -
   * a hostname that has never existed. The validator enforces exact-hostname equality, so
   * the shipped app was guaranteed to reject every real creative it was ever served, and
   * did: one bad logo fails the whole `parseServeResponse`, so a single creative took the
   * entire response with it and the editor concluded it had no inventory.
   *
   * Now it follows the API origin, because that is where the service hands out assets -
   * `/assets/:key` on its own hostname. One deployment, one hostname, one certificate, and
   * nothing to keep in step by hand.
   *
   * A dev server keeps the fake host: the mock advertises `cdn.adcode.test` while serving
   * the bytes from localhost, and the rewrite below is what bridges the two. That is what
   * lets the https rule be *tested* rather than relaxed.
   */
  const assetHost =
    process.env["ADCODE_ASSET_HOST"] ??
    (devServer === undefined ? new URL(apiOrigin()).hostname : "cdn.adcode.test");

  const rewrites: Array<readonly [string, string]> =
    devServer === undefined ? [] : [[`https://${assetHost}/assets`, `${devServer}/assets`]];

  const http = new FetchHttpTransport(rewrites);

  const tokens: TokenProvider = createBackendTokens({ http, clock, store });

  const client = createAdClient({
    http,
    tokens,
    clock,
    baseUrl: apiBaseUrl(),
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
  /** This person's pay per card where they are (cardRate.ts), asked at most every ten minutes. */
  let cardRate: string | null = null;
  let cardRateAskedAt = Number.NEGATIVE_INFINITY;
  let watchdog: NodeJS.Timeout | null = null;
  /** The window holding the live card, by id. See `toastTarget`. */
  let toastWindowId: number | null = null;

  /**
   * The `NotificationSink` the ad client writes into. Everything it produces crosses to
   * the renderer as data - never a remote URL, so an advertiser never sees the user's IP.
   */
  const sink: NotificationSink = {
    show(notification: SponsoredNotification): NotificationHandle {
      liveCreativeId = notification.creativeId;
      clickUrl = notification.clickUrl;
      toastWindowId = toastTarget()?.id ?? null;
      armWatchdog(notification);

      void deliver(notification);

      return {
        update: (next) => void deliver(next),
        dismiss: () => {
          clearWatchdog();
          liveCreativeId = null;
          clickUrl = null;
          toastWindowId = null;
        },
      };
    },
  };

  function clearWatchdog(): void {
    if (watchdog !== null) clearTimeout(watchdog);
    watchdog = null;
  }

  /** See `TOAST_WATCHDOG_GRACE_MS`. */
  function armWatchdog(notification: SponsoredNotification): void {
    clearWatchdog();

    watchdog = setTimeout(() => {
      watchdog = null;
      if (liveCreativeId !== notification.creativeId) return;

      debug("toast went unanswered, writing it off", { creativeId: notification.creativeId });

      // Through the service, so the impression rule still decides whether this earned
      // anything and so the ad renderer's own `live` is cleared. That field is the one
      // that would otherwise refuse every future card.
      service.dismiss();
      void pushEarnings();
    }, notification.autoDismissMs + TOAST_WATCHDOG_GRACE_MS);

    // Never the reason the app refuses to quit, same as the tick.
    watchdog.unref?.();
  }

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

    // Sent to the window chosen at `show`, so a theme update reaches the card it updates
    // rather than opening a second one elsewhere. A window closed since then gets nothing,
    // and the watchdog writes the card off.
    const target = toastWindowId === null ? null : BrowserWindow.fromId(toastWindowId);
    if (target !== null && !target.isDestroyed()) target.webContents.send(CHANNELS.adShow, toast);
  }

  const adRenderer = createAdRenderer({
    sink,
    clock,
    isSuppressed: () => suppressed || isAccountBanned(),
    onReceipt: (receipt: Receipt) => {
      void queue.enqueue(receipt).catch(() => undefined);
    },
  });

  let partnerId: string | null = null;
  /** When to ask again after Zeekend left a slot empty; null when nothing is waiting. */
  let partnerRetryAt: number | null = null;
  /** Empty answers in a row, for the retry's back-off. */
  let partnerEmpties = 0;
  /** When this process last claimed partner cards, for its own pace (notePartnerImpression). */
  const partnerClaims: number[] = [];

  /**
   * No partner is asked for a notification (2026-11-25). Until 2.6.5 this asked Zeekend, in a
   * slot no direct campaign filled, about a sentence ADCode wrote - "What's worth buying for a
   * programmer who works on <the project's languages> code?" - one for every card, and Zeekend
   * counted them as questions a person had asked. A partner is asked only about words a person
   * sent (the strip above the message box, once per finished exchange), and a notification has
   * none. The setting and the channel stay, so the notification can come back with a real
   * message behind it rather than a made-up one.
   */
  function presentPartner(): boolean {
    return false;
  }

  const service: AdService = createAdService({
    clock,
    fallback: { present: presentPartner },
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
        return presetFromSettings();
      },
      // Development only. Never remote-configurable - see AdServiceSettings.settleMs.
      ...(process.env["ADCODE_SETTLE_MS"] === undefined
        ? {}
        : { settleMs: Number(process.env["ADCODE_SETTLE_MS"]) }),
    },
    ide: {
      windowFocused: () => windowFocused,
      /*
       * §8.1's `debug-active`, now that the DAP client exists.
       *
       * Starting, running, and paused are all "the user is debugging"; a paused session
       * most of all, because that is somebody reading a stack frame. `stopped` and
       * `failed` are over - the session ended - and suppressing on those would mean one
       * failed debug attempt silenced ads until the next launch.
       */
      debugActive: () => {
        const state = currentDebugState().state;
        return state === "starting" || state === "running" || state === "paused";
      },
      doNotDisturb: () => false,
      // Ads wait for a new install's first success - see `newcomerHold`.
      newcomer: () => adsHeldForNewcomer(Date.now()),
      themeKind: () => themeKind,
      languageIds: () => languageIds,
      filenames: () => filenames,
    },
  });

  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  /**
   * Wake the tick when the next card is due: when the frequency's gap ends, or soon after
   * Zeekend left a slot empty - at most a regular tick away. One timer at a time; a tick that
   * is already waiting is replaced by the sooner one.
   */
  function schedule(): void {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    const now = clock.now();
    const delay = nextTickDelay(now, service.nextSlotAt(), tickMs(), partnerRetryAt);
    timer = setTimeout(() => {
      timer = null;
      if (partnerRetryAt !== null && clock.now() >= partnerRetryAt) partnerRetryAt = null;
      // A banned account is served and paid nothing (the server refuses both); asking anyway
      // would only be a stream of 403s. The tick keeps its cadence, so an unban resumes it.
      if (isAccountBanned()) { schedule(); return; }
      void service
        .tick()
        .then(async () => {
          debug("tick", { reason: service.lastReason(), caps: service.effectiveCaps() });
          await pushEarnings();
        })
        .catch((error: unknown) => debug("tick failed", String(error)))
        .finally(schedule);
    }, delay);
    // Node keeps the process alive for pending timers; an ad tick must never be the
    // reason the app refuses to quit.
    timer.unref?.();
  }

  /**
   * Follow the switches the moment they move.
   *
   * A frequency change has to take effect now rather than when the old interval runs out -
   * otherwise switching to Max while a Standard gap is pending feels like the setting did
   * nothing for one more wait. And a switch that says ads are off must take down the card
   * already on screen instead of leaving it to its own dismiss timer.
   */
  onSettingsChanged((values) => {
    // Only once the runtime is running: a settings load before `start` must not begin
    // ticking on its own. A tick already in flight reschedules itself with the new values.
    if (timer !== null) schedule();
    const off = values["adcode.ads.enabled"] === false || values["adcode.ads.frequency"] === "off";
    if (!off) return;
    service.dismiss();
    partnerRetryAt = null;
  });

  async function pushEarnings(): Promise<EarningsSnapshot> {
    const balance = service.balance() ?? lastBalance;
    lastBalance = balance;

    /*
     * The outbox depth, for the report's "waiting to sync" row.
     *
     * `all()` touches the disk, and §9 says an ad failure costs an ad and nothing else - a
     * report row is worth even less than that - so a read that fails contributes a zero and
     * is not allowed to abort the broadcast the balances ride on.
     */
    let pendingReceipts = 0;
    try {
      pendingReceipts = (await queue.all()).length;
    } catch {
      pendingReceipts = 0;
    }

    const config = service.config();
    const activePreset = presetFromSettings();
    const view = buildSponsorsView({ balance, history: [], config });

    // Full precision here, not the compact cents form. One impression is worth about
    // 1,500 micros, and `formatMicrosCompact` renders that as "$0.00" - so a user's
    // first genuine earning would read as nothing at all. Both labels are still
    // server values formatted by the ledger; §1's rule is untouched.
    const snapshot: EarningsSnapshot = {
      availableLabel: balance === null ? view.availableLabel : formatMicros(balance.availableMicros),
      lifetimeLabel: balance === null ? view.lifetimeLabel : formatMicros(balance.lifetimeMicros),
      hasServerBalance: view.hasServerBalance,
      // Frequency Off is reported as ads off, because that is what the person sees: no card.
      enabled: currentSettings()["adcode.ads.enabled"] !== false && activePreset !== "off",
      pendingReceipts,
      // Straight from the scheduler's last decision. Null once nothing is blocking.
      suppressedReason: service.lastReason(),
      // Straight from the view model, which read the projections out of `/v1/config`. No
      // figure here is computed in this process, let alone in the renderer.
      presets: view.presets.map((option) => ({
        preset: option.preset,
        active: option.preset === activePreset,
        minIntervalMs: option.minIntervalMs,
        dailyCap: option.dailyCap,
        projectionLabel: option.projectionLabel,
      })),
      cardRateLabel: cardRate,
    };

    broadcast(CHANNELS.earningsChanged, snapshot);
    // The rate rides on the same broadcast; asked in the background, re-sent only if it changed.
    void refreshCardRate().then((changed) => { if (changed) void pushEarnings(); });
    return snapshot;
  }

  /*
   * What a card pays this person where they are (2026-11-25): pay depends on the country the
   * server sees the request come from, so it is asked, not assumed. At most every ten minutes -
   * a country changes with a trip or a VPN, not by the minute - and a failure keeps the last
   * answer: §9, an ad failure costs a line in Earnings and nothing else.
   */
  async function refreshCardRate(): Promise<boolean> {
    if (clock.now() - cardRateAskedAt < 10 * 60_000) return false;
    cardRateAskedAt = clock.now();
    try {
      const token = await tokens.getToken();
      if (!token.ok) return false;
      const response = await fetch(`${apiBaseUrl()}/sponsored/rate`, { headers: { authorization: `Bearer ${token.value}` }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return false;
      const rate = parseCardRate(await response.json().catch(() => null));
      const label = rate === null ? cardRate : cardRateLabel(rate);
      if (label === cardRate) return false;
      cardRate = label;
      return true;
    } catch (error) {
      debug("card rate failed", String(error));
      return false;
    }
  }

  /** The balance from the server, broadcast to every window. */
  async function runtimeRefresh(): Promise<EarningsSnapshot> {
    await service.refreshBalance();
    return pushEarnings();
  }

  return {
    async start(): Promise<void> {
      debug("starting", { baseUrl: apiBaseUrl(), assetHost });

      try {
        await service.start();
        await pushEarnings();
        debug("started", { config: service.config() !== null, balance: service.balance() !== null });
      } catch (error) {
        // §9: never on the critical path. An ad failure at startup costs an ad.
        debug("start failed", String(error));
      }

      schedule();
    },

    stop(): void {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      clearWatchdog();
      service.stop();
    },

    /**
     * The admin's rate for a partner card this person was shown (services/api
     * networkImpressions.ts). The sponsored page says which card Zeekend or Imprezia counted on
     * screen; this process, which holds the account's token, claims it. An Imprezia card's id
     * starts `slot_imp_`, and the server reads the network from the id. It pays a card once,
     * to one person, within a daily cap, so a repeat or a forged card costs nothing. Sponsored
     * messages off: nothing.
     */
    async notePartnerImpression(slotId: string, conversationId?: string): Promise<void> {
      if (!/^slot_[A-Za-z0-9_-]{4,64}$/.test(slotId) || currentSettings()["adcode.ads.enabled"] === false || isAccountBanned()) return;
      // The server pays three cards a minute per account and holds an account that keeps going
      // past that (networkImpressions.ts ZEEKEND_PAID_PER_MINUTE). Several windows each showing a
      // card can go past it honestly, so this process keeps its own claims under it.
      const at = clock.now();
      while (partnerClaims.length > 0 && at - partnerClaims[0]! >= 60_000) partnerClaims.shift();
      if (partnerClaims.length >= PARTNER_CLAIMS_PER_MINUTE) { debug("partner impression skipped: pace", { slotId }); return; }
      partnerClaims.push(at);
      try {
        const token = await tokens.getToken();
        if (!token.ok) return;
        const response = await fetch(`${apiBaseUrl()}/sponsored/earn`, {
          method: "POST",
          headers: { authorization: `Bearer ${token.value}`, "content-type": "application/json" },
          body: JSON.stringify(partnerEarnBody(slotId, conversationId)),
          signal: AbortSignal.timeout(10_000),
        });
        const outcome = (await response.json().catch(() => null)) as { credited?: unknown } | null;
        debug("partner impression", { slotId, status: response.status, credited: outcome?.credited });
        // The balance moved on the server: show it, a moment later, without waiting for the next tick.
        if (outcome?.credited === true) setTimeout(() => { void runtimeRefresh(); }, 1_500).unref?.();
      } catch (error) {
        debug("partner impression failed", String(error));
      }
    },

    notePartnerResult(id: string, outcome: "shown" | "empty"): void {
      if (id !== partnerId) return;
      partnerId = null;
      debug("partner result", { id, outcome });
      if (outcome !== "empty") {
        partnerEmpties = 0;
        return;
      }
      // The slot goes back, uncounted, and Zeekend is asked again shortly rather than at the
      // next regular tick: an empty answer must not leave a gap in the cadence. A run of empty
      // answers backs off - 20s, 40s, then the regular tick - so a quiet exchange is not
      // asked more often than it was before.
      service.fallbackUnfilled();
      partnerRetryAt = clock.now() + partnerRetryDelay(partnerEmpties);
      partnerEmpties += 1;
      schedule();
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

    async refreshEarnings(): Promise<EarningsSnapshot> {
      /*
       * A tick, then the snapshot.
       *
       * `tick()` is what talks to the server; `pushEarnings` formats whatever it left behind.
       * The tick is allowed to fail - §9 says the worst permitted outcome of an ad failure is
       * that the user sees no ad, and that applies at least as much to a button they pressed -
       * so a failure here still returns the last known figures rather than throwing into the
       * renderer.
       */
      try {
        await service.tick();
      } catch {
        // Falls through to the snapshot below, which is then the previous balance.
      }

      return pushEarnings();
    },

    async conversionQuote(): Promise<CreditConversionQuoteResult> {
      try {
        const token = await tokens.getToken();
        if (!token.ok) return { ok: false, reason: "signed-out" };
        const response = await fetch(`${apiBaseUrl()}/earnings/convert`, {
          headers: { authorization: `Bearer ${token.value}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (response.status === 401) return { ok: false, reason: "signed-out" };
        const quote = response.ok ? parseConversionQuote(await response.json().catch(() => null)) : null;
        return quote === null ? { ok: false, reason: "offline" } : { ok: true, quote };
      } catch (error) {
        debug("conversion quote failed", String(error));
        return { ok: false, reason: "offline" };
      }
    },

    /*
     * The server decides the credit and does the move in one transaction; this only carries
     * the amount and the request id. A lost answer is retried once with the same id, which the
     * server turns into "already done" if the first attempt landed, so it can never pay twice.
     */
    async convertToCredits(request: unknown): Promise<CreditConversionResult> {
      if (!isConversionRequest(request)) return { ok: false, error: "invalid-request", retryable: false };
      const attempt = async (): Promise<CreditConversionResult> => {
        const token = await tokens.getToken();
        if (!token.ok) return { ok: false, error: "signed-out", retryable: false };
        const response = await fetch(`${apiBaseUrl()}/earnings/convert`, {
          method: "POST",
          headers: { authorization: `Bearer ${token.value}`, "content-type": "application/json" },
          body: JSON.stringify({ requestId: request.requestId, amountMicros: request.amountMicros }),
          signal: AbortSignal.timeout(15_000),
        });
        const body = (await response.json().catch(() => null)) as unknown;
        if (response.ok) {
          const parsed = parseConversionResponse(body);
          return parsed ?? { ok: false, error: "unexpected", retryable: true };
        }
        const error = typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : "unexpected";
        return { ok: false, error: response.status === 401 ? "signed-out" : error, retryable: response.status >= 500 };
      };
      let result: CreditConversionResult;
      try {
        result = await attempt();
        if (!result.ok && result.retryable) result = await attempt();
      } catch (first) {
        debug("conversion failed, retrying with the same id", String(first));
        try {
          result = await attempt();
        } catch (error) {
          debug("conversion failed", String(error));
          return { ok: false, error: "offline", retryable: true };
        }
      }
      if (result.ok) {
        // Both balances moved on the server: the earnings card, the status bar and every
        // credit meter read them again now, not at the next tick.
        announceAiUsageChanged();
        try {
          await service.tick();
        } catch {
          // The card already has the new figures from the answer itself.
        }
        void pushEarnings();
      }
      return result;
    },
  };
}
