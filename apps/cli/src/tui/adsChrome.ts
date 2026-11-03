import type {
  NotificationHandle,
  NotificationSink,
  SponsoredNotification,
  ThemeKind,
} from "../../../../packages/ads/src/types.ts";
import type { Key } from "../tui/keyboard.ts";
import type { UI } from "../tui/ui.ts";
import { wrapPlain } from "../tui/ansi.ts";
import { createTerminalAdRuntime, type TerminalAdRuntime } from "../ads/runtime.ts";
import type { AppContext } from "../context.ts";
import { hostnameOf, openExternal } from "../util/open.ts";

/**
 * The sponsored card every full-screen view shares.
 *
 * One runtime per process, one card at a time, and one key handler. A screen asks for the
 * card's lines and adds them to its frame; it never owns scheduling, receipts or focus.
 * The card is deliberately non-modal: typing continues while it is on screen.
 */

interface LiveCard {
  readonly notification: SponsoredNotification;
  readonly startedAt: number;
  readonly dismissAt: number;
  painted: boolean;
  timer: NodeJS.Timeout | null;
}

export class TerminalAds {
  readonly ctx: AppContext;
  readonly runtime: TerminalAdRuntime;
  #card: LiveCard | null = null;
  #notify: ((card: SponsoredNotification | null) => void) | null = null;
  #tickTimer: NodeJS.Timeout | null = null;
  #started = false;
  #paintedNotified = false;
  #pending = 0;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
    const signals = ctx.workspaceSignals();
    this.runtime = createTerminalAdRuntime({
      account: ctx.account,
      sink: this.#sink(),
      adsEnabled: ctx.config.ads.enabled && !ctx.flags.noAds,
      preset: ctx.config.ads.preset,
      themeKind: ctx.adThemeKind(),
      focused: true,
      languageIds: signals.languageIds,
      filenames: signals.filenames,
      onReceipt: () => {
        this.#pending += 1;
      },
    });
  }

  #sink(): NotificationSink {
    return {
      show: (notification: SponsoredNotification): NotificationHandle => {
        const now = Date.now();
        if (this.#card !== null && this.#card.timer !== null) clearTimeout(this.#card.timer);
        this.#card = {
          notification,
          startedAt: now,
          dismissAt: now + notification.autoDismissMs,
          painted: false,
          timer: null,
        };
        this.#card.timer = setTimeout(() => {
          this.dismiss();
        }, notification.autoDismissMs);
        this.#card.timer.unref?.();
        this.#notify?.(notification);
        return {
          update: (next) => {
            if (this.#card === null || this.#card.notification.creativeId !== next.creativeId) return;
            this.#card = { ...this.#card, notification: next };
            this.#notify?.(next);
          },
          dismiss: () => {
            if (this.#card !== null && this.#card.timer !== null) clearTimeout(this.#card.timer);
            this.#card = null;
            this.#paintedNotified = false;
            this.#notify?.(null);
          },
        };
      },
    };
  }

  attach(notify: (card: SponsoredNotification | null) => void): void {
    this.#notify = notify;
    notify(this.#card?.notification ?? null);
  }

  detach(notify: (card: SponsoredNotification | null) => void): void {
    if (this.#notify === notify) this.#notify = null;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    if (!this.ctx.config.ads.enabled || this.ctx.flags.noAds) return;
    try {
      await this.runtime.start();
    } catch {
      // The ad client is designed to fail invisibly; a terminal launch is no exception.
    }
    if (this.#tickTimer === null) {
      const configured = Number((this.ctx.env ?? process.env)["ADCODE_AD_TICK_MS"] ?? "");
      const tickMs = Number.isFinite(configured) && configured >= 250 ? configured : 15_000;
      this.#tickTimer = setInterval(() => {
        void this.runtime.tick().catch(() => undefined);
      }, tickMs);
      this.#tickTimer.unref?.();
    }
  }

  tick(): void {
    void this.runtime.tick().catch(() => undefined);
  }

  setFocused(focused: boolean): void {
    this.runtime.onFocusChange(focused);
  }

  setTheme(theme: ThemeKind): void {
    this.runtime.onThemeChange(theme);
    if (this.#card !== null) this.#notify?.(this.#card.notification);
  }

  /** Called after the screen has painted the card lines. */
  painted(): void {
    if (this.#card !== null && !this.#paintedNotified) {
      this.#paintedNotified = true;
      this.#card.painted = true;
      this.runtime.onPainted();
    }
  }

  dismiss(): void {
    this.runtime.dismiss();
    if (this.#card !== null && this.#card.timer !== null) clearTimeout(this.#card.timer);
    this.#card = null;
    this.#paintedNotified = false;
    this.#notify?.(null);
  }

  /** A global shortcut. Returns true when the card consumed the key. */
  handleKey(key: Key): boolean {
    if (this.#card === null) return false;
    if (key.ctrl && key.name === "x") {
      this.dismiss();
      return true;
    }
    if (key.ctrl && key.name === "o") {
      const url = this.runtime.click();
      this.#card = null;
      this.#notify?.(null);
      if (url !== null) openExternal(url);
      return true;
    }
    return false;
  }

  get active(): boolean {
    return this.#card !== null;
  }

  get pending(): number {
    return this.#pending;
  }

  lines(ui: UI): string[] {
    const card = this.#card;
    if (card === null) return [];
    const notification = card.notification;
    const width = Math.max(24, Math.min(ui.width - 2, 100));
    const inner = width - 4;
    const bodyLines = notification.body === null ? [] : wrapPlain(notification.body, inner);
    const remaining = Math.max(0, Math.ceil((card.dismissAt - Date.now()) / 1000));
    const meta = `${hostnameOf(notification.clickUrl)}  ·  sponsored  ·  ${remaining}s`;
    const openHint = `${ui.paint("ctrl+o", "ink", { bold: true })} ${ui.paint("open", "faint")}`;
    const dismissHint = `${ui.paint("ctrl+x", "ink", { bold: true })} ${ui.paint("dismiss", "faint")}`;
    // The controls are part of the card's contract, so they get their own lines rather
    // than being the first thing a narrow terminal truncates.
    const controlLines = inner >= 28 ? [`${openHint}   ${dismissHint}`] : [openHint, dismissHint];
    const lines: string[] = [
      `${ui.paint("SPONSORED", "faint")}  ${ui.paint(notification.advertiser, "muted", { bold: true })}`,
      ui.paint(notification.headline, "ink", { bold: true }),
      ...(bodyLines.length === 0 ? [] : bodyLines.map((line) => ui.paint(line, "muted"))),
      "",
      ...wrapPlain(meta, inner).map((line) => ui.paint(line, "faint")),
      "",
      ...controlLines,
    ];
    return ui.box({
      title: `${ui.glyphs.spark} Sponsored`,
      titleTone: "money",
      borderTone: "border",
      lines,
      width,
      padding: 1,
    });
  }

  get reserve(): number {
    return this.#card === null ? 0 : 8;
  }

  async shutdown(): Promise<void> {
    if (this.#tickTimer !== null) clearInterval(this.#tickTimer);
    this.#tickTimer = null;
    const card = this.#card;
    if (card !== null && card.timer !== null) clearTimeout(card.timer);
    this.#card = null;
    await this.runtime.shutdown();
  }
}
