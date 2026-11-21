/**
 * The pop-ups for converting earnings to AI credits: confirm, converting, done, failed.
 *
 * One layer over the earnings card (the card is a non-modal anchored popup, so this lives
 * inside it rather than opening a second app-level popup). The same two "pockets" -
 * Earnings and AI credits - stay on screen through every state, so the money is seen to
 * leave one and land in the other:
 *
 * - confirm: both pockets show before -> after, and nothing has moved yet;
 * - converting: a coin flows along the track while the server works;
 * - done: coins arc from Earnings into AI credits, the credits pocket takes them in, both
 *   figures count to the server's answer, and a check mark draws;
 * - failed: says nothing moved, and offers to try again with the same request.
 *
 * Motion is CSS (styles/panels.css, "Conversion pop-up"), driven by data-state attributes;
 * only the count-up is JavaScript, because it writes numbers. With reduced motion the app's
 * global rule cuts every animation to its end state, the coins are hidden, and the figures
 * jump straight to their final values.
 */
import { formatUsd } from "../../shared/creditConversion.ts";

export interface ConversionFigures {
  readonly amountLabel: string;
  readonly creditLabel: string;
  readonly earningsBeforeMicros: string;
  readonly earningsAfterMicros: string;
  readonly creditsBeforeMicros: string;
  readonly creditsAfterMicros: string;
}

export interface ConversionDialog {
  readonly element: HTMLElement;
  /** Shows the confirmation. Resolves true on Convert, false on Back or Escape. */
  confirm(figures: ConversionFigures): Promise<boolean>;
  /** The request is in flight. */
  converting(): void;
  /** The server's answer. Resolves when the person presses Done. */
  succeeded(figures: ConversionFigures): Promise<void>;
  /** Nothing moved. Resolves "retry" to repeat the same request, "back" to return to the form. */
  failed(message: string, retryable: boolean): Promise<"retry" | "back">;
  close(): void;
  isOpen(): boolean;
}

/** How long the coins take to cross; the count-up and the check mark are timed against it. */
const FLIGHT_MS = 560;
const COINS = 3;
const COIN_STAGGER_MS = 70;
const COUNT_MS = 700;
const EXIT_MS = 160;

function reducedMotion(): boolean {
  return document.documentElement.dataset["reducedMotion"] === "true" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A pocket: a name, the figure before, and the figure after. */
function pocket(name: string, kind: "earnings" | "credits") {
  const root = el("div", "conv-pocket");
  root.dataset["kind"] = kind;
  const label = el("span", "conv-pocket-label", name);
  const value = el("span", "conv-pocket-value", "—");
  const change = el("span", "conv-pocket-change");
  root.append(label, value, change);
  return { root, value, change };
}

const SVG = "http://www.w3.org/2000/svg";

function checkMark(): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "conv-check");
  svg.setAttribute("aria-hidden", "true");
  const circle = document.createElementNS(SVG, "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "12");
  circle.setAttribute("r", "10");
  circle.setAttribute("class", "conv-check-ring");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", "M7.5 12.5l3 3 6-6.5");
  path.setAttribute("class", "conv-check-tick");
  svg.append(circle, path);
  return svg;
}

