/**
 * What the right-click menu in a terminal pane offers.
 *
 * Split from the panel because the interesting part is the decision, not the DOM: which
 * entries exist depends on whether an agent is running, whether it is mid-continuation, and
 * whether it has been granted its one scheduled message. Those rules are worth a test, and
 * a test that has to stand up xterm to read a menu label is a test nobody writes.
 *
 * The features this menu exposes existed before it did - they were reachable only from the
 * settings screen and the Assistant panel, which is to say that somebody running Grok in a
 * terminal had no way to find out they were there. A right-click is where people look.
 */
import type { ContextMenuNode } from "../workbench/contextMenu.ts";
import type { DetectedAgent } from "@adcode/ai/agents";

export interface TerminalMenuState {
  /** The agent detected in this pane, or null for a plain shell. */
  readonly agent: DetectedAgent | null;
  /** `adcode.ai.autoContinue`. */
  readonly autoContinue: boolean;
  /** A continuation is armed or waiting on the clock right now. */
  readonly continuationPending: boolean;
  /** `adcode.ai.scheduledMessages`. */
  readonly schedulingEnabled: boolean;
  /** The pane's one-shot permission to receive a scheduled message is live. */
  readonly scheduleAllowed: boolean;
  /** A Team is running across the panel's panes. */
  readonly teamRunning: boolean;
  readonly hasSelection: boolean;
}

export interface TerminalMenuActions {
  readonly copy: () => void;
  readonly paste: () => void;
  readonly clear: () => void;
  readonly split: () => void;
  readonly close: () => void;
  readonly toggleAutoContinue: () => void;
  readonly cancelContinuation: () => void;
  readonly allowSchedule: () => void;
  readonly scheduleMessage: () => void;
  readonly startTeam: () => void;
  readonly stopTeam: () => void;
  readonly showFeatures: () => void;
}

/**
 * Build the menu for one pane.
 *
 * The AI section is present whenever an agent is detected and absent otherwise, rather than
 * present-but-disabled. A disabled row in a plain shell would be a permanent advertisement
 * for something the user has not asked for; the Feature library is where browsing belongs.
 */
export function terminalMenuModel(
  state: TerminalMenuState,
  actions: TerminalMenuActions,
): ContextMenuNode[] {
  const nodes: ContextMenuNode[] = [
    { label: "Copy", run: actions.copy, accelerator: "Ctrl+Shift+C", disabled: !state.hasSelection },
    { label: "Paste", run: actions.paste, accelerator: "Ctrl+Shift+V" },
    { kind: "separator" },
    { label: "Split terminal", run: actions.split },
    { label: "Clear", run: actions.clear },
  ];

  if (state.agent !== null) {
    nodes.push({ kind: "separator" }, { kind: "heading", label: state.agent.name });

    nodes.push(
      state.continuationPending
        ? { label: "Cancel the pending continuation", run: actions.cancelContinuation }
        : {
            label: state.autoContinue
              ? "Continue after usage limits: on"
              : "Continue after usage limits: off",
            run: actions.toggleAutoContinue,
          },
    );

    if (state.schedulingEnabled) {
      nodes.push({ label: "Schedule a message…", run: actions.scheduleMessage });
      // The grant is what makes this pane a legal delivery target, and it is spent by any
      // later terminal activity. Saying so in the label beats a row that silently no-ops.
      nodes.push(
        state.scheduleAllowed
          ? { label: "Next scheduled message allowed", run: actions.allowSchedule, disabled: true }
          : { label: "Allow the next scheduled message", run: actions.allowSchedule },
      );
    }
  }

  nodes.push({ kind: "separator" });
  nodes.push(
    state.teamRunning
      ? { label: "Stop the running Team", run: actions.stopTeam, danger: true }
      : { label: "Start a Team here…", run: actions.startTeam },
  );
  nodes.push({ label: "All terminal AI features…", run: actions.showFeatures });

  nodes.push({ kind: "separator" }, { label: "Close terminal", run: actions.close, danger: true });

  return nodes;
}

/** Every label a built menu shows, headings included. For tests, which read labels. */
export function terminalMenuLabels(nodes: readonly ContextMenuNode[]): string[] {
  return nodes.flatMap((node) => (node.kind === "separator" ? [] : [node.label]));
}
