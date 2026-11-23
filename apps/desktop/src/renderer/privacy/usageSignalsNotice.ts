/**
 * "Help improve ADCode now also says what went wrong" - said once, in the corner, after 2.6.3.
 *
 * Until 2.6.3 the Help improve ADCode setting sent daily feature counts and promised they were
 * never tied to your account. 2.6.3 adds retention signals - a failed AI request, a limit, a
 * crash, how far a first session got - and those are linked to the account, so the team can see
 * why a person stopped coming back. The setting stays on for people who had it on, so they are
 * told once, plainly, with Turn off one click away and nothing to accept. Same card family as
 * the 2.5.1 sponsored-cards notice (`ads/adPartnerNotice.ts`): never a modal, never over another
 * card, and recorded as seen the moment it is drawn.
 */
import { reveal } from "../motion.ts";
import { ICON, iconButton } from "../workbench/icons.ts";

export const USAGE_SIGNALS_NOTICE_KEY = "adcode.notice.usageSignals.v1";
export const USAGE_SIGNALS_SETTING = "adcode.privacy.usageStats";
export const USAGE_SIGNALS_PRIVACY_URL = "https://adcode.bluethenics.com/privacy#usage-statistics";

const ENTER_MS = 220;
const EXIT_MS = 160;
const CONFIRM_MS = 2_600;
const RETRY_MS = 5_000;
const MAX_TRIES = 120;

export const USAGE_SIGNALS_NOTICE = {
  badge: "Privacy",
  title: "Help improve ADCode now tells us what went wrong",
  body:
    "Besides counting which features you use, it now sends what went wrong for you - a failed AI request, a usage limit, a crash, how far a first session got - linked to your account, so we can find why people give up and fix it. " +
    "Only fixed names, codes, counts and timings are sent: never your code, prompts, files, paths or chats.",
  /** For a phone: the same disclosure - what is sent, that it is linked to the account, what never is - in fewer words. */
  bodyCompact:
    "It now also sends what went wrong - failed AI requests, limits, crashes - linked to your account. Only names, codes, counts and timings: never your code, prompts, files, paths or chats.",
  link: "What is sent",
  turnOff: "Turn off",
  keep: "Keep on",
  turnedOff: "Off. Nothing is counted or sent. Turn it back on in Settings > Privacy.",
} as const;

/** Tell this person once, and only while the setting is on. */
export function shouldShowUsageSignalsNotice(values: Readonly<Record<string, unknown>>, seen: boolean): boolean {
  return !seen && values[USAGE_SIGNALS_SETTING] !== false;
}

export interface UsageSignalsNoticeDeps {
  readonly read: () => Promise<Record<string, unknown>>;
  readonly write: (id: string, value: boolean) => Promise<unknown>;
}

function wasSeen(): boolean {
  try { return localStorage.getItem(USAGE_SIGNALS_NOTICE_KEY) !== null; } catch { return false; }
}

function markSeen(): void {
  try { localStorage.setItem(USAGE_SIGNALS_NOTICE_KEY, String(Date.now())); } catch { /* Storage off: at worst, told once more. */ }
}

export function createUsageSignalsNotice(host: HTMLElement, deps: UsageSignalsNoticeDeps): { offer(): void } {
  let live: HTMLElement | null = null;
  let told = false;
  let tries = 0;

  function close(): void {
    const element = live;
    if (element === null) return;
    live = null;
    element.style.willChange = "transform, opacity";
    reveal(element, "exiting");
    window.setTimeout(() => element.remove(), EXIT_MS);
  }

  function draw(): void {
    const copy = USAGE_SIGNALS_NOTICE;
    const card = document.createElement("section");
    card.className = "pin-card usage-signals-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", copy.title);

    const head = document.createElement("header");
    head.className = "pin-card-head";
    const badge = document.createElement("span");
    badge.className = "pin-card-badge";
    badge.textContent = copy.badge;
    const dismiss = iconButton("Dismiss", ICON.close, "icon-button pin-card-dismiss");
    dismiss.addEventListener("click", close);
    head.append(badge, dismiss);

    const title = document.createElement("h2");
    title.className = "pin-card-title";
    title.textContent = copy.title;

    // The disclosure comes before every button, so nothing can be kept on unread.
    const body = document.createElement("p");
    body.className = "pin-card-body";
    body.textContent = `${window.matchMedia("(max-width: 600px)").matches ? copy.bodyCompact : copy.body} `;
    const link = document.createElement("a");
    link.href = USAGE_SIGNALS_PRIVACY_URL;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = copy.link;
    body.append(link);

    const status = document.createElement("p");
    status.className = "pin-card-status";
    status.hidden = true;
    status.setAttribute("role", "status");

    const actions = document.createElement("div");
    actions.className = "pin-card-actions";

    const off = document.createElement("button");
    off.type = "button";
    off.className = "pin-card-never";
    off.textContent = copy.turnOff;
    off.addEventListener("click", () => {
      off.disabled = true;
      void deps.write(USAGE_SIGNALS_SETTING, false).then(() => {
        status.textContent = copy.turnedOff;
        status.hidden = false;
        window.setTimeout(close, CONFIRM_MS);
      }, () => { off.disabled = false; });
    });

    const keep = document.createElement("button");
    keep.type = "button";
    keep.className = "pin-card-primary";
    keep.textContent = copy.keep;
    keep.addEventListener("click", close);

    actions.append(off, keep);
    card.append(head, title, body, status, actions);
    host.append(card);
    live = card;
    reveal(card, "open");
    window.setTimeout(() => { card.style.willChange = ""; }, ENTER_MS);
    markSeen();
  }

  function attempt(): void {
    if (told || live !== null || wasSeen()) return;
    void deps.read().then((values) => {
      if (told || live !== null || !shouldShowUsageSignalsNotice(values, wasSeen())) return;
      // Another card (a release note, the pin question, the sponsored-cards notice) owns the corner: come back.
      if (document.querySelector(".release-card, .pin-card") !== null) {
        tries += 1;
        if (tries < MAX_TRIES) window.setTimeout(attempt, RETRY_MS);
        return;
      }
      told = true;
      draw();
    }, () => undefined);
  }

  return { offer: attempt };
}
