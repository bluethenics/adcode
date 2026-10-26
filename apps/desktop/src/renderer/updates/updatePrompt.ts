/**
 * The update the window can see: a status-bar button, and quiet available/ready cards.
 *
 * The card follows the What's New rules - a focused window, not mid-typing, once per
 * version - and main hands each version to one window only, so two open windows do not
 * both announce it. Installation happens after an explicit Update now or Restart now,
 * or as ADCode is next closed normally.
 */
import type { UpdatePreparation, UpdateStatus } from "../../shared/api.ts";
import type { NotificationCentre } from "../notifications/notifications.ts";
import { availableNoticeDue, readyNoticeDue, restartBlocked, updateView } from "./updateView.ts";

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
  readonly recoveryDrafts: () => UpdatePreparation["drafts"];
  /** Hold editing while every open window protects its current buffers. */
  readonly setPreparing: (preparing: boolean) => void;
  readonly onEditorChanged: (listener: () => void) => void;
}

export interface UpdatePrompt {
  /** Update now, or finish the background download and then install on this explicit request. */
  update(): Promise<boolean>;
  /** Restart into a downloaded update; false when none is waiting. */
  restart(): Promise<boolean>;
}

export function createUpdatePrompt(deps: UpdatePromptDeps): UpdatePrompt {
  let status: UpdateStatus = { state: "idle" };
  let restarting = false;
  let lastKeyAt = 0;
  let retry: number | null = null;
  const shown = new Set<string>();
  const availableShown = new Set<string>();
  const offering = new Set<string>();
  let installWhenReady: string | null = null;
  let preparingId: string | null = null;
  const unlock = (): void => { preparingId = null; deps.setPreparing(false); };
  window.adcode.updates.onPrepareCancel(id => {
    if (id === preparingId) { unlock(); restarting = false; draw(); }
  });
  window.adcode.updates.onPrepare(id => {
    preparingId = id;
    try {
      deps.setPreparing(true);
      const blocked = restartBlocked(deps.unsavedWithoutRecovery());
      if (blocked !== null) deps.notifications.show({ title: "Save before updating", body: blocked, tone: "warning" });
      void window.adcode.updates.prepared(id, { ready: blocked === null, drafts: blocked === null ? deps.recoveryDrafts() : [] })
        .then(accepted => { if (!accepted && preparingId === id) unlock(); }, () => { if (preparingId === id) unlock(); });
    } catch {
      void window.adcode.updates.prepared(id, { ready: false, drafts: [] }).catch(() => undefined);
      unlock();
    }
  });
  deps.onEditorChanged(() => {
    if (preparingId !== null) void window.adcode.updates.prepared(preparingId, { ready: false, drafts: [] }).catch(() => undefined);
  });

  document.addEventListener(
    "keydown",
    () => {
      lastKeyAt = Date.now();
    },
    { capture: true, passive: true },
  );

  const restart = async (): Promise<boolean> => {
    if (status.state !== "ready" || restarting) return false;
    const blocked = restartBlocked(deps.unsavedWithoutRecovery());
    if (blocked !== null) {
      deps.notifications.show({ title: "Save before restarting", body: blocked, tone: "warning", autoDismissMs: 8000 });
      return false;
    }
    // One restart: a second request would make the updater install twice.
    restarting = true;
    draw();
    try {
      deps.flushDrafts();
      const after = await window.adcode.updates.install();
      if (after.state === "ready") return true;
    } catch { /* The failed install remains available to retry. */ }
    restarting = false;
    draw();
    deps.notifications.show({ title: "Could not install the update", body: "Save changes in every ADCode window and try again. Close any window that is not responding. Your current version is safe.", tone: "warning", actions: [{ label: "Try again", run: () => void restart() }] });
    return false;
  };

  const update = async (): Promise<boolean> => {
    if (status.state === "ready") return restart();
    if (status.state === "available") {
      try { await window.adcode.updates.install(); return true; }
      catch { deps.notifications.show({ title: "Could not open updates", body: "Try the update button again, or use Help → Check for Updates.", tone: "warning" }); return false; }
    }
    if (status.state !== "downloading" || typeof status.version !== "string" || restarting) return false;
    if (installWhenReady === status.version) return true;
    installWhenReady = status.version;
    deps.notifications.show({ title: "Updating ADCode", body: "The download is continuing in the background. ADCode will install it when ready because you chose Update now. Unsaved work is protected before it closes." });
    return true;
  };

  const draw = (): void => {
    const view = updateView(status, { restarting });
    deps.statusItem.hidden = view.label === null;
    deps.statusItem.textContent = view.label ?? "";
    deps.statusItem.title = view.title;
    deps.statusItem.disabled = !view.canRestart && view.canUpdate !== true;
    /*
     * The same sentence, for the rail.
     *
     * `title` serves the status bar, where this button is a word you read. In the frame it is a
     * 40px square with the label gone, and a native `title` tooltip under a square arrives late
     * and in the wrong place - the rail draws its own from `data-tip`. An update outlives the
     * rail that was built before it, so the tip is rewritten here on every draw rather than
     * copied once when the rail is built.
     */
    if (view.title === "") delete deps.statusItem.dataset["tip"];
    else deps.statusItem.dataset["tip"] = view.title;
  };

  const offer = async (): Promise<void> => {
    if (retry !== null) window.clearTimeout(retry);
    retry = null;

    const phase = status.state === "ready" ? "ready" : "available";
    const moment = {
      focused: document.hasFocus(),
      typingRecently: Date.now() - lastKeyAt < TYPING_WINDOW_MS,
    };
    const version = phase === "ready" ? readyNoticeDue(status, shown, moment) : availableNoticeDue(status, availableShown, moment);
    if (version === null) {
      // A busy moment is a "not yet", not a "no".
      if ((status.state === "ready" && !shown.has(status.version)) || ((status.state === "available" || status.state === "downloading") && status.version && !availableShown.has(status.version))) {
        retry = window.setTimeout(() => void offer(), RETRY_MS);
      }
      return;
    }

    const key = `${phase}:${version}`;
    if (offering.has(key)) return;
    offering.add(key);
    const claimed = await window.adcode.updates.claimNotice(version, phase).catch(() => false);
    offering.delete(key);
    (phase === "ready" ? shown : availableShown).add(version);
    if (!claimed) return;
    // The download can finish or fail while main arbitrates between windows.
    if (!("version" in status) || status.version !== version) return;
    if (phase === "available") {
      if (status.state !== "available" && status.state !== "downloading") return;
      const source = status.state === "available" ? status.source : null;
      deps.notifications.show({
        title: `ADCode ${version} is available`,
        body: source === "store" ? "A new ADCode release is out. Open Microsoft Store to check whether its update is available for this installation."
          : source === "download" ? "A new portable version is out. Download it from the official ADCode site and replace your portable copy."
          : "A new update is downloading. Choose Update now to install it as soon as it is ready, or keep working and restart later.",
        actions: [{ label: source === "store" ? "Update in Microsoft Store" : source === "download" ? "Download update" : "Update now", run: () => void update() }, { label: "Later", run: () => undefined }],
      });
      return;
    }
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
    } else if (status.state === "ready") {
      deps.notifications.show({ title: `ADCode ${version} is ready`, body: "Close ADCode to install the update. Your unsaved work is protected first.", actions: [{ label: "Close and update", run: () => void restart() }, { label: "Later", run: () => undefined }] });
    }
  };

  const apply = (next: UpdateStatus): void => {
    status = next;
    draw();
    if (next.state === "ready" && installWhenReady === next.version) {
      installWhenReady = null;
      void restart().then(installed => { if (!installed) void offer(); });
    } else if (["ready", "available", "downloading"].includes(next.state)) void offer();
    else if (next.state === "failed" && installWhenReady !== null) {
      installWhenReady = null;
      deps.notifications.show({ title: "The update download stopped", body: "Your current version is safe. You can retry the download.", tone: "warning", actions: [{ label: "Try again", run: () => void window.adcode.updates.check().then(apply).catch(() => undefined) }] });
    }
  };

  deps.statusItem.addEventListener("click", () => void update());
  window.addEventListener("focus", () => {
    if (["ready", "available", "downloading"].includes(status.state)) void offer();
  });
  window.adcode.updates.onChanged(apply);
  void window.adcode.updates.status().then(apply, () => undefined);

  return { restart, update };
}
