/**
 * The terminal panel: many terminals, one panel.
 *
 * Each terminal owns its own container and stays mounted while hidden, because xterm
 * rebuilds its whole viewport when reattached - and a terminal that loses its scrollback
 * every time you switch away from it is not a terminal you can work in.
 *
 * Splits are real side-by-side terminals within one tab, matching what VS Code calls a
 * split terminal; the tab strip lists tabs, not panes.
 */
import { createTerminalHost, type TerminalHost } from "./terminalHost.ts";
import { uniqueTerminalTitle } from "./terminalTitles.ts";
import { terminalMenuModel } from "./terminalMenu.ts";
import {
  createTerminalTeamRunner,
  type TerminalTeamRunner,
  type TerminalTeamStatus,
} from "./terminalTeamRunner.ts";
import { ICON, createIcon } from "../workbench/icons.ts";
import { createContextMenu, attachContextMenuDismissal } from "../workbench/contextMenu.ts";
import type { ThemeChoice } from "../../shared/api.ts";
import {
  createAiUsageLimitReader,
  type AiUsageLimitReader,
} from "@adcode/ai/continuation";
import type { DetectedAgent } from "@adcode/ai/agents";
import type { TeamPlan, TerminalTeamAssignment } from "@adcode/ai/terminalTeam";
import {
  refreshAiAutomationTargets,
  registerAiAutomationAdapter,
} from "../ai/automationHost.ts";

interface Pane {
  readonly id: number;
  readonly element: HTMLElement;
  readonly host: TerminalHost;
  agent: DetectedAgent | null;
  readonly limitReader: AiUsageLimitReader;
  continuationTimer: number | null;
  continuationArmTimer: number | null;
  continuationRetryAt: number | null;
  continuationAttempts: number;
  continuationDeadline: number | null;
  activityVersion: number;
  scheduleGrantVersion: number | null;
  /** Removes this pane's scheduled-message adapter when the pane goes away. */
  releaseAdapter: (() => void) | null;
}

interface Tab {
  readonly id: number;
  readonly element: HTMLElement;
  title: string;
  panes: Pane[];
  activePane: number;
}

export interface TerminalPanel {
  /** Open a new terminal, creating the panel if it is closed. */
  create(options?: { profileId?: string }): Promise<void>;
  /** The active tab's title, which is the shell it is running. */
  activeTitle(): string | null;
  /** Add a pane beside the active terminal. */
  split(): Promise<void>;
  close(): void;
  killActive(): void;
  killAll(): void;
  next(): void;
  previous(): void;
  clear(): void;
  /** Type a command into the active terminal and press return. */
  send(text: string): void;
  /** `adcode.ai.terminalAgentDetection`. */
  setAgentDetection(enabled: boolean): void;
  /** Opt-in literal `continue` after a detected agent reports a usage limit. */
  setAutoContinue(enabled: boolean, maxAttempts?: number): void;
  /** Whether automatic continuation is on, for the menu that offers to flip it. */
  autoContinue(): boolean;
  /** `adcode.ai.scheduledMessages`, so the menu can hide what would not be delivered. */
  setScheduling(enabled: boolean): void;
  /**
   * Run a Team plan across terminal panes, one external CLI per role.
   *
   * Each role gets its own pane and its own agent, and a node is only handed over once
   * everything it depends on has reported finished. Nothing is sandboxed: these CLIs edit
   * the real working tree, which is why the caller confirms the plan first.
   */
  startTeam(plan: TeamPlan, assignments: readonly TerminalTeamAssignment[]): Promise<void>;
  stopTeam(): void;
  teamStatus(): TerminalTeamStatus | null;
  /** Called whenever a Team task starts, finishes, or fails. */
  onTeamChanged(listener: () => void): () => void;
  /** Paste the clipboard into the active terminal. */
  paste(): void;
  /** Copy the active terminal's selection. */
  copy(): void;
  toggle(): Promise<void>;
  isOpen(): boolean;
  fit(): void;
  focus(): void;
  applyTheme(theme: ThemeChoice): void;
  count(): number;
}

