/**
 * The one card ADCode is allowed to show without being asked.
 *
 * Every rule about whether it appears lives in `@adcode/release` and is decided by a pure
 * function; this file's only job is to know what the user is doing right now and to draw
 * the thing. The moment is assembled from four signals:
 *
 *   **Typing** - any keystroke anywhere in the window, watched in the capture phase so
 *   the editor and the terminal are both covered without either knowing about this.
 *
 *   **A command running** - bytes arriving from a terminal. An idle shell prints nothing,
 *   so output is a good proxy for "something is happening that the user is watching".
 *
 *   **Debugging** - pushed in from the debug subscription, which is the only place that
 *   knows a program is stopped somewhere.
 *
 *   **Focus** - the window being in front at all.
 *
 * Because a busy moment is a "not yet" rather than a "no", the decision is retried on a
 * slow timer. The card waits for a gap instead of giving up, and the version is written
 * off as seen the instant it is drawn - somebody who force-quits while it is up has still
 * seen it, and replaying it would be the exact behaviour this is built to avoid.
 */
import { decideAnnouncement, versionsToMarkSeen } from "@adcode/release";
import type { AnnounceState, Moment, Release } from "@adcode/release";
import type { ReleaseAnnouncement, ReleaseNote } from "../../shared/api.ts";
import { ICON, iconButton } from "../workbench/icons.ts";

/** A keystroke counts as "still typing" for this long afterwards. */
const TYPING_WINDOW_MS = 4_000;
/** Terminal output counts as "still running" for this long afterwards. */
const OUTPUT_WINDOW_MS = 3_000;
/** How often a pending note re-checks whether the moment has become a quiet one. */
const RETRY_MS = 20_000;

const ENTER_MS = 220;
const EXIT_MS = 160;

export interface ReleaseNoticeDeps {
  readonly host: HTMLElement;
  /** The user's setting. Read at decision time, so toggling it takes effect at once. */
  readonly enabled: () => boolean;
  /** Open the full changelog - the Help window, not a browser. */
  readonly openWhatsNew: (announcement: ReleaseAnnouncement) => void;
}

export interface ReleaseNotice {
  /** The debug subscription calls this; nothing else knows a program is stopped. */
  setDebugActive(active: boolean): void;
  /** Main pushed a fresh list of published notes. */
  offer(announcement: ReleaseAnnouncement): void;
  dismiss(): void;
}

function paragraphs(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 0)
    .slice(0, 4);
}

export function createReleaseNotice(deps: ReleaseNoticeDeps): ReleaseNotice {
  let lastKeyAt = 0;
  let lastOutputAt = 0;
  let debugActive = false;

  let pending: ReleaseAnnouncement | null = null;
  let live: HTMLElement | null = null;
  let retry: number | null = null;

  document.addEventListener(
    "keydown",
    () => {
      lastKeyAt = Date.now();
    },
    { capture: true, passive: true },
  );

  window.adcode.terminal.onData(() => {
    lastOutputAt = Date.now();
  });

  function moment(): Moment {
    const now = Date.now();
    return {
      windowFocused: document.hasFocus(),
      typing: now - lastKeyAt < TYPING_WINDOW_MS,
      commandRunning: now - lastOutputAt < OUTPUT_WINDOW_MS,
      debugActive,
    };
  }

  function stateFrom(announcement: ReleaseAnnouncement): AnnounceState {
    return {
      releases: announcement.releases as readonly Release[],
      currentVersion: announcement.currentVersion,
      seenVersions: new Set(announcement.seenVersions),
      hasRunBefore: announcement.hasRunBefore,
      enabled: deps.enabled(),
      moment: moment(),
    };
  }

  function stopRetrying(): void {
    if (retry !== null) {
      window.clearInterval(retry);
      retry = null;
    }
  }

  function close(): void {
    const element = live;
    if (element === null) return;
    live = null;

    element.style.willChange = "transform, opacity";
    element.dataset["state"] = "exiting";
    window.setTimeout(() => {
      element.remove();
    }, EXIT_MS);
  }

  function draw(announcement: ReleaseAnnouncement, release: ReleaseNote): void {
    close();

    const card = document.createElement("section");
    card.className = "release-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", `What's new in ADCode ${release.version}`);
    if (release.critical) card.dataset["critical"] = "true";

    const head = document.createElement("header");
    head.className = "release-card-head";

    const badge = document.createElement("span");
    badge.className = "release-card-badge";
    badge.textContent = release.critical ? "Important update" : `Version ${release.version}`;
    head.append(badge);

    const dismiss = iconButton("Dismiss", ICON.close, "icon-button release-card-dismiss");
    dismiss.addEventListener("click", () => {
      close();
      stopRetrying();
    });
    head.append(dismiss);
    card.append(head);

    const title = document.createElement("h2");
    title.className = "release-card-title";
    title.textContent = release.title;
    card.append(title);

    if (release.highlights.length > 0) {
      const list = document.createElement("ul");
      list.className = "release-card-highlights";
      for (const highlight of release.highlights.slice(0, 4)) {
        const item = document.createElement("li");
        item.textContent = highlight;
        list.append(item);
      }
      card.append(list);
    } else {
      for (const part of paragraphs(release.body)) {
        const line = document.createElement("p");
        line.className = "release-card-body";
        line.textContent = part;
        card.append(line);
      }
    }

    const actions = document.createElement("div");
    actions.className = "release-card-actions";

    const more = document.createElement("button");
    more.type = "button";
    more.className = "release-card-more";
    more.textContent = "See all changes";
    more.addEventListener("click", () => {
      close();
      stopRetrying();
      deps.openWhatsNew(announcement);
    });

    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "release-card-ok";
    ok.textContent = "Got it";
    ok.addEventListener("click", () => {
      close();
      stopRetrying();
    });

    actions.append(more, ok);
    card.append(actions);

    deps.host.append(card);
    live = card;

    // Forced reflow rather than a frame callback: the starting state has to be committed
    // before the open state is set, or the browser collapses both into one paint and the
    // card appears with no transition at all.
    void card.offsetHeight;
    card.dataset["state"] = "open";
    window.setTimeout(() => {
      card.style.willChange = "";
    }, ENTER_MS);

    /*
     * Marked seen on display, not on dismissal. See the note at the top of this file, and
     * note it marks the older unseen versions too: skipping three releases earns one card,
     * not three in a row.
     */
    const marked = versionsToMarkSeen(stateFrom(announcement), release as Release);
    void window.adcode.releases.markSeen(marked);
    pending = { ...announcement, seenVersions: [...announcement.seenVersions, ...marked] };
  }

  function attempt(): void {
    if (pending === null) return;

    const decision = decideAnnouncement(stateFrom(pending));

    if (decision.show) {
      draw(pending, decision.release);
      stopRetrying();
      return;
    }

    /*
     * "Busy" is the only reason worth waiting out. Every other one - switched off, already
     * seen, nothing to say - is settled, and a timer that keeps re-asking would be a timer
     * that never stops.
     */
    if (decision.reason === "busy") {
      if (retry === null) retry = window.setInterval(attempt, RETRY_MS);
    } else {
      pending = null;
      stopRetrying();
    }
  }

  return {
    setDebugActive(active: boolean): void {
      debugActive = active;
    },

    offer(announcement: ReleaseAnnouncement): void {
      pending = announcement;
      attempt();
    },

    dismiss(): void {
      close();
      stopRetrying();
    },
  };
}
