/**
 * "Sponsored cards are on" - said once, in the corner, after 2.5.1 turns them on.
 *
 * ADCode 2.5.1 turns on sponsored cards under AI replies and partner notifications for
 * everybody who has not switched sponsored messages off (the version 3 settings migration in
 * `@adcode/settings`). Both send something to an outside company - the exchange, or the
 * names of open languages - so the person is told once, plainly, what goes where, with
 * **Turn off** one click away and nothing to accept. The card is in the pin card's family
 * (`onboarding/pinPromptCard.ts`): easy to ignore, never a modal, never over a release note.
 *
 * Shown once per profile. "Seen" is recorded the moment it is drawn: somebody who quits with
 * it on screen has been told, and a notice repeated every launch is nagging.
 */
import { reveal } from "../motion.ts";
import { ICON, iconButton } from "../workbench/icons.ts";

export const AD_PARTNER_NOTICE_KEY = "adcode.notice.adPartners.v1";
export const AD_PARTNER_SETTINGS = ["adcode.ads.chatSponsored", "adcode.ads.partnerNotifications"] as const;
export const AD_PARTNER_PRIVACY_URL = "https://adcode.bluethenics.com/privacy#sponsored-cards";

const ENTER_MS = 220;
const EXIT_MS = 160;
const CONFIRM_MS = 2_600;
/**
 * While another card holds the corner, look again this often, for up to ten minutes. Short,
 * so the notice follows the pin card closely instead of arriving mid-task a minute later.
 */
const RETRY_MS = 5_000;
const MAX_TRIES = 120;

export const AD_PARTNER_NOTICE = {
  badge: "Ads",
  title: "Sponsored cards that match your chats",
  body:
    "ADCode now shows one sponsored card under some AI replies, picked for that conversation, and lets our ad partner fill a sponsored message when no ADCode advertiser has one. " +
    "Cards send your message and the reply to Zeekend, then Imprezia. Partner messages send only the names of the languages you have open. Nothing else from your project.",
  link: "What is sent",
  turnOff: "Turn off",
  settings: "Settings",
  keep: "OK",
  turnedOff: "Off. Turn them back on in Settings > Ads.",
} as const;

/** Whether to tell this person: sponsored messages on, one of the two on, not told before. */
export function shouldShowAdPartnerNotice(values: Readonly<Record<string, unknown>>, seen: boolean): boolean {
  if (seen) return false;
  if (values["adcode.ads.enabled"] === false) return false;
  return AD_PARTNER_SETTINGS.some((id) => values[id] === true);
}

export interface AdPartnerNoticeDeps {
  readonly read: () => Promise<Record<string, unknown>>;
  readonly write: (id: string, value: boolean) => Promise<unknown>;
  readonly openSetting: (id: string) => void;
}

function wasSeen(): boolean {
  try { return localStorage.getItem(AD_PARTNER_NOTICE_KEY) !== null; } catch { return false; }
}

function markSeen(): void {
  try { localStorage.setItem(AD_PARTNER_NOTICE_KEY, String(Date.now())); } catch { /* Storage off: at worst, told once more. */ }
}

export function createAdPartnerNotice(host: HTMLElement, deps: AdPartnerNoticeDeps): { offer(): void } {
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
    const copy = AD_PARTNER_NOTICE;
    const card = document.createElement("section");
    card.className = "pin-card ad-partner-card";
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
    body.textContent = `${copy.body} `;
    const link = document.createElement("a");
    link.href = AD_PARTNER_PRIVACY_URL;
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
      void Promise.all(AD_PARTNER_SETTINGS.map((id) => deps.write(id, false))).then(() => {
        status.textContent = copy.turnedOff;
        status.hidden = false;
        // Cards already under replies go too: the chat removes them when the setting changes.
        window.setTimeout(close, CONFIRM_MS);
      }, () => { off.disabled = false; });
    });

    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "pin-card-later";
    settings.textContent = copy.settings;
    settings.addEventListener("click", () => {
      deps.openSetting(AD_PARTNER_SETTINGS[0]);
      close();
    });

    const keep = document.createElement("button");
    keep.type = "button";
    keep.className = "pin-card-primary";
    keep.textContent = copy.keep;
    keep.addEventListener("click", close);

    actions.append(off, settings, keep);
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
      if (told || live !== null || !shouldShowAdPartnerNotice(values, wasSeen())) return;
      // A release note or the pin question owns the corner when it is there: come back later.
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
