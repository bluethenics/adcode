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
import type { PartnerToast, SponsoredToast } from "../../shared/api.ts";
import { sponsoredReplyFrame } from "../ai/sponsoredReply.ts";
import { reveal } from "../motion.ts";
import { ICON, createIcon, iconButton } from "../workbench/icons.ts";

const ENTER_MS = 220;
const EXIT_MS = 160;

/** An ordinary notification: the editor talking to the user about the user's own work. */
export interface Notification {
  readonly title: string;
  readonly body?: string;
  readonly actions?: ReadonlyArray<{ readonly label: string; readonly run: () => void }>;
  /** An https picture above the text, such as a service notice's. */
  readonly image?: { readonly src: string; readonly alt: string };
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
  /** The ad partner's card, in a slot no direct campaign filled. Same one-at-a-time slot. */
  showPartner(toast: PartnerToast): void;
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

/**
 * A picture that never breaks the card: no referrer leaves for the image host, and an
 * address that fails to load removes itself rather than leaving a broken-image frame.
 */
function notificationImage(image: { readonly src: string; readonly alt: string }, className: string): HTMLImageElement {
  const img = document.createElement("img");
  img.className = className;
  img.alt = image.alt;
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.addEventListener("error", () => img.remove(), { once: true });
  img.src = image.src;
  return img;
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
      if (entry.notification.image) item.append(notificationImage(entry.notification.image, "notification-inbox-image"));
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
  // A partner card holds the same slot but is not one of the ad client's creatives, so its
  // dismissal is never reported as one.
  let live: { element: HTMLElement; creativeId: string; clearTimer: () => void; partner?: boolean } | null = null;

  function teardown(creativeId: string, notify: boolean): void {
    if (live === null || live.creativeId !== creativeId) return;

    const { element, clearTimer, partner } = live;
    live = null;
    clearTimer();

    element.style.willChange = "transform, opacity";
    element.dataset["state"] = "exiting";
    removeAfterExit(element);

    if (notify && partner !== true) window.adcode.ads.dismissed(creativeId);
  }

  /**
   * §1's auto-dismiss for a sponsored card, drawn by its timer bar: it drains over `ms` and
   * holds while the pointer is on the card or keyboard focus is inside it - somebody reading,
   * or tabbing to a button, should not watch it vanish.
   */
  function dismissTimer(card: HTMLElement, id: string, ms: number): { arm: () => void; clearTimer: () => void } {
    let timerId: number | undefined;
    let remaining = ms;
    let startedAt = Date.now();
    const clearTimer = (): void => {
      if (timerId !== undefined) window.clearTimeout(timerId);
      timerId = undefined;
    };
    const arm = (): void => {
      startedAt = Date.now();
      timerId = window.setTimeout(() => teardown(id, true), remaining);
    };
    let hovered = false;
    let focused = false;
    let paused = false;
    const sync = (): void => {
      const held = hovered || focused;
      if (held && !paused) {
        paused = true;
        clearTimer();
        remaining = Math.max(0, remaining - (Date.now() - startedAt));
        card.dataset["paused"] = "true";
      } else if (!held && paused) {
        paused = false;
        delete card.dataset["paused"];
        if (live !== null && live.creativeId === id && remaining > 0) arm();
      }
    };
    card.addEventListener("mouseenter", () => { hovered = true; sync(); });
    card.addEventListener("mouseleave", () => { hovered = false; sync(); });
    card.addEventListener("focusin", () => { focused = true; sync(); });
    card.addEventListener("focusout", (event) => {
      if (event.relatedTarget instanceof Node && card.contains(event.relatedTarget)) return;
      focused = false;
      sync();
    });
    return { arm, clearTimer };
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

      if (notification.image !== undefined) content.append(notificationImage(notification.image, "toast-image"));

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

      // Why the card is worth a glance: the same promise the welcome makes, and true - half
      // of what a card earns is credited to the person who sees it.
      const earn = document.createElement("span");
      earn.className = "toast-sponsored-earn";
      earn.textContent = "Half of what it earns is yours";

      const meta = document.createElement("div");
      meta.className = "toast-sponsored-meta";
      meta.append(label, earn);

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
      const actions = document.createElement("div");
      actions.className = "toast-sponsored-actions";
      actions.append(visit);
      content.append(actions);

      const close = iconButton("Dismiss", ICON.close, "toast-close");
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        teardown(toast.creativeId, true);
      });

