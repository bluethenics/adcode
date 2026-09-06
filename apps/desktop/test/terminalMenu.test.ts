import { describe, expect, it, vi } from "vitest";
import {
  terminalMenuLabels,
  terminalMenuModel,
  type TerminalMenuActions,
  type TerminalMenuState,
} from "../src/renderer/terminal/terminalMenu.ts";
import type { ContextMenuItem, ContextMenuNode } from "../src/renderer/workbench/contextMenu.ts";

const actions = (): TerminalMenuActions => ({
  copy: vi.fn(),
  paste: vi.fn(),
  clear: vi.fn(),
  split: vi.fn(),
  close: vi.fn(),
  toggleAutoContinue: vi.fn(),
  cancelContinuation: vi.fn(),
  allowSchedule: vi.fn(),
  scheduleMessage: vi.fn(),
  startTeam: vi.fn(),
  stopTeam: vi.fn(),
  showFeatures: vi.fn(),
});

const state = (overrides: Partial<TerminalMenuState> = {}): TerminalMenuState => ({
  agent: { id: "grok", name: "Grok CLI" },
  autoContinue: false,
  continuationPending: false,
  schedulingEnabled: true,
  scheduleAllowed: false,
  teamRunning: false,
  hasSelection: false,
  ...overrides,
});

const labels = (s: TerminalMenuState): string[] => terminalMenuLabels(terminalMenuModel(s, actions()));

/** The clickable entry with this label, or a failure that names what was there instead. */
function item(nodes: readonly ContextMenuNode[], label: string): ContextMenuItem {
  const found = nodes.find(
    (node): node is ContextMenuItem => node.kind !== "separator" && node.kind !== "heading" && node.label === label,
  );
  if (found === undefined) throw new Error(`No "${label}" entry in: ${terminalMenuLabels(nodes).join(", ")}`);
  return found;
}

describe("terminalMenuModel", () => {
  /*
   * The point of the whole menu. Before it existed these three features were reachable
   * only from a settings screen and a panel on the other side of the window, so somebody
   * running an external CLI in the terminal had no way to find out they were there.
   */
  it("offers continuation, scheduling and Team beside a detected agent", () => {
    const found = labels(state());
    expect(found).toContain("Grok CLI");
    expect(found).toContain("Continue after usage limits: off");
    expect(found).toContain("Schedule a message…");
    expect(found).toContain("Allow the next scheduled message");
    expect(found).toContain("Start a Team here…");
    expect(found).toContain("All terminal AI features…");
  });

  it("names any recognised CLI, not just the built-in assistant", () => {
    expect(labels(state({ agent: { id: "kimi", name: "Kimi CLI" } }))).toContain("Kimi CLI");
    expect(labels(state({ agent: { id: "codex", name: "Codex" } }))).toContain("Codex");
  });

  it("says which way the continuation toggle is set", () => {
    expect(labels(state({ autoContinue: true }))).toContain("Continue after usage limits: on");
  });

  /* Mid-continuation, the useful action is calling it off, not toggling the setting. */
  it("offers to cancel while a continuation is pending", () => {
    const found = labels(state({ continuationPending: true, autoContinue: true }));
    expect(found).toContain("Cancel the pending continuation");
    expect(found).not.toContain("Continue after usage limits: on");
  });

  it("marks the schedule grant as already given rather than offering it twice", () => {
    const nodes = terminalMenuModel(state({ scheduleAllowed: true }), actions());
    expect(item(nodes, "Next scheduled message allowed").disabled).toBe(true);
  });

  it("hides scheduling entirely when the setting is off", () => {
    const found = labels(state({ schedulingEnabled: false }));
    expect(found).not.toContain("Schedule a message…");
    expect(found).not.toContain("Allow the next scheduled message");
  });

  /*
   * A plain shell gets no AI section. A disabled row would be a permanent advertisement
   * for something the user has not asked for; browsing belongs in the Feature library.
   */
  it("shows no agent section in a plain shell", () => {
    const found = labels(state({ agent: null }));
    expect(found).not.toContain("Schedule a message…");
    expect(found).toContain("Copy");
    expect(found).toContain("All terminal AI features…");
  });

  it("offers to stop a Team that is running, as a destructive action", () => {
    const nodes = terminalMenuModel(state({ teamRunning: true }), actions());
    expect(item(nodes, "Stop the running Team").danger).toBe(true);
    expect(terminalMenuLabels(nodes)).not.toContain("Start a Team here…");
  });

  it("greys out Copy with nothing selected", () => {
    expect(item(terminalMenuModel(state(), actions()), "Copy").disabled).toBe(true);
    expect(item(terminalMenuModel(state({ hasSelection: true }), actions()), "Copy").disabled).toBe(false);
  });

  it("runs the action the entry names", () => {
    const spies = actions();
    const nodes = terminalMenuModel(state(), spies);
    for (const node of nodes) {
      if (node.kind === "separator" || node.kind === "heading") continue;
      node.run();
    }

    expect(spies.toggleAutoContinue).toHaveBeenCalledOnce();
    expect(spies.scheduleMessage).toHaveBeenCalledOnce();
    expect(spies.startTeam).toHaveBeenCalledOnce();
    expect(spies.showFeatures).toHaveBeenCalledOnce();
    expect(spies.stopTeam).not.toHaveBeenCalled();
  });
});
