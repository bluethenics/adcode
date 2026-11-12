/**
 * "When the assistant finishes": the picker, and the countdown that runs before the computer
 * sleeps or shuts down (main/powerAfterTasks.ts decides and acts; this only shows and asks).
 *
 * The countdown is the part that has to be right. It appears over everything, says what will
 * happen in words and as a draining ring, and puts the focus on Cancel - so the one key a
 * person who just walked back to the computer presses, Enter or Escape, stops it. Buck dozes
 * off while it counts.
 */
import type { PowerActionView, PowerStateView } from "../../shared/api.ts";
import { button, el, field, openFormModal } from "../dialogs/formDialog.ts";
import { createAdcodeMascot, type AdcodeMascot } from "../mascot/adcodeMascot.ts";

const LABEL: Record<PowerActionView, string> = {
  nothing: "Do nothing",
  sleep: "Sleep",
  hibernate: "Hibernate",
  shutdown: "Shut down",
  lock: "Lock the screen",
};

const HINT: Record<PowerActionView, string> = {
  nothing: "Stay on, as it always has.",
  sleep: "Low power; wakes in seconds with everything as you left it.",
  hibernate: "Saves the session to disk and powers off. Slower to wake, uses no battery.",
  shutdown: "Saves open files, then turns the computer off.",
  lock: "Keeps working in the background behind the lock screen.",
};

/** "Sleeps" - the status bar's word for an armed action. */
export function powerChipText(state: PowerStateView): string | null {
  if (!state.supported || state.action === "nothing") return null;
  const verb = state.action === "shutdown" ? "Shut down" : state.action === "lock" ? "Lock" : LABEL[state.action];
  return `${verb} when done${state.repeat === "always" ? "" : " (once)"}`;
}

/** The picker. Resolves once it closes. */
export async function openPowerDialog(): Promise<void> {
  const state = await window.adcode.power.state();
  return new Promise((resolve) => {
    const { card, dialog, finish } = openFormModal("power-dialog", "When the assistant finishes", () => resolve());
    if (!state.supported) {
      card.append(
        el("p", "result-summary", "This runs on your own computer. In the web version there is nothing of yours to put to sleep - open ADCode on your computer to use it."),
        (() => { const row = el("div", "power-actions"); row.append(button("Close", "ad-btn ad-btn-primary", () => finish())); return row; })(),
      );
      dialog.showModal();
      return;
    }
    card.append(el("p", "result-summary power-lead", "Hand over a long job and walk away. Once every working chat has finished, this computer can go to sleep or shut down - after a countdown you can cancel."));

    const buck = createAdcodeMascot({ mood: state.action === "nothing" ? "idle" : "sleeping", size: 72 });
    const hero = el("div", "power-hero");
    hero.append(buck.element);

    let chosen: PowerActionView = state.action;
    let repeat = state.repeat;
    const list = el("div", "power-choices");
    list.setAttribute("role", "radiogroup");
    list.setAttribute("aria-label", "What to do");
    const paint = (): void => {
      for (const option of list.querySelectorAll<HTMLInputElement>("input")) option.checked = option.value === chosen;
      buck.setMood(chosen === "nothing" ? "idle" : chosen === "lock" ? "wink" : "sleeping");
      once.disabled = chosen === "nothing";
      always.disabled = chosen === "nothing";
    };
    for (const action of state.actions) {
      const label = el("label", "power-choice ad-radio");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "power-action";
      input.value = action;
      input.addEventListener("change", () => { chosen = action; paint(); });
      const copy = el("span", "power-choice-copy");
      copy.append(el("strong", "", LABEL[action]), el("small", "", HINT[action]));
      label.append(input, copy);
      list.append(label);
    }

    const repeatRow = el("div", "power-repeat");
    const once = document.createElement("input");
    const always = document.createElement("input");
    for (const [input, value, text] of [[once, "once", "Only the next time"], [always, "always", "Every time"]] as const) {
      const label = el("label", "ad-radio");
      input.type = "radio";
      input.name = "power-repeat";
      input.checked = repeat === value;
      input.addEventListener("change", () => { repeat = value; });
      label.append(input, document.createTextNode(` ${text}`));
      repeatRow.append(label);
    }

    const note = el("p", "power-note", `Waits for every chat, never fires when you press Stop, and counts down for ${state.graceSeconds < 60 ? `${state.graceSeconds} seconds` : `${state.graceSeconds / 60} minute${state.graceSeconds === 60 ? "" : "s"}`} first. You can also arm it from your phone with Phone link.`);
    const actions = el("div", "power-actions");
    const save = button("Save", "ad-btn ad-btn-primary", () => {
      void window.adcode.power.set(chosen, repeat).finally(() => finish());
    });
    actions.append(button("Cancel", "confirm-cancel", () => finish()), save);
    card.append(hero, field("What to do", list), field("How often", repeatRow), note, actions);
    paint();
    dialog.addEventListener("close", () => buck.destroy(), { once: true });
    dialog.showModal();
    save.focus();
  });
}

