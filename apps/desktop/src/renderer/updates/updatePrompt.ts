/**
 * The update the window can see: a status-bar button, and one quiet card when it is ready.
 *
 * The card follows the What's New rules - a focused window, not mid-typing, once per
 * version - and main hands each version to one window only, so two open windows do not
 * both announce it. Nothing here restarts ADCode unless the person clicked something that
 * says Restart.
 */
import type { UpdateStatus } from "../../shared/api.ts";
import type { NotificationCentre } from "../notifications/notifications.ts";
import { readyNoticeDue, restartBlocked, updateView } from "./updateView.ts";

/** A keystroke counts as "still typing" for this long afterwards. */
const TYPING_WINDOW_MS = 4_000;
/** How often a waiting card re-checks whether the moment has become a quiet one. */
const RETRY_MS = 20_000;

export interface UpdatePromptDeps {
  readonly statusItem: HTMLButtonElement;
  readonly notifications: NotificationCentre;
  /** Write a recovery draft for every unsaved buffer, before the restart. */
  readonly flushDrafts: () => void;
  /** Unsaved buffers that would get no recovery draft - crash recovery switched off. */
  readonly unsavedWithoutRecovery: () => number;
}

export interface UpdatePrompt {
  /** Restart into a downloaded update; false when none is waiting. */
  restart(): Promise<boolean>;
}

export function createUpdatePrompt(deps: UpdatePromptDeps): UpdatePrompt {
  let status: UpdateStatus = { state: "idle" };
  let restarting = false;
  let lastKeyAt = 0;
  let retry: number | null = null;
  const shown = new Set<string>();

  document.addEventListener(
    "keydown",
    () => {
      lastKeyAt = Date.now();
    },
    { capture: true, passive: true },
  );

  const restart = async (): Promise<boolean> => {
    if (status.state !== "ready" || status.restartable !== true || restarting) return false;
    const blocked = restartBlocked(deps.unsavedWithoutRecovery());
    if (blocked !== null) {
      deps.notifications.show({ title: "Save before restarting", body: blocked, tone: "warning", autoDismissMs: 8000 });
      return false;
    }
    // One restart: a second request would make the updater install twice.
    restarting = true;
    draw();
    deps.flushDrafts();
    const after = await window.adcode.updates.install().catch(() => null);
    return after?.state === "ready";
  };

  const draw = (): void => {
    const view = updateView(status, { restarting });
    deps.statusItem.hidden = view.label === null;
    deps.statusItem.textContent = view.label ?? "";
    deps.statusItem.title = view.title;
    deps.statusItem.disabled = !view.canRestart;
  };

  const offer = async (): Promise<void> => {
    if (retry !== null) window.clearTimeout(retry);
    retry = null;

    const version = readyNoticeDue(status, shown, {
      focused: document.hasFocus(),
      typingRecently: Date.now() - lastKeyAt < TYPING_WINDOW_MS,
    });
    if (version === null) {
      // A busy moment is a "not yet", not a "no".
      if (status.state === "ready" && !shown.has(status.version)) {
        retry = window.setTimeout(() => void offer(), RETRY_MS);
      }
      return;
    }

    shown.add(version);
    if (!(await window.adcode.updates.claimNotice(version).catch(() => false))) return;
    if (status.state === "ready" && status.restartable === true) {
      deps.notifications.show({
        title: `ADCode ${version} is ready`,
        body: "Restart to finish updating. Anything unsaved is offered back when ADCode reopens.",
        actions: [
          { label: "Restart now", run: () => void restart() },
          // The card closes itself; the update still installs when ADCode is next closed.
          { label: "Later", run: () => undefined },
        ],
      });
    } else {
      deps.notifications.show({ title: `ADCode ${version} is ready`, body: "It installs the next time you close ADCode." });
    }
  };

  const apply = (next: UpdateStatus): void => {
    status = next;
    draw();
    if (next.state === "ready") void offer();
  };

  deps.statusItem.addEventListener("click", () => void restart());
  window.addEventListener("focus", () => {
    if (status.state === "ready") void offer();
  });
  window.adcode.updates.onChanged(apply);
  void window.adcode.updates.status().then(apply, () => undefined);

  return { restart };
}
