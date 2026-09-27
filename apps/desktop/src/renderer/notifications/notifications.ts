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
import { reveal } from "../motion.ts";
import { ICON, createIcon, iconButton } from "../workbench/icons.ts";

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
   * Visual weight. `success` confirms something finished; `error` reports something
   * failed; `warning` is for something currently wrong that the reader may need to
   * work around; the default reads as an FYI.
   */
  readonly tone?: "info" | "success" | "warning" | "error";
}

export interface NotificationCentre {
  show(notification: Notification): void;
  showSponsored(toast: SponsoredToast): void;
  dismissAll(): void;
  toggleInbox(): void;
  onUnreadChanged(listener: (count: number) => void): () => void;
}

/**
 * Remove the node when its exit transition actually finishes, not when a constant says it
 * should have.
 *
 * `EXIT_MS` mirrors `--duration-exit`, and the two drift the moment either side is edited.
 * They already disagree: under `prefers-reduced-motion` tokens.css clamps every transition
 * to 100ms, so a fixed 160ms wait leaves a finished, invisible toast in the layer for 60ms
 * of dead time. `transitionend` is the honest signal.
 *
 * The timeout stays as a floor, not a schedule: `transitionend` never fires if the element
 * is display-none by then, or if the exit resolves to no change at all.
 */
function removeAfterExit(element: HTMLElement): void {
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    element.remove();
  };

  // Child transitions bubble to here; only the card's own exit should retire the card.
  element.addEventListener("transitionend", (event) => {
    if (event.target === element) finish();
  });
  window.setTimeout(finish, EXIT_MS + 60);
}