/* ── The countdown ───────────────────────────────────────────────────────── */

const RING = 2 * Math.PI * 44;

export interface PowerCountdown {
  update(state: PowerStateView): void;
}

export function createPowerCountdown(host: HTMLElement): PowerCountdown {
  let root: HTMLElement | null = null;
  let mascot: AdcodeMascot | null = null;
  let frame: number | null = null;
  let previouslyFocused: Element | null = null;

  const close = (): void => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    const leaving = root;
    root = null;
    mascot?.destroy();
    mascot = null;
    if (leaving === null) return;
    leaving.dataset["state"] = "leaving";
    window.setTimeout(() => leaving.remove(), 200);
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
  };

  const open = (countdown: NonNullable<PowerStateView["countdown"]>): void => {
    previouslyFocused = document.activeElement;
    const overlay = el("div", "power-countdown");
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "power-countdown-title");
    overlay.setAttribute("aria-describedby", "power-countdown-detail");
    const panel = el("div", "power-countdown-card");
    const dial = el("div", "power-countdown-dial");
    dial.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="power-ring-track" cx="50" cy="50" r="44"/><circle class="power-ring" cx="50" cy="50" r="44" stroke-dasharray="${RING.toFixed(2)}" stroke-dashoffset="0"/></svg>`;
    mascot = createAdcodeMascot({ mood: "sleeping", size: 64 });
    dial.append(mascot.element);
    const seconds = el("div", "power-countdown-seconds");
    seconds.setAttribute("aria-hidden", "true");
    const title = el("h2", "power-countdown-title");
    title.id = "power-countdown-title";
    const detail = el("p", "power-countdown-detail", "Everything the assistant was working on is done.");
    detail.id = "power-countdown-detail";
    const live = el("p", "power-countdown-live");
    live.setAttribute("aria-live", "polite");
    const actions = el("div", "power-countdown-actions");
    const cancel = button("Cancel", "ad-btn ad-btn-primary", () => void window.adcode.power.cancel());
    const now = button(`${LABEL[countdown.action]} now`, "confirm-cancel", () => void window.adcode.power.now());
    actions.append(now, cancel);
    panel.append(dial, seconds, title, detail, live, actions);
    overlay.append(panel);
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); void window.adcode.power.cancel(); }
      if (event.key === "Tab") {
        // Two buttons; focus stays between them.
        event.preventDefault();
        (document.activeElement === cancel ? now : cancel).focus();
      }
    });
    host.append(overlay);
    root = overlay;
    requestAnimationFrame(() => { overlay.dataset["state"] = "open"; });
    cancel.focus();

    const total = Math.max(1, countdown.deadline - Date.now());
    const ring = overlay.querySelector<SVGCircleElement>(".power-ring");
    let lastSecond = -1;
    const tick = (): void => {
      if (root !== overlay) return;
      const left = Math.max(0, countdown.deadline - Date.now());
      ring?.setAttribute("stroke-dashoffset", (RING * (1 - left / total)).toFixed(2));
      const second = Math.ceil(left / 1000);
      if (second !== lastSecond) {
        lastSecond = second;
        seconds.textContent = String(second);
        const verb = countdown.action === "shutdown" ? "shut down" : countdown.action === "lock" ? "lock" : countdown.action === "hibernate" ? "hibernate" : "go to sleep";
        title.textContent = `Your computer will ${verb}`;
        // Spoken every ten seconds and for the last five, not every second.
        if (second % 10 === 0 || second <= 5) live.textContent = `${second} seconds left.`;
        overlay.dataset["urgent"] = second <= 10 ? "true" : "false";
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
  };

  return {
    update(state) {
      if (state.countdown === null) { close(); return; }
      if (root === null) open(state.countdown);
    },
  };
}

export { LABEL as POWER_LABEL };