export function createConversionDialog(): ConversionDialog {
  const layer = el("div", "conv-layer");
  layer.hidden = true;
  layer.dataset["state"] = "closed";

  const dialog = el("div", "conv-dialog");
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "conv-title");
  dialog.setAttribute("aria-describedby", "conv-message");

  const title = el("h3", "conv-title");
  title.id = "conv-title";

  const stage = el("div", "conv-stage");
  const earnings = pocket("Earnings", "earnings");
  const credits = pocket("AI credits", "credits");
  const track = el("div", "conv-track");
  track.setAttribute("aria-hidden", "true");
  const flowCoin = el("span", "conv-coin conv-coin-flow");
  const flightCoins = Array.from({ length: COINS }, (_, index) => {
    const coin = el("span", "conv-coin conv-coin-flight");
    coin.style.animationDelay = `${index * COIN_STAGGER_MS}ms`;
    return coin;
  });
  track.append(el("span", "conv-track-line"), flowCoin, ...flightCoins);
  stage.append(earnings.root, track, credits.root);

  const status = el("div", "conv-status");
  const check = checkMark();
  const message = el("p", "conv-message");
  message.id = "conv-message";
  message.setAttribute("role", "status");
  status.append(check, message);

  const actions = el("div", "conv-actions");
  const primary = el("button", "ad-btn ad-btn-primary");
  primary.type = "button";
  const secondary = el("button", "ad-btn ad-btn-tertiary");
  secondary.type = "button";
  actions.append(primary, secondary);

  dialog.append(title, stage, status, actions);
  layer.append(dialog);

  let answer: ((value: string) => void) | null = null;
  let countFrame = 0;
  let closeTimer = 0;

  const settle = (value: string): void => {
    const resolve = answer;
    answer = null;
    resolve?.(value);
  };

  function setView(view: "confirm" | "converting" | "done" | "failed"): void {
    dialog.dataset["view"] = view;
  }

  function show(): void {
    window.clearTimeout(closeTimer);
    if (!layer.hidden && layer.dataset["state"] === "open") return;
    layer.hidden = false;
    layer.dataset["state"] = "closed";
    // One frame in the closed state first, so the entrance transition has a start.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      layer.dataset["state"] = "open";
    }));
  }

  function paintFigures(figures: ConversionFigures, phase: "before" | "after"): void {
    earnings.value.textContent = formatUsd(phase === "before" ? figures.earningsBeforeMicros : figures.earningsAfterMicros);
    credits.value.textContent = formatUsd(phase === "before" ? figures.creditsBeforeMicros : figures.creditsAfterMicros);
    earnings.change.textContent = `− ${figures.amountLabel}`;
    credits.change.textContent = `+ ${figures.creditLabel}`;
  }

  /** Both figures run from before to after; the last frame writes the exact server figures. */
  function countUp(figures: ConversionFigures, delayMs: number): void {
    cancelAnimationFrame(countFrame);
    const runs = [
      { node: earnings.value, from: Number(BigInt(figures.earningsBeforeMicros) / 10_000n), to: figures.earningsAfterMicros },
      { node: credits.value, from: Number(BigInt(figures.creditsBeforeMicros) / 10_000n), to: figures.creditsAfterMicros },
    ];
    if (reducedMotion()) {
      for (const run of runs) run.node.textContent = formatUsd(run.to);
      return;
    }
    const start = performance.now() + delayMs;
    const step = (now: number): void => {
      const t = Math.min(1, Math.max(0, (now - start) / COUNT_MS));
      const eased = 1 - Math.pow(1 - t, 3);
      for (const run of runs) {
        if (t >= 1) {
          run.node.textContent = formatUsd(run.to);
          continue;
        }
        // Display-only interpolation in whole cents; the exact figure lands on the last frame.
        const target = Number(BigInt(run.to) / 10_000n);
        const cents = Math.round(run.from + (target - run.from) * eased);
        run.node.textContent = formatUsd(BigInt(cents) * 10_000n);
      }
      if (t < 1) countFrame = requestAnimationFrame(step);
    };
    countFrame = requestAnimationFrame(step);
  }

  /** Restart a CSS animation that already ran once (the done view can be reached twice). */
  function replay(): void {
    dialog.dataset["run"] = "false";
    void dialog.offsetWidth;
    dialog.dataset["run"] = "true";
  }

  function focusPrimary(): void {
    requestAnimationFrame(() => primary.focus());
  }

  layer.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!secondary.hidden && !secondary.disabled) secondary.click();
      else if (!primary.hidden && !primary.disabled) primary.click();
      return;
    }
    // Focus stays inside the pop-up while it is up.
    if (event.key === "Tab") {
      const focusable = [primary, secondary].filter((button) => !button.hidden && !button.disabled);
      if (focusable.length === 0) return;
      const index = focusable.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.shiftKey ? index - 1 : index + 1;
      event.preventDefault();
      focusable[(next + focusable.length) % focusable.length]?.focus();
    }
  });

  primary.addEventListener("click", () => settle("primary"));
  secondary.addEventListener("click", () => settle("secondary"));

  const api: ConversionDialog = {
    element: layer,

    confirm(figures): Promise<boolean> {
      settle("secondary");
      title.textContent = `Convert ${figures.amountLabel} to AI credits?`;
      paintFigures(figures, "before");
      message.textContent = `You get ${figures.creditLabel} in AI credits. This can't be undone - credits never expire, and pay for paid models at their listed prices.`;
      primary.textContent = `Convert ${figures.amountLabel}`;
      primary.disabled = false;
      primary.hidden = false;
      secondary.textContent = "Back";
      secondary.hidden = false;
      secondary.disabled = false;
      setView("confirm");
      show();
      focusPrimary();
      return new Promise((resolve) => {
        answer = (value) => resolve(value === "primary");
      });
    },

    converting(): void {
      title.textContent = "Converting…";
      message.textContent = "Moving your earnings into AI credits.";
      primary.hidden = true;
      secondary.hidden = true;
      layer.setAttribute("aria-busy", "true");
      setView("converting");
      dialog.focus();
    },

    succeeded(figures): Promise<void> {
      // The card was closed mid-flight: the panel already shows the result, nobody is here to press Done.
      if (!api.isOpen()) return Promise.resolve();
      layer.removeAttribute("aria-busy");
      title.textContent = "Converted";
      paintFigures(figures, "before");
      message.textContent = `${figures.amountLabel} of earnings is now ${figures.creditLabel} in AI credits. You have ${formatUsd(figures.creditsAfterMicros)} in credits.`;
      primary.textContent = "Done";
      primary.hidden = false;
      primary.disabled = false;
      secondary.hidden = true;
      setView("done");
      replay();
      countUp(figures, reducedMotion() ? 0 : FLIGHT_MS * 0.6);
      focusPrimary();
      return new Promise((resolve) => {
        answer = () => resolve();
      });
    },

    failed(text, retryable): Promise<"retry" | "back"> {
      if (!api.isOpen()) return Promise.resolve("back");
      layer.removeAttribute("aria-busy");
      title.textContent = "Not converted";
      message.textContent = text;
      primary.textContent = retryable ? "Try again" : "Back";
      primary.hidden = false;
      primary.disabled = false;
      secondary.textContent = "Back";
      secondary.hidden = !retryable;
      setView("failed");
      focusPrimary();
      return new Promise((resolve) => {
        answer = (value) => resolve(retryable && value === "primary" ? "retry" : "back");
      });
    },

    close(): void {
      settle("secondary");
      cancelAnimationFrame(countFrame);
      layer.removeAttribute("aria-busy");
      if (layer.hidden) return;
      layer.dataset["state"] = "closed";
      // Hidden after the exit transition, so it leaves the way it came in.
      closeTimer = window.setTimeout(() => {
        layer.hidden = true;
        dialog.dataset["run"] = "false";
      }, reducedMotion() ? 0 : EXIT_MS);
    },

    isOpen: () => !layer.hidden && layer.dataset["state"] !== "closed",
  };

  dialog.tabIndex = -1;
  return api;
}