export function createNotificationCentre(host: HTMLElement): NotificationCentre {
  type InboxEntry = { notification: Notification; time: number; read: boolean };
  const inbox: InboxEntry[] = [];
  const unreadListeners = new Set<(count: number) => void>();
  const inboxPanel = document.createElement("section");
  inboxPanel.className = "notification-inbox";
  inboxPanel.hidden = true;
  inboxPanel.setAttribute("role", "dialog");
  inboxPanel.setAttribute("aria-label", "Notifications");
  inboxPanel.setAttribute("aria-modal", "false");
  inboxPanel.tabIndex = -1;
  const inboxHeader = document.createElement("header");
  inboxHeader.className = "notification-inbox-header";
  const inboxTitle = document.createElement("h2");
  inboxTitle.textContent = "Notifications";
  const inboxClear = document.createElement("button");
  inboxClear.type = "button";
  inboxClear.className = "notification-inbox-clear";
  inboxClear.textContent = "Clear all";
  const inboxClose = iconButton("Close notifications", ICON.close, "notification-inbox-close");
  inboxHeader.append(inboxTitle, inboxClear, inboxClose);
  const inboxList = document.createElement("div");
  inboxList.className = "notification-inbox-list";
  inboxPanel.append(inboxHeader, inboxList);
  document.body.append(inboxPanel);
  let returnFocus: HTMLElement | null = null;
  const unreadCount = (): number => inbox.reduce((count, entry) => count + Number(!entry.read), 0);
  const notifyUnread = (): void => {
    const count = unreadCount();
    for (const listener of unreadListeners) listener(count);
  };
  const renderInbox = (): void => {
    inboxList.replaceChildren();
    inboxClear.hidden = inbox.length === 0;
    if (inbox.length === 0) {
      const empty = document.createElement("p");
      empty.className = "notification-inbox-empty";
      empty.textContent = "You're all caught up. Updates about your work will appear here.";
      inboxList.append(empty);
      return;
    }
    for (const entry of inbox) {
      const item = document.createElement("article");
      item.className = "notification-inbox-item";
      item.dataset["tone"] = entry.notification.tone ?? "info";
      const time = document.createElement("time");
      time.dateTime = new Date(entry.time).toISOString();
      time.textContent = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(entry.time);
      const title = document.createElement("h3");
      title.textContent = entry.notification.title;
      item.append(time, title);
      if (entry.notification.body) {
        const body = document.createElement("p");
        body.textContent = entry.notification.body;
        item.append(body);
      }
      if (entry.notification.actions?.length) {
        const actions = document.createElement("div");
        actions.className = "notification-inbox-actions";
        for (const action of entry.notification.actions) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = action.label;
          button.addEventListener("click", () => {
            action.run();
            closeInbox();
          });
          actions.append(button);
        }
        item.append(actions);
      }
      inboxList.append(item);
    }
  };
  function closeInbox(): void {
    if (inboxPanel.hidden) return;
    inboxPanel.hidden = true;
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  }
  function toggleInbox(): void {
    if (!inboxPanel.hidden) { closeInbox(); return; }
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inboxPanel.hidden = false;
    for (const entry of inbox) entry.read = true;
    notifyUnread();
    renderInbox();
    inboxPanel.focus({ preventScroll: true });
  }
  inboxClose.addEventListener("click", closeInbox);
  inboxClear.addEventListener("click", () => { inbox.length = 0; renderInbox(); notifyUnread(); });
  inboxPanel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.stopPropagation(); closeInbox(); }
  });
  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!inboxPanel.hidden && target instanceof Node && !inboxPanel.contains(target) &&
      !(target instanceof Element && target.closest(".vibe-notifications-button"))) closeInbox();
  });
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
    removeAfterExit(element);

    if (notify) window.adcode.ads.dismissed(creativeId);
  }

  /** Plain toasts stack; only the sponsored kind is limited to one at a time. */
  const plain = new Set<HTMLElement>();
  const MAX_PLAIN_TOASTS = 4;

  function dismissPlain(card: HTMLElement): void {
    if (!plain.delete(card)) return;

    card.style.willChange = "transform, opacity";
    card.dataset["state"] = "exiting";
    removeAfterExit(card);
  }

  return {
    show(notification: Notification): void {
      inbox.unshift({ notification, time: Date.now(), read: !inboxPanel.hidden });
      if (inbox.length > 50) inbox.length = 50;
      notifyUnread();
      if (!inboxPanel.hidden) renderInbox();
      const card = document.createElement("article");
      card.className = "toast";
      card.dataset["state"] = "entering";
      if (notification.tone !== undefined) card.dataset["tone"] = notification.tone;
      card.style.willChange = "transform, opacity";
      card.setAttribute("role", notification.tone === "error" ? "alert" : "status");

      const marker = document.createElement("span");
      marker.className = "toast-marker";
      marker.setAttribute("aria-hidden", "true");
      marker.append(createIcon(notification.tone === "error" ? ICON.severityError :
        notification.tone === "warning" ? ICON.severityWarning :
          notification.tone === "success" ? "M3.5 8l3 3 6-6" : ICON.severityInfo));

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

      card.append(marker, content, close);
      host.append(card);
      plain.add(card);
      // Uncapped stacking buries the editor under a column of stale FYIs. Evict the
      // oldest plain toast once the cap is exceeded; sponsored impressions are never
      // evicted here because cutting one short would cost earned credit.
      if (plain.size > MAX_PLAIN_TOASTS) {
        const oldest = plain.values().next().value;
        if (oldest !== undefined && oldest !== card) dismissPlain(oldest);
      }

      // Same synchronous flush as the sponsored kind, and for the same reason.
      reveal(card, "entered");
      window.setTimeout(() => {
        card.style.willChange = "auto";
      }, ENTER_MS);

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
      const advertiser = document.createElement("span");
      advertiser.className = "toast-advertiser";
      advertiser.textContent = toast.advertiser;
      const headline = document.createElement("span");
      headline.className = "toast-headline";
      headline.textContent = toast.headline;
      title.append(advertiser, " ", headline);

      content.append(title);

      if (toast.body !== null) {
        const body = document.createElement("p");
        body.className = "toast-body";
        body.textContent = toast.body;
        content.append(body);
      }

      const visit = document.createElement("button");
      visit.type = "button";
      visit.className = "toast-sponsored-cta";
      visit.setAttribute("aria-label", `Visit ${toast.advertiser}'s website`);
      visit.append("Visit site", createIcon(ICON.external));
      content.append(visit);

      const close = iconButton("Dismiss", ICON.close, "toast-close");
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        teardown(toast.creativeId, true);
      });

      card.append(logo, label, close, content);

      const openSponsor = (): void => {
        window.adcode.ads.clicked(toast.creativeId);
        teardown(toast.creativeId, false);
      };
      card.addEventListener("click", openSponsor);
      visit.addEventListener("click", (event) => {
        event.stopPropagation();
        openSponsor();
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

      // Always the notification layer, which is on the right in both windows. Vibe used to
      // park the card in its left sidebar; it now sits top-right there (vibeSidebar.css),
      // clear of the composer, like every other notification in that window.
      host.append(card);

      // Lay the card out at its offscreen start position, then give the transition
      // something to animate from. Without the flush the browser coalesces both states
      // and the toast simply appears. See `reveal` for why this is not a rAF.
      reveal(card, "entered");

      window.setTimeout(() => {
        card.style.willChange = "auto";
        // Reporting paint is what lets the ad client count the impression at all -
        // it is one of the three conditions §1 requires, and the renderer is the
        // only place that knows it.
        window.adcode.ads.painted(toast.creativeId);
      }, ENTER_MS);

      arm();
      live = { element: card, creativeId: toast.creativeId, clearTimer };
    },

    dismissAll(): void {
      if (live !== null) teardown(live.creativeId, true);
      for (const card of [...plain]) dismissPlain(card);
    },
    toggleInbox,
    onUnreadChanged(listener): () => void {
      unreadListeners.add(listener);
      listener(unreadCount());
      return () => unreadListeners.delete(listener);
    },
  };
}
