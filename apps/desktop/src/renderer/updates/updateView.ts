/**
 * What the window says about an update, as data.
 *
 * Pure so every status is tested without a window; `updatePrompt.ts` only draws it.
 * Quiet states show nothing at all - "you are up to date" in the status bar forever is
 * noise, and Help > Check for Updates answers that question when someone asks it.
 */
import type { UpdateStatus } from "../../shared/api.ts";

export interface UpdateView {
  /** Status-bar text; null hides the item. */
  readonly label: string | null;
  readonly title: string;
  /** Whether clicking the item restarts into the update. */
  readonly canRestart: boolean;
}

const HIDDEN: UpdateView = { label: null, title: "", canRestart: false };

export function updateView(status: UpdateStatus): UpdateView {
  if (status.state === "downloading") {
    const percent = status.percent;
    const label =
      typeof percent === "number" && Number.isFinite(percent)
        ? `Updating ${Math.max(0, Math.min(100, Math.round(percent)))}%`
        : "Updating…";
    return { label, title: "A new version of ADCode is downloading in the background.", canRestart: false };
  }

  if (status.state === "ready") {
    return {
      label: "Restart to update",
      title: `ADCode ${status.version} is ready. Restart now, or it installs when you close ADCode.`,
      canRestart: true,
    };
  }

  return HIDDEN;
}

export interface ReadyMoment {
  readonly focused: boolean;
  readonly typingRecently: boolean;
}

/**
 * The version to announce now, or null. The What's New rules: once per version, only in a
 * focused window, never while someone is typing.
 */
export function readyNoticeDue(
  status: UpdateStatus,
  shown: ReadonlySet<string>,
  moment: ReadyMoment,
): string | null {
  if (status.state !== "ready" || shown.has(status.version)) return null;
  if (!moment.focused || moment.typingRecently) return null;
  return status.version;
}
