/**
 * Creative to notification, through a swappable `NotificationSink`.
 *
 * This module owns brief §1's three-part impression rule, and it is deliberately the
 * only place that rule lives: "An impression requires all three: the toast actually
 * painted, the window focused for the full duration, and at least 4 seconds on screen.
 * Anything else is discarded locally and never reported."
 *
 * It contains no DOM and no timers of its own. The IDE tells it what happened - painted,
 * focus changed, dismissed - and it decides whether that adds up to an impression. That
 * is what makes the rule testable without launching an editor.
 */
import {
  AUTO_DISMISS_MS,
  MIN_DWELL_MS,
  type Clock,
  type Creative,
  type NotificationHandle,
  type NotificationSink,
  type Receipt,
  type SponsoredNotification,
  type ThemeKind,
} from "./types.ts";

interface LiveToast {
  creative: Creative;
  handle: NotificationHandle;
  theme: ThemeKind;
  shownAt: number;
  painted: boolean;
  /** Set false the moment focus is lost, and never set back. The duration must be unbroken. */
  focusHeld: boolean;
  reported: boolean;
}

export interface AdRendererDeps {
  readonly sink: NotificationSink;
  readonly clock: Clock;
  readonly onReceipt: (receipt: Receipt) => void;
  /**
   * Zen, full-screen, and presentation mode (§8.3). A second layer beneath the
   * scheduler, so a bug there still cannot put an ad over a demo.
   */
  readonly isSuppressed?: () => boolean;
  readonly newId?: () => string;
}

export interface AdRenderer {
  present(creative: Creative, theme: ThemeKind): void;
  onThemeChange(theme: ThemeKind): void;
  onPainted(): void;
  onFocusChange(focused: boolean): void;
  /** Returns the click URL for the caller to open in the *system browser* (§1). */
  click(): string | null;
  dismiss(): void;
  isShowing(): boolean;
}

function toNotification(creative: Creative, theme: ThemeKind): SponsoredNotification {
  return {
    creativeId: creative.creativeId,
    advertiser: creative.advertiser,
    headline: creative.headline,
    body: creative.body,
    logo: theme === "dark" ? creative.logoDark : creative.logoLight,
    clickUrl: creative.clickUrl,
    autoDismissMs: AUTO_DISMISS_MS,
  };
}

export function createAdRenderer(deps: AdRendererDeps): AdRenderer {
  let live: LiveToast | null = null;
  let counter = 0;
  const newId = deps.newId ?? (() => `r-${deps.clock.now()}-${++counter}`);

  function report(outcome: Receipt["outcome"]): void {
    if (live === null || live.reported) return;

    const dwellMs = deps.clock.now() - live.shownAt;

    // A click is a stronger signal of attention than any dwell threshold, so it is
    // reported regardless. An impression must earn all three conditions.
    const earned =
      outcome === "click" || (live.painted && live.focusHeld && dwellMs >= MIN_DWELL_MS);

    if (!earned) return;

    live.reported = true;
    deps.onReceipt({
      receiptId: newId(),
      creativeId: live.creative.creativeId,
      shownAt: live.shownAt,
      dwellMs,
      themeKind: live.theme,
      outcome,
    });
  }

  return {
    present(creative: Creative, theme: ThemeKind): void {
      if (deps.isSuppressed?.() === true) return;
      // Replacing a toast mid-view would cost the user the impression they were part
      // way through earning.
      if (live !== null) return;

      live = {
        creative,
        handle: deps.sink.show(toNotification(creative, theme)),
        theme,
        shownAt: deps.clock.now(),
        painted: false,
        focusHeld: true,
        reported: false,
      };
    },

    onThemeChange(theme: ThemeKind): void {
      if (live === null) return;
      live.theme = theme;
      live.handle.update(toNotification(live.creative, theme));
    },

    onPainted(): void {
      if (live !== null) live.painted = true;
    },

    onFocusChange(focused: boolean): void {
      // Once broken, the run is broken: regaining focus does not restore the claim
      // that the window was focused for the full duration.
      if (live !== null && !focused) live.focusHeld = false;
    },

    click(): string | null {
      if (live === null) return null;
      const url = live.creative.clickUrl;

      report("click");
      live.handle.dismiss();
      live = null;
      return url;
    },

    dismiss(): void {
      if (live === null) return;

      report("impression");
      live.handle.dismiss();
      live = null;
    },

    isShowing(): boolean {
      return live !== null;
    },
  };
}