export interface TerminalPanelDeps {
  /**
   * Where the terminals and the agent strip live.
   *
   * The terminal's own element, not the whole bottom panel. It used to be the panel, and
   * this file used to open and close it directly - which stopped working the moment the
   * panel grew tabs, because "close the terminal" and "close the panel" became different
   * actions and a terminal cannot know whether Problems is still on screen.
   */
  readonly container: HTMLElement;
  /** Ask the panel to show or hide this tab. Whoever owns the panel decides what that means. */
  readonly setOpen: (open: boolean) => void;
  readonly isOpen: () => boolean;
  readonly tabStrip: HTMLElement;
  readonly surface: HTMLElement;
  readonly profileId: () => string;
  /** The shell's display name, which becomes the tab's title. */
  readonly profileLabel: (profileId: string) => string;
  readonly cwd: () => string | null;
  readonly theme: () => ThemeChoice;
  readonly notify: (message: string) => void;
  /** Called whenever the panel opens or closes, so the editor can re-layout. */
  readonly onLayoutChange: () => void;
  /**
   * How an external agent connects to this project's memory.
   *
   * The same command the settings screen prints. Passed in rather than fetched here so this
   * file keeps knowing nothing about the memory package.
   */
  readonly mcpConnection?: () => Promise<{ command: string; available: boolean }>;
  /**
   * The three doors the right-click menu opens that are not the terminal's to own.
   *
   * Scheduling and Team both have composers in the Assistant, and the feature library is a
   * whole panel. The terminal knows when to offer them and nothing else about them, which
   * is what keeps this file from importing half the renderer.
   */
  readonly onScheduleMessage?: () => void;
  readonly onSetUpTeam?: () => void;
  readonly onShowFeatures?: () => void;
  /**
   * Called when the visible terminal changes.
   *
   * The tab strip hides itself at one terminal, so with named shells the panel header is
   * the only thing left that says whether that one terminal is cmd or Git Bash.
   */
  readonly onActiveTitle: (title: string | null) => void;
}

