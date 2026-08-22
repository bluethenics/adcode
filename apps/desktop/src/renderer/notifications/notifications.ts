/**
 * The notification system, and the sponsored notification kind (brief §8.3).
 *
 * Sponsored is a first-class *kind* in our own notification system rather than a bolted-on
 * popup: logo slot, "Sponsored" label, its own theme token, dismiss button.
 *
 * The animation obeys §1 strictly. Only `transform` and `opacity` are ever animated -
 * both are GPU-composited, whereas animating `top`, `right`, `width`, or `height` forces
 * layout every frame *while the user is typing*, which surfaces as input latency in the
 * one application where latency is unforgivable. `will-change` is set on enter and
 * removed on completion so no compositor layer stays pinned for the session.
 */
import type { SponsoredToast } from "../../shared/api.ts";
import { ICON, iconButton } from "../workbench/icons.ts";

const ENTER_MS = 220;
const EXIT_MS = 160;

/** An ordinary notification: the editor talking to the user about the user's own work. */
export interface Notification {
  readonly title: string;
  readonly body?: string;
  readonly actions?: ReadonlyArray<{ readonly label: string; readonly run: () => void }>;
  /** Omit to leave it up until dismissed - the right default for anything with actions. */
  readonly autoDismissMs?: number;
  /**
   * Visual weight. `warning` is for something currently wrong that the reader may need to
   * work around; the default reads as an FYI.
   */
  readonly tone?: "info" | "warning";
}

export interface NotificationCentre {
  show(notification: Notification): void;
  showSponsored(toast: SponsoredToast): void;
  dismissAll(): void;
}

export function createNotificationCentre(host: HTMLElement): NotificationCentre {
  // `clearTimer` is a closure rather than a timer id: hovering pauses the auto-dismiss
  // and un-hovering re-arms it with a fresh id, so a stored id goes stale the first time
  // the pointer crosses the toast.
  let live: { element: HTMLElement; creativeId: string; clearTimer: () => void } | null = null;

  function teardown(creativeId: string, notify: boolean): void {
    if (live === null || live.creativeId !== creativeId) return;

    const { element, clearTimer } = live;
    live = null;
    clearTimer();

    element.style.willChange = "transform, opacity";
    element.dataset["state"] = "exiting";

    window.setTimeout(() => {
      element.remove();
    }, EXIT_MS);

    if (notify) window.adcode.ads.dismissed(creativeId);
  }

  /** Plain toasts stack; only the sponsored kind is limited to one at a time. */
  const plain = new Set<HTMLElement>();

  function dismissPlain(card: HTMLElement): void {
    if (!plain.delete(card)) return;

    card.style.willChange = "transform, opacity";
    card.dataset["state"] = "exiting";
    window.setTimeout(() => card.remove(), EXIT_MS);
  }

  return {
    show(notification: Notification): void {
      const card = document.createElement("article");
      card.className = "toast";
      card.dataset["state"] = "entering";
      if (notification.tone !== undefined) card.dataset["tone"] = notification.tone;
      card.style.willChange = "transform, opacity";
      card.setAttribute("role", "status");

      const content = document.createElement("div");
      content.className = "toast-content";

      const title = document.createElement("p");
      title.className = "toast-title";
      title.textContent = notification.title;
      content.append(title);

      if (notification.body !== undefined) {
        const body = document.createElement("p");
        body.className = "toast-body";
        body.textContent = notification.body;
        content.append(body);
      }

      if (notification.actions !== undefined && notification.actions.length > 0) {
        const row = document.createElement("div");
        row.className = "toast-actions";

        for (const action of notification.actions) {
          const button = document.createElement("button");
          button.className = "ghost-button";
          button.type = "button";
          button.textContent = action.label;
          button.addEventListener("click", () => {
            action.run();
            dismissPlain(card);
          });
          row.append(button);
        }

        content.append(row);
      }

      const close = iconButton("Dismiss", ICON.close, "toast-close");
      close.addEventListener("click", () => dismissPlain(card));

      card.append(content, close);
      host.append(card);
      plain.add(card);

      // Same two-frame dance as the sponsored kind, and for the same reason.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          card.dataset["state"] = "entered";
          window.setTimeout(() => {
            card.style.willChange = "auto";
          }, ENTER_MS);
        });
      });

      if (notification.autoDismissMs !== undefined) {
        window.setTimeout(() => dismissPlain(card), notification.autoDismissMs);
      }
    },

    showSponsored(toast: SponsoredToast): void {
      // One sponsored toast at a time. Replacing a live one would cost the user the
      // impression they were part way through earning.
      if (live !== null) return;

      const card = document.createElement("article");
      card.className = "toast toast-sponsored";
      card.dataset["state"] = "entering";
      card.style.willChange = "transform, opacity";
      card.setAttribute("role", "complementary");
      card.setAttribute("aria-label", `Sponsored message from ${toast.advertiser}`);

      const logo = document.createElement("div");
      logo.className = "toast-logo";
      if (toast.logoDataUrl !== null) {
        const img = document.createElement("img");
        // Always a data: URL. The bytes were fetched and cached by the main process, so
        // no request ever reaches an advertiser from here (§1).
        img.src = toast.logoDataUrl;
        img.alt = "";
        logo.append(img);
      } else {
        logo.textContent = toast.advertiser.slice(0, 1).toUpperCase();
      }

      const content = document.createElement("div");
      content.className = "toast-content";

      const label = document.createElement("span");
      label.className = "toast-sponsored-label";
      label.textContent = "Sponsored";

      const title = document.createElement("p");
      title.className = "toast-title";
      title.textContent = `${toast.advertiser} — ${toast.headline}`;

      content.append(label, title);

      if (toast.body !== null) {
        const body = document.createElement("p");
        body.className = "toast-body";
        body.textContent = toast.body;
        content.append(body);
      }

      const close = iconButton("Dismiss", ICON.close, "toast-close");
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        teardown(toast.creativeId, true);
      });

      card.append(logo, content, close);

      card.addEventListener("click", () => {
        window.adcode.ads.clicked(toast.creativeId);
        teardown(toast.creativeId, false);
      });

      // §1's 8s auto-dismiss, with the timer pausing on hover.
      let timerId: number | undefined;
      let remaining = toast.autoDismissMs;
      let startedAt = Date.now();

      const clearTimer = (): void => {
        if (timerId !== undefined) window.clearTimeout(timerId);
        timerId = undefined;
      };

      const arm = (): void => {
        startedAt = Date.now();
        timerId = window.setTimeout(() => teardown(toast.creativeId, true), remaining);
      };

      card.addEventListener("mouseenter", () => {
        clearTimer();
        remaining = Math.max(0, remaining - (Date.now() - startedAt));
      });

      card.addEventListener("mouseleave", () => {
        if (live !== null && live.creativeId === toast.creativeId && remaining > 0) arm();
      });

      host.append(card);

      // Two frames: one for the element to be laid out at its offscreen start position,
      // one for the transition to have something to animate from. Without this the
      // browser coalesces both states and the toast simply appears.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          card.dataset["state"] = "entered";

          window.setTimeout(() => {
            card.style.willChange = "auto";
            // Reporting paint is what lets the ad client count the impression at all -
            // it is one of the three conditions §1 requires, and the renderer is the
            // only place that knows it.
            window.adcode.ads.painted(toast.creativeId);
          }, ENTER_MS);
        });
      });

      arm();
      live = { element: card, creativeId: toast.creativeId, clearTimer };
    },

    dismissAll(): void {
      if (live !== null) teardown(live.creativeId, true);
      for (const card of [...plain]) dismissPlain(card);
    },
  };
}