      // How long the card stays, drawn: it drains over the auto-dismiss time and stops while
      // the pointer or keyboard focus is on the card, exactly as the timer below does.
      const timer = document.createElement("div");
      timer.className = "toast-sponsored-timer";
      timer.setAttribute("aria-hidden", "true");
      card.style.setProperty("--toast-duration", `${String(toast.autoDismissMs)}ms`);

      card.append(logo, meta, close, content, timer);

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
      const { arm, clearTimer } = dismissTimer(card, toast.creativeId, toast.autoDismissMs);

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

    showPartner(toast: PartnerToast): void {
      const answer = (outcome: "shown" | "empty"): void => window.adcode.ads.partnerResult(toast.id, outcome);
      // One sponsored card at a time; a busy slot is an empty answer, and the slot goes back.
      if (live !== null) { answer("empty"); return; }

      const card = document.createElement("article");
      card.className = "toast toast-partner";
      card.dataset["state"] = "entering";
      card.style.willChange = "transform, opacity";
      card.setAttribute("role", "complementary");
      card.setAttribute("aria-label", "Sponsored message from ADCode's ad partner");

      // No box, no header, no drawn countdown: the card arrives on its own, as it does under a
      // chat reply, and its own "Ad" label is the disclosure. No earnings line either: partner
      // cards are not credited to anyone's balance yet. The close button sits outside the
      // card's edge, so nothing of ours ever covers Imprezia's card.
      const close = iconButton("Dismiss", ICON.close, "toast-close");
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        teardown(toast.id, false);
      });

      const content = document.createElement("div");
      content.className = "toast-content";

      const { arm, clearTimer } = dismissTimer(card, toast.id, toast.autoDismissMs);
      let settled = false;
      // A frame that never answers is an empty slot, not a card stuck off-screen.
      const giveUp = window.setTimeout(() => settle("empty"), 15_000);
      function settle(outcome: "shown" | "empty"): void {
        if (settled || live === null || live.creativeId !== toast.id) return;
        settled = true;
        window.clearTimeout(giveUp);
        answer(outcome);
        if (outcome === "empty") {
          live = null;
          card.remove();
          return;
        }
        // Only now does it come in: the card arrives with something in it, never empty.
        reveal(card, "entered");
        window.setTimeout(() => { card.style.willChange = "auto"; }, ENTER_MS);
        arm();
      }

      // The card is the same walled-off page as under a chat reply: Imprezia's SDK runs on
      // adcode.bluethenics.com, never in this window, and clicks open the browser.
      const frame = sponsoredReplyFrame(
        { request: toast.request, response: toast.response, sessionId: toast.sessionId, theme: toast.theme, layout: "notification" },
        undefined,
        settle,
        (size) => {
          // The frame keeps its width - the SDK lays its card out for it, and narrowing the
          // frame would make the card narrower too. The see-through space to the card's right
          // goes past the window's edge instead, so the card itself ends at the edge.
          const gap = size.right === null ? 0 : Math.max(0, (frame?.clientWidth ?? 0) - size.right);
          card.style.marginRight = `${String(-gap)}px`;
          if (size.left !== null) close.style.left = `${String(size.left - 32)}px`;
          if (size.top !== null) close.style.top = `${String(size.top)}px`;
        },
      );
      if (frame === null) { window.clearTimeout(giveUp); answer("empty"); return; }
      frame.classList.add("toast-partner-frame");
      frame.loading = "eager";
      content.append(frame);
      card.append(close, content);

      live = { element: card, creativeId: toast.id, clearTimer: () => { clearTimer(); window.clearTimeout(giveUp); }, partner: true };
      // In the layer but still off-screen (`entering`), so the frame loads before it shows.
      host.append(card);
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
