/**
 * A task paused on an ADCode usage limit, drawn as a card instead of a status line.
 *
 * Reported 2026-10-27: when a limit was reached, the only sign was the grey "is writing"
 * line at the foot of the chat, which read like the assistant was still thinking. The card
 * says what happened, when the task carries on by itself, and what ends the wait sooner.
 *
 * `limitPauseView` is pure, so every wording rule is tested without a DOM.
 */
import { Hourglass } from "lucide";
import { createIcon } from "../workbench/icons.ts";

export type LimitReason = "paid" | "weekly" | "session" | "daily" | "rate" | "upstream";
export interface LimitPause { reason: LimitReason; resumeAt: number; recheckAt: number; buyUrl?: string }
export type LimitAction = "upgrade-plan" | "buy-tokens" | "models";
export interface LimitPauseView { title: string; body: string; resume: string; actions: LimitAction[] }

const REASONS: readonly LimitReason[] = ["paid", "weekly", "session", "daily", "rate", "upstream"];

/** The event arrives over IPC as plain data; anything malformed is simply not a card. */
export function parseLimitPause(raw: unknown): LimitPause | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const reason = value["reason"], resumeAt = value["resumeAt"], recheckAt = value["recheckAt"], buyUrl = value["buyUrl"];
  if (!REASONS.includes(reason as LimitReason) || !Number.isSafeInteger(resumeAt) || !Number.isSafeInteger(recheckAt)) return null;
  return { reason: reason as LimitReason, resumeAt: resumeAt as number, recheckAt: recheckAt as number,
    ...(typeof buyUrl === "string" && /^https:\/\//.test(buyUrl) ? { buyUrl } : {}) };
}

/** "3:45 PM" today, "tomorrow at 3:45 PM", otherwise "Tue, Oct 28, 3:45 PM" - in the person's own clock. */
export function resumeClock(at: number, now: number, locale?: string): string {
  const time = new Date(at).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const day = (ms: number): string => new Date(ms).toDateString();
  if (day(at) === day(now)) return time;
  if (day(at) === day(now + 86_400_000)) return `tomorrow at ${time}`;
  return new Date(at).toLocaleString(locale, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "in 2 h 14 min", "in 40 s" - rounded up, so it never says "in 0 min" while still waiting. */
export function countdown(at: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((at - now) / 1000));
  if (seconds < 60) return seconds <= 1 ? "any moment now" : `in ${seconds} s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (hours < 48) return rest === 0 ? `in ${hours} h` : `in ${hours} h ${rest} min`;
  return `in ${Math.round(hours / 24)} days`;
}

/** "at 3:45 PM", "tomorrow at 3:45 PM", "on Tue, Oct 28, 3:45 PM" - to follow a verb. */
export function resumeWhen(at: number, now: number, locale?: string): string {
  const clock = resumeClock(at, now, locale);
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
  const tomorrow = new Date(at).toDateString() === new Date(now + 86_400_000).toDateString();
  return tomorrow ? clock : sameDay ? `at ${clock}` : `on ${clock}`;
}

export function limitPauseView(pause: LimitPause, now: number, locale?: string): LimitPauseView {
  const until = resumeClock(pause.resumeAt, now, locale);
  const when = `${resumeWhen(pause.resumeAt, now, locale)} (${countdown(pause.resumeAt, now)})`;
  const resume = `Continues automatically ${when} - keep ADCode open.`;
  switch (pause.reason) {
    case "paid":
      return { title: "You've reached today's included AI limit",
        body: `Upgrade your plan or buy tokens to keep going now, or wait until ${until}. This task picks up where it stopped - nothing is lost.`,
        resume, actions: ["upgrade-plan", "buy-tokens", "models"] };
    case "weekly":
    case "session":
    case "daily":
      return { title: pause.reason === "session" ? "You've reached this session's free AI limit" : pause.reason === "weekly" ? "You've reached this week's free AI limit" : "You've reached today's free AI limit",
        body: `Wait until ${until}, or upgrade your plan for more daily AI usage. You can also use your own connected model now. This task picks up where it stopped - nothing is lost.`,
        resume, actions: ["upgrade-plan", "models"] };
    case "upstream":
      return { title: "This model is busy right now",
        body: `Its provider is limiting requests for everyone. Wait until ${until}, or switch to another model to keep going now.`,
        resume: `Tries again automatically ${when}.`, actions: ["models"] };
    case "rate":
      return { title: "Too many AI requests in a minute",
        body: `Your account hit its per-minute request limit. It clears ${resumeWhen(pause.resumeAt, now, locale)}.`,
        resume: `Tries again automatically ${when}.`, actions: ["models"] };
  }
}

/** The card, kept by the chat and refreshed every second while the task waits. */
export interface LimitPauseCard {
  readonly element: HTMLElement;
  show(pause: LimitPause): void;
  hide(): void;
  readonly visible: boolean;
}

export function createLimitPauseCard(run: (action: LimitAction, pause: LimitPause) => void, clock: () => number = Date.now): LimitPauseCard {
  const element = document.createElement("section");
  element.className = "chat-limit";
  element.hidden = true;
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  const icon = document.createElement("span");
  icon.className = "chat-limit-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.append(createIcon(Hourglass));
  const body = document.createElement("div");
  body.className = "chat-limit-body";
  const title = document.createElement("h3");
  title.className = "chat-limit-title";
  const text = document.createElement("p");
  text.className = "chat-limit-text";
  const resume = document.createElement("p");
  resume.className = "chat-limit-resume";
  const actions = document.createElement("div");
  actions.className = "chat-limit-actions";
  body.append(title, text, resume, actions);
  element.append(icon, body);

  let current: LimitPause | null = null;
  let ticker: number | null = null;
  let drawnActions = "";
  const labels: Record<LimitAction, string> = { "upgrade-plan": "Upgrade plan", "buy-tokens": "Buy tokens", models: "Switch model" };

  function paint(): void {
    if (current === null) return;
    const view = limitPauseView(current, clock());
    title.textContent = view.title;
    text.textContent = view.body;
    resume.textContent = view.resume;
    element.dataset["limit"] = current.reason;
    const key = view.actions.join(",");
    if (key === drawnActions) return;
    drawnActions = key;
    actions.replaceChildren(...view.actions.map((action, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `chat-failure-button${index === 0 ? " is-primary" : ""}`;
      button.textContent = labels[action];
      button.addEventListener("click", () => { if (current !== null) run(action, current); });
      return button;
    }));
  }

  return {
    element,
    get visible() { return current !== null; },
    show(pause) {
      current = pause;
      element.hidden = false;
      paint();
      ticker ??= window.setInterval(paint, 1_000);
    },
    hide() {
      current = null;
      element.hidden = true;
      drawnActions = "";
      if (ticker !== null) window.clearInterval(ticker);
      ticker = null;
    },
  };
}
