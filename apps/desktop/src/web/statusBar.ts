/**
 * What the web version says about its own connection and this session's cloud time.
 *
 * Everything else on screen is the desktop renderer's. This adds only what a browser tab needs
 * and the desktop never does:
 *
 * - a quiet "Reconnecting…" bar while the network is away (the sandbox keeps working),
 * - full-screen pauses when the cloud has put the sandbox to sleep, the session's time is spent, or
 *   the month is full - each with the one or two things a person can do next,
 * - a time-left chip, amber at ten minutes and red at two, with a toast at each.
 */
import { openWebAccount, DESKTOP_DOWNLOAD_URL } from "../renderer/surface.ts";
import { hideGate, showBlocked, showWaking, type WebSession } from "./gate.ts";
import { formatReset, formatTimeLeft, timeTone } from "./gateText.ts";
import type { HostSocket } from "./socket.ts";
import type { CloudStatus } from "./wire.ts";

const TICK_MS = 15_000;

/** Dispatched on `document` to open the Cloud workspace panel. */
export const OPEN_CLOUD_WORKSPACE_EVENT = "adcode:open-cloud-workspace";

function openDesktop(): void {
  window.open(DESKTOP_DOWNLOAD_URL, "_blank", "noopener");
}

function toast(text: string, tone: "info" | "warn" = "info"): void {
  const layer = document.querySelector(".web-toasts") ?? Object.assign(document.createElement("div"), { className: "web-toasts" });
  if (layer.parentElement === null) document.body.append(layer);
  const item = document.createElement("div");
  item.className = `web-toast web-toast-${tone}`;
  item.setAttribute("role", "status");
  item.textContent = text;
  layer.append(item);
  setTimeout(() => item.classList.add("web-toast-leaving"), 6_000);
  setTimeout(() => item.remove(), 6_600);
}

export function mountStatusBar(socket: HostSocket, session: WebSession): { status: () => CloudStatus | null; rendererLoaded: () => void } {
  // Mounted before the sandbox answers, so a refusal (no time left, signed out) is shown at once;
  // the gate is only lifted once the renderer is there to show instead.
  let loaded = false;
  const lift = (): void => {
    if (loaded) hideGate();
  };
  const bar = document.createElement("div");
  bar.className = "web-connection";
  bar.setAttribute("role", "status");
  bar.hidden = true;
  document.body.append(bar);

  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "web-time";
  chip.hidden = true;
  chip.title = "Cloud time left in this 5-hour session. It refills when the session ends. The desktop app has no time limit.";
  // The Cloud workspace panel listens for this; it lives in the renderer, which owns its panels.
  chip.addEventListener("click", () => document.dispatchEvent(new CustomEvent(OPEN_CLOUD_WORKSPACE_EVENT)));
  document.body.append(chip);

  let last: CloudStatus | null = null;
  let lastAt = 0;
  let warnedLow = false;
  let warnedLast = false;

  const remaining = (): number => {
    if (last === null) return Number.POSITIVE_INFINITY;
    const running = last.state === "ready" && socket.state() === "open" ? Date.now() - lastAt : 0;
    return last.allowanceMs - last.usedMs - running;
  };

  const renderChip = (): void => {
    if (last === null || last.allowanceMs <= 0) {
      chip.hidden = true;
      return;
    }
    const left = remaining();
    chip.hidden = false;
    chip.textContent = formatTimeLeft(left);
    chip.dataset["tone"] = timeTone(left);
    if (left <= 10 * 60_000 && left > 2 * 60_000 && !warnedLow) {
      warnedLow = true;
      toast("10 minutes of cloud time left in this session. Your work is saved as you go.", "warn");
    }
    if (left <= 2 * 60_000 && left > 0 && !warnedLast) {
      warnedLast = true;
      toast("2 minutes of cloud time left. It refills when this session ends; download your project or push it to GitHub to keep going elsewhere.", "warn");
    }
  };

  const showPause = (): void => {
    const status = last;
    if (status?.state === "spent") {
      showBlocked(
        "That's this session's cloud time",
        `${formatReset(status.resetsAt)}. Your projects are saved where you left them. The desktop app runs on your own computer, with no time limit.`,
        [
          { label: "Your account", run: () => openWebAccount() },
          { label: "Get the desktop app", primary: true, run: openDesktop },
          { label: "Try again", run: () => { showWaking(); socket.resume(); } },
        ],
      );
      return;
    }
    if (status?.state === "full") {
      showBlocked(
        "The web version is full this month",
        status.message ?? "So many people are building that this month's cloud budget is used up. Your projects are saved. The desktop app is free and has no limit.",
        [
          { label: "Your account", run: () => openWebAccount() },
          { label: "Get the desktop app", primary: true, run: openDesktop },
          { label: "Try again", run: () => { showWaking(); socket.resume(); } },
        ],
      );
      return;
    }
    showBlocked(
      "Your workspace is resting",
      status?.message ?? "Inactive workspaces sleep automatically. Everything is saved; resume whenever you are ready.",
      [{ label: "Resume", primary: true, run: () => { showWaking(); socket.resume(); } }, { label: "Your account", run: () => openWebAccount() }],
    );
  };

  socket.onStatus((state) => {
    if (state === "reconnecting" && last?.state !== "busy") {
      bar.textContent = "Reconnecting… your workspace keeps working";
      bar.hidden = false;
    } else {
      bar.hidden = true;
    }
    if (state === "auth-failed") {
      showBlocked("You've been signed out", "Sign in again to get back to your workspace. Everything in it is saved.", [
        { label: "Sign in", primary: true, run: () => void session.signOut() },
      ]);
    }
    if (state === "paused") showPause();
    if (state === "open" && (last === null || last.state === "ready")) lift();
    renderChip();
  });

  socket.onCloud((status) => {
    const previousState = last?.state;
    last = status;
    lastAt = Date.now();
    switch (status.state) {
      case "waking":
        showWaking();
        break;
      case "busy":
        // Keep the waiting screen steady while the socket checks for available capacity.
        bar.hidden = true;
        if (previousState !== "busy") showWaking("Waiting for a free sandbox…", "All sandboxes are in use. This page retries automatically.");
        break;
      case "ready":
        lift();
        break;
      case "restarted":
        lift();
        toast("Your workspace restarted. Edits from the last few minutes may be missing.", "warn");
        break;
      case "sleeping":
      case "spent":
      case "full":
        if (socket.state() === "paused") showPause();
        break;
    }
    renderChip();
  });

  setInterval(renderChip, TICK_MS);
  return {
    status: () => last,
    rendererLoaded: () => {
      loaded = true;
      // The app shows as soon as it has loaded; a refusal on screen (signed out, paused) stays.
      const state = socket.state();
      if (state !== "auth-failed" && state !== "paused") hideGate();
    },
  };
}