export function createTerminalPanel(deps: TerminalPanelDeps): TerminalPanel {
  const tabs: Tab[] = [];
  let activeTab: number | null = null;
  let nextId = 1;

  const findTab = (id: number): Tab | undefined => tabs.find((tab) => tab.id === id);
  const activePane = (): Pane | undefined => {
    const tab = activeTab === null ? undefined : findTab(activeTab);
    return tab?.panes[tab.activePane];
  };

  /**
   * Whether a pane can be handed a message right now, and why not when it cannot.
   *
   * Shared by the adapter's snapshot and its delivery so the reason the target was offered
   * and the reason delivery was refused can never disagree - they are the same three rules
   * read in the same order.
   */
  function paneDeliveryRefusal(pane: Pane | undefined): string | null {
    if (pane === undefined || pane.agent === null) return "No detected AI is in that terminal";
    if (pane.continuationTimer !== null || pane.continuationArmTimer !== null) {
      return "The terminal AI is waiting for a usage limit to reset";
    }
    if (pane.scheduleGrantVersion !== pane.activityVersion) {
      return "Confirm the terminal AI is waiting at its prompt before delivery";
    }
    return null;
  }

  function deliverToPane(pane: Pane | undefined, message: string): void {
    const refusal = paneDeliveryRefusal(pane);
    if (refusal !== null || pane === undefined) throw new Error(refusal ?? "No terminal");
    pane.scheduleGrantVersion = null;
    refreshAiAutomationTargets();
    pane.host.send(message);
  }

  /**
   * The active pane, as a scheduling target.
   *
   * Kept alongside the per-pane adapters below because messages scheduled before those
   * existed carry `terminal:active` as their target id, and a target that vanishes turns
   * every one of them into a missed delivery the user has to re-run by hand.
   */
  registerAiAutomationAdapter({
    snapshot: () => {
      const pane = activePane();
      const limited =
        pane !== undefined &&
        (pane.continuationTimer !== null || pane.continuationArmTimer !== null);
      const ready = pane !== undefined && paneDeliveryRefusal(pane) === null;
      return {
        id: "terminal:active",
        label: pane?.agent == null ? "Active terminal AI" : `${pane.agent.name} (active terminal)`,
        kind: "terminal" as const,
        connected: pane?.agent != null,
        promptState: limited ? ("limited" as const) : ready ? ("ready" as const) : ("ambiguous" as const),
        capabilities: { scheduledPrompts: true, cancellation: false, safeContinuation: true },
      };
    },
    deliver: (message) => deliverToPane(activePane(), message),
  });

  /**
   * One scheduling target per pane, named after the CLI running in it.
   *
   * With only the active-terminal target above, somebody running Grok, Codex and Kimi in
   * three split panes could schedule to exactly one of them - whichever happened to be
   * focused when the message came due, which is not a thing anyone can plan around. A
   * stable per-pane id lets a message name the CLI it was written for.
   */
  function registerPaneAdapter(pane: Pane): () => void {
    return registerAiAutomationAdapter({
      snapshot: () => {
        const limited = pane.continuationTimer !== null || pane.continuationArmTimer !== null;
        return {
          id: `terminal:pane:${pane.id}`,
          label: pane.agent === null ? `Terminal ${pane.id}` : `${pane.agent.name} · terminal ${pane.id}`,
          kind: "terminal" as const,
          connected: pane.agent !== null,
          promptState: limited
            ? ("limited" as const)
            : paneDeliveryRefusal(pane) === null
              ? ("ready" as const)
              : ("ambiguous" as const),
          capabilities: { scheduledPrompts: true, cancellation: false, safeContinuation: true },
        };
      },
      deliver: (message) => deliverToPane(pane, message),
    });
  }

  /* ── Team, across panes ─────────────────────────────────────────────── */

  /**
   * The Team runner drives panes it asks for; it never reaches into them itself.
   *
   * `openPane` splits the active tab while there is room and starts a new tab after that,
   * so a four-role plan does not end up refused by the four-pane split limit.
   */
  const team: TerminalTeamRunner = createTerminalTeamRunner({
    async openPane(roleLabel) {
      const tab = activeTab === null ? undefined : findTab(activeTab);

      /*
       * Both `split` and `create` report failure by notifying and returning, not by
       * throwing - they are wired to buttons, where a rejected promise is a silent
       * no-op. So the count is checked rather than the call: without that, a refused
       * split hands back the *previous* last pane, which is already running somebody
       * else's task, and the team dies on "pane is already busy" instead of on the
       * real reason.
       */
      if (tab !== undefined && tab.panes.length < 4) {
        const before = tab.panes.length;
        await split();
        const pane = tab.panes.length > before ? tab.panes[tab.panes.length - 1] : undefined;
        if (pane === undefined) throw new Error(`No terminal could be opened for ${roleLabel}`);
        return pane.id;
      }

      const tabsBefore = tabs.length;
      await create();
      const opened = tabs.length > tabsBefore && activeTab !== null ? findTab(activeTab) : undefined;
      const pane = opened?.panes[0];
      if (pane === undefined) throw new Error(`No terminal could be opened for ${roleLabel}`);
      return pane.id;
    },
    send(paneId, text) {
      paneById(paneId)?.host.send(text);
    },
    label(paneId, title) {
      const tab = tabs.find((candidate) => candidate.panes.some((pane) => pane.id === paneId));
      if (tab === undefined) return;
      tab.title = uniqueTerminalTitle(
        title,
        tabs.filter((other) => other !== tab).map((other) => other.title),
      );
      renderTabs();
      deps.onActiveTitle(activeTab === null ? null : (findTab(activeTab)?.title ?? null));
    },
    notify: (message) => deps.notify(message),
    now: () => Date.now(),
  });

  // A CLI that finished without printing the marker still has to release its pane. Once a
  // minute is often enough for a five-minute threshold and cheap enough to always run; the
  // timer lives as long as the window, like the panel itself.
  window.setInterval(() => team.sweep(), 60_000);

  /**
   * What the Team is doing, above the terminals.
   *
   * Renamed tab titles and a notification per finished task are real feedback, but neither
   * answers "how far through is it" - and four panes each showing one agent's scrollback is
   * precisely the situation where that is the only question worth asking. One line, only
   * while a team exists.
   */
  /*
   * Both strips share one grid cell.
   *
   * `.panel-body-terminal` defines exactly two rows, and `.agent-strip` is pinned to the
   * first - so a second strip placed the same way would sit on top of the memory offer
   * rather than under it. A flex wrapper in that one cell stacks however many strips the
   * panel grows without the grid needing to know about any of them.
   */
  const strips = document.createElement("div");
  strips.className = "terminal-strips";
  deps.container.prepend(strips);

  const teamStrip = document.createElement("div");
  teamStrip.className = "agent-strip team-strip";
  teamStrip.hidden = true;
  strips.append(teamStrip);

  const STATE_MARK: Readonly<Record<string, string>> = {
    completed: "done",
    running: "running",
    failed: "failed",
    blocked: "blocked",
    pending: "waiting",
    paused: "paused",
  };

  function renderTeamStrip(): void {
    const status = team.status();
    if (status === null) {
      teamStrip.hidden = true;
      teamStrip.replaceChildren();
      return;
    }

    const done = status.nodes.filter((node) => node.state === "completed").length;
    const headline = document.createElement("span");
    headline.className = "agent-strip-text";
    headline.textContent =
      status.state === "active"
        ? `Team: ${String(done)} of ${String(status.nodes.length)} done`
        : status.state === "completed"
          ? "Team: finished"
          : "Team: stopped with unfinished tasks";

    const detail = document.createElement("code");
    detail.className = "agent-strip-command";
    detail.textContent = status.nodes
      .map((node) => `${node.roleLabel} ${STATE_MARK[node.state] ?? node.state}`)
      .join("  ·  ");

    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "ghost-button";
    stop.textContent = status.state === "active" ? "Stop" : "Dismiss";
    stop.addEventListener("click", () => team.stop());

    teamStrip.replaceChildren(headline, detail, stop);
    teamStrip.hidden = false;
  }

  team.onChanged(renderTeamStrip);

  function paneById(id: number): Pane | undefined {
    for (const tab of tabs) {
      const pane = tab.panes.find((candidate) => candidate.id === id);
      if (pane !== undefined) return pane;
    }
    return undefined;
  }

  /* ── The right-click menu ───────────────────────────────────────────── */

  const menu = createContextMenu(deps.container);
  attachContextMenuDismissal(menu, () => activePane()?.host.focus());

  /**
   * Open the menu for the pane that was right-clicked.
   *
   * Everything the terminal's AI features can do was, until this menu existed, reachable
   * only from a settings screen and a panel on the other side of the window - so somebody
   * running an agent in here had no way to discover any of it. The right-click is where
   * people look for what an element can do.
   */
  function openPaneMenu(pane: Pane, x: number, y: number): void {
    const nodes = terminalMenuModel(
      {
        agent: pane.agent,
        autoContinue,
        continuationPending: pane.continuationTimer !== null || pane.continuationArmTimer !== null,
        schedulingEnabled,
        scheduleAllowed: pane.scheduleGrantVersion === pane.activityVersion,
        teamRunning: team.isRunning(),
        hasSelection: pane.host.hasSelection(),
      },
      {
        copy: () => void pane.host.copy(),
        paste: () => pane.host.paste(),
        clear: () => pane.host.clear(),
        split: () => void split(),
        close: () => {
          const tab = tabs.find((candidate) => candidate.panes.includes(pane));
          if (tab !== undefined) kill(tab.id);
        },
        toggleAutoContinue: () => {
          // Written to settings rather than flipped locally: the settings screen, the
          // Feature library and this menu must not be able to disagree about it.
          void window.adcode.settings.write("adcode.ai.autoContinue", !autoContinue);
        },
        cancelContinuation: () => {
          clearContinuation(pane);
          deps.notify("The pending continuation was cancelled.");
        },
        allowSchedule: () => {
          pane.scheduleGrantVersion = pane.activityVersion;
          refreshAiAutomationTargets();
          deps.notify(`${pane.agent?.name ?? "That terminal"} may receive its next scheduled message.`);
        },
        scheduleMessage: () => deps.onScheduleMessage?.(),
        startTeam: () => deps.onSetUpTeam?.(),
        stopTeam: () => team.stop(),
        showFeatures: () => deps.onShowFeatures?.(),
      },
    );

    menu.open(x, y, nodes);
  }

  /* ── The shared-memory offer ────────────────────────────────────────── */

  let agentDetection = true;
  let autoContinue = false;
  let autoContinueMaxAttempts = 3;
  let schedulingEnabled = true;

  function clearContinuation(pane: Pane): void {
    if (pane.continuationTimer !== null) window.clearTimeout(pane.continuationTimer);
    if (pane.continuationArmTimer !== null) window.clearTimeout(pane.continuationArmTimer);
    pane.continuationTimer = null;
    pane.continuationArmTimer = null;
    pane.continuationRetryAt = null;
  }

  function releaseAgent(pane: Pane): void {
    clearContinuation(pane);
    pane.agent = null;
    pane.limitReader.reset();
    pane.continuationAttempts = 0;
    pane.continuationDeadline = null;
    pane.scheduleGrantVersion = null;
    refreshAiAutomationTargets();
  }

  /**
   * Agents already offered to, this session.
   *
   * Offering again every time somebody restarts an agent is how a helpful strip becomes
   * something people close without reading. Once per agent, per run.
   */
  const offered = new Set<string>();

  const strip = document.createElement("div");
  strip.className = "agent-strip";
  strip.hidden = true;

  const stripText = document.createElement("span");
  stripText.className = "agent-strip-text";

  const stripCommand = document.createElement("code");
  stripCommand.className = "agent-strip-command";

  const stripCopy = document.createElement("button");
  stripCopy.type = "button";
  stripCopy.className = "ghost-button";
  stripCopy.textContent = "Copy";

  const stripSchedule = document.createElement("button");
  stripSchedule.type = "button";
  stripSchedule.className = "ghost-button";
  stripSchedule.textContent = "Allow next schedule";
  stripSchedule.hidden = true;

  const stripDismiss = document.createElement("button");
  stripDismiss.type = "button";
  stripDismiss.className = "ghost-button";
  stripDismiss.textContent = "Not now";
  stripDismiss.addEventListener("click", () => {
    strip.hidden = true;
  });

  strip.append(stripText, stripCommand, stripCopy, stripSchedule, stripDismiss);
  // Below the Team strip: an offer can wait, a running team is what you are watching.
  strips.append(strip);

  /**
   * Offer to connect a recognised agent to this project's memory.
   *
   * Nothing is shared by pressing Copy - it copies a command the user then chooses to run.
   * The offer is the whole feature; acting on it is theirs.
   */
  function offerMemory(agent: { id: string; name: string }): void {
    if (!agentDetection || offered.has(agent.id)) return;
    if (deps.mcpConnection === undefined) return;

    offered.add(agent.id);

    void deps.mcpConnection().then((connection) => {
      if (!connection.available) return;

      stripText.textContent = `${agent.name} can share this project's memory with ADCode. Run this once:`;
      stripCommand.textContent = connection.command;

      stripCopy.onclick = () => {
        void window.adcode.clipboard.writeText(connection.command).then(() => {
          stripCopy.textContent = "Copied";
          window.setTimeout(() => (stripCopy.textContent = "Copy"), 1400);
        });
      };

      strip.hidden = false;
    });
  }

  function renderTabs(): void {
    deps.tabStrip.replaceChildren();

    // One terminal needs no tab strip; the panel title already says what it is.
    deps.tabStrip.hidden = tabs.length < 2;

    for (const tab of tabs) {
      const button = document.createElement("button");
      button.className = "terminal-tab";
      button.type = "button";
      button.ariaSelected = String(tab.id === activeTab);
      button.title = tab.title;

      const label = document.createElement("span");
      label.textContent = tab.panes.length > 1 ? `${tab.title} (${tab.panes.length})` : tab.title;

      const close = document.createElement("button");
      close.className = "terminal-tab-close";
      close.type = "button";
      close.append(createIcon(ICON.close));
      close.ariaLabel = `Close ${tab.title}`;
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        kill(tab.id);
      });

      button.append(label, close);
      button.addEventListener("click", () => activate(tab.id));
      deps.tabStrip.append(button);
    }
  }

  function activate(id: number): void {
    activeTab = id;

    for (const tab of tabs) tab.element.hidden = tab.id !== id;

    renderTabs();
    fitActive();
    deps.onActiveTitle(findTab(id)?.title ?? null);
    findTab(id)?.panes[findTab(id)?.activePane ?? 0]?.host.focus();
    refreshAiAutomationTargets();
  }

  function fitActive(): void {
    const tab = activeTab === null ? undefined : findTab(activeTab);
    for (const pane of tab?.panes ?? []) pane.host.fit();
  }

  /** Start one pty and mount it into a pane element. */
  async function spawnPane(into: HTMLElement, profileId: string | undefined): Promise<Pane> {
    const element = document.createElement("div");
    element.className = "terminal-pane";
    into.append(element);

    const cwd = deps.cwd();
    let pane: Pane | null = null;
    const host = await createTerminalHost(element, {
      ...(profileId === undefined || profileId === "" ? {} : { profileId }),
      ...(cwd === null ? {} : { cwd }),
      theme: deps.theme(),
      onAgent: (agent) => {
        if (pane !== null) {
          pane.agent = agent;
          pane.limitReader.reset();
          pane.continuationAttempts = 0;
          pane.continuationDeadline = null;
          pane.activityVersion += 1;
          pane.scheduleGrantVersion = null;
          stripText.textContent = `${agent.name} detected. Confirm its prompt before scheduling terminal input.`;
          stripSchedule.hidden = false;
          stripSchedule.onclick = () => {
            if (pane?.agent?.id !== agent.id) return;
            pane.scheduleGrantVersion = pane.activityVersion;
            stripSchedule.textContent = "Next schedule allowed";
            refreshAiAutomationTargets();
          };
          strip.hidden = false;
          refreshAiAutomationTargets();
        }
        offerMemory(agent);
      },
      onOutput: (data) => {
        if (pane === null) return;
        // Before anything else: this is what tells a running Team its task has finished,
        // and it must not be skipped by any of the early returns below.
        team.observe(pane.id, data);
        pane.activityVersion += 1;
        if (pane.scheduleGrantVersion !== null) {
          pane.scheduleGrantVersion = null;
          stripSchedule.textContent = "Allow next schedule";
          refreshAiAutomationTargets();
        }
        if (pane.continuationTimer !== null) {
          clearContinuation(pane);
          deps.notify("Automatic continuation was cancelled because the terminal state changed.");
          return;
        }
        if (!autoContinue || pane.agent === null) return;
        const limit = pane.limitReader.push(data, Date.now());
        if (limit === null) {
          if (pane.continuationArmTimer !== null) clearContinuation(pane);
          return;
        }
        if (
          pane.continuationAttempts >= autoContinueMaxAttempts ||
          (pane.continuationDeadline !== null && limit.retryAt > pane.continuationDeadline)
        ) {
          clearContinuation(pane);
          deps.notify(`${pane.agent.name} reached the automatic continuation limit.`);
          return;
        }
        const agent = pane.agent;
        pane.continuationDeadline ??= Date.now() + 24 * 60 * 60_000;
        pane.continuationRetryAt = limit.retryAt;
        if (pane.continuationArmTimer !== null) window.clearTimeout(pane.continuationArmTimer);
        pane.continuationArmTimer = window.setTimeout(() => {
          pane!.continuationArmTimer = null;
          const retryAt = pane!.continuationRetryAt;
          if (retryAt === null || pane!.agent?.id !== agent.id) return;
          pane!.continuationTimer = window.setTimeout(() => {
            pane!.continuationTimer = null;
            pane!.continuationRetryAt = null;
            pane!.limitReader.reset();
            if (!autoContinue || pane!.agent?.id !== agent.id) return;
            pane!.continuationAttempts += 1;
            pane!.host.send("continue");
            deps.notify(`${agent.name} continued after its usage limit.`);
          }, Math.max(0, retryAt - Date.now()));
          deps.notify(
            `${agent.name} paused at its usage limit. ADCode will continue it at ${new Date(retryAt).toLocaleTimeString()}.`,
          );
        }, 1_000);
      },
      onUserInput: (data) => {
        if (pane === null) return;
        pane.activityVersion += 1;
        pane.scheduleGrantVersion = null;
        stripSchedule.textContent = "Allow next schedule";
        refreshAiAutomationTargets();
        if (pane.continuationTimer !== null || pane.continuationArmTimer !== null) {
          clearContinuation(pane);
          deps.notify("Automatic continuation was cancelled because you used the terminal.");
        }
        if (data.includes("\u0003") || data.includes("\u0004")) releaseAgent(pane);
      },
      onSubmittedLine: (line) => {
        if (pane !== null && /^\s*(?:\/)?(?:exit|quit)\s*$/i.test(line)) releaseAgent(pane);
      },
    });

    host.setAgentDetection(agentDetection);

    pane = {
      id: nextId++,
      element,
      host,
      agent: null,
      limitReader: createAiUsageLimitReader(),
      continuationTimer: null,
      continuationArmTimer: null,
      continuationRetryAt: null,
      continuationAttempts: 0,
      continuationDeadline: null,
      activityVersion: 0,
      scheduleGrantVersion: null,
      releaseAdapter: null,
    };
    pane.releaseAdapter = registerPaneAdapter(pane);

    const owned = pane;
    element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openPaneMenu(owned, event.clientX, event.clientY);
    });

    return pane;
  }

  async function create(options?: { profileId?: string }): Promise<void> {
    const wasClosed = !deps.isOpen();
    deps.setOpen(true);

    const element = document.createElement("div");
    element.className = "terminal-tab-body";
    deps.surface.append(element);

    const profileId = options?.profileId ?? deps.profileId();

    let pane: Pane;
    try {
      pane = await spawnPane(element, profileId);
    } catch (error) {
      element.remove();
      if (wasClosed && tabs.length === 0) deps.setOpen(false);
      deps.notify(error instanceof Error ? error.message : "could not start terminal");
      return;
    }

    const tab: Tab = {
      id: pane.id,
      element,
      title: uniqueTerminalTitle(
        deps.profileLabel(profileId),
        tabs.map((existing) => existing.title),
      ),
      panes: [pane],
      activePane: 0,
    };

    tabs.push(tab);
    activate(tab.id);
    deps.onLayoutChange();
  }

  async function split(): Promise<void> {
    const tab = activeTab === null ? undefined : findTab(activeTab);
    if (tab === undefined) {
      await create();
      return;
    }

    // Four panes in one tab is already unreadable at panel height; past that, a new tab
    // is what the user actually wants.
    if (tab.panes.length >= 4) {
      deps.notify("That terminal is already split four ways.");
      return;
    }

    try {
      const pane = await spawnPane(tab.element, deps.profileId());
      tab.panes.push(pane);
      tab.activePane = tab.panes.length - 1;
    } catch (error) {
      deps.notify(error instanceof Error ? error.message : "could not split terminal");
      return;
    }

    tab.element.dataset["panes"] = String(tab.panes.length);
    renderTabs();
    fitActive();
    tab.panes[tab.activePane]?.host.focus();
  }

  function kill(id: number): void {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;

    const [tab] = tabs.splice(index, 1);
    if (tab === undefined) return;

    for (const pane of tab.panes) {
      clearContinuation(pane);
      pane.releaseAdapter?.();
      pane.releaseAdapter = null;
      // Before disposing the host, so a Team task running here is failed with a reason
      // rather than left running against a pty that has gone.
      team.paneClosed(pane.id);
      pane.host.dispose();
    }
    tab.element.remove();

    if (tabs.length === 0) {
      activeTab = null;
      deps.setOpen(false);
      deps.onLayoutChange();
      deps.onActiveTitle(null);
      renderTabs();
      refreshAiAutomationTargets();
      return;
    }

    activate((tabs[index] ?? tabs[index - 1])!.id);
  }

  return {
    setAgentDetection(enabled: boolean): void {
      agentDetection = enabled;
      if (!enabled) strip.hidden = true;

      for (const tab of tabs) {
        for (const pane of tab.panes) pane.host.setAgentDetection(enabled);
      }
    },

    setAutoContinue(enabled: boolean, maxAttempts = 3): void {
      autoContinue = enabled;
      autoContinueMaxAttempts = Number.isFinite(maxAttempts)
        ? Math.min(5, Math.max(1, Math.floor(maxAttempts)))
        : 3;
      if (enabled) return;
      for (const tab of tabs) {
        for (const pane of tab.panes) {
          clearContinuation(pane);
          pane.limitReader.reset();
        }
      }
    },

    autoContinue: () => autoContinue,

    setScheduling(enabled: boolean): void {
      schedulingEnabled = enabled;
    },

    startTeam: (plan, assignments) => team.start(plan, assignments),
    stopTeam: () => team.stop(),
    teamStatus: () => team.status(),
    onTeamChanged: (listener) => team.onChanged(listener),

    create,
    split,

    activeTitle: () => (activeTab === null ? null : (findTab(activeTab)?.title ?? null)),

    close() {
      deps.setOpen(false);
      deps.onLayoutChange();
    },

    killActive() {
      if (activeTab !== null) kill(activeTab);
    },

    killAll() {
      for (const tab of [...tabs]) kill(tab.id);
    },

    next() {
      if (activeTab === null || tabs.length < 2) return;
      const at = tabs.findIndex((tab) => tab.id === activeTab);
      activate(tabs[(at + 1) % tabs.length]!.id);
    },

    previous() {
      if (activeTab === null || tabs.length < 2) return;
      const at = tabs.findIndex((tab) => tab.id === activeTab);
      activate(tabs[(at - 1 + tabs.length) % tabs.length]!.id);
    },

    clear() {
      const tab = activeTab === null ? undefined : findTab(activeTab);
      tab?.panes[tab.activePane]?.host.clear();
    },

    paste() {
      const tab = activeTab === null ? undefined : findTab(activeTab);
      tab?.panes[tab.activePane]?.host.paste();
    },

    copy() {
      const tab = activeTab === null ? undefined : findTab(activeTab);
      void tab?.panes[tab.activePane]?.host.copy();
    },

    send(text) {
      const tab = activeTab === null ? undefined : findTab(activeTab);
      tab?.panes[tab.activePane]?.host.send(text);
    },

    async toggle() {
      if (deps.isOpen()) {
        deps.setOpen(false);
        deps.onLayoutChange();
        return;
      }

      // Opening an empty panel would show a blank rectangle; the first open starts a
      // terminal, later ones just bring the panel back.
      if (tabs.length === 0) {
        await create();
        return;
      }

      deps.setOpen(true);
      deps.onLayoutChange();
      fitActive();
      this.focus();
    },

    isOpen: () => deps.isOpen(),
    fit: fitActive,

    focus() {
      const tab = activeTab === null ? undefined : findTab(activeTab);
      tab?.panes[tab.activePane]?.host.focus();
    },

    applyTheme(theme) {
      for (const tab of tabs) for (const pane of tab.panes) pane.host.applyTheme(theme);
    },

    count: () => tabs.length,
  };
}
