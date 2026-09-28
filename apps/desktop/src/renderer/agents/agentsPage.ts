/**
 * The Agents page: every agent run as a box on a live board, and the agents you have saved.
 *
 * Boxes sit in Working, Needs you and Ready, with today's finished runs folded underneath.
 * Each box has its agent's mascot, whose face follows the run. Starting a task makes a solo
 * run - one agent, its own isolated copy of the project - so several can work at once while
 * you keep chatting; the parallel limit and the budget are enforced in the main process.
 *
 * The board is rendered from `agentBoardModel.ts`, which is where its rules are tested. This
 * file is wiring: data in from IPC, keyed DOM updates out, and the actions behind each button.
 * Boxes are updated in place, so a mascot's animation never restarts on a status tick.
 */
import type { AiStatus, AiTeamView, AiWorkspaceTaskView } from "../../shared/api.ts";
import {
  AGENT_PROFILES_SETTING,
  buildNamedAgentTeam,
  buildSoloRun,
  continuationPrompt,
  parseAgentProfiles,
  removeAgentProfile,
  saveAgentProfile,
  type AgentProfile,
} from "../ai/agentProfiles.ts";
import { askThemed } from "../dialogs/confirmDialog.ts";
import { createIcon, ICON } from "../workbench/icons.ts";
import { agentBoxActions, boardSummary, buildBoard, evidenceChips, type BoxAction, type BoxColumn, type BoxModel } from "./agentBoardModel.ts";
import { openAgentEditorDialog, openNewTaskDialog, openRaceCompareDialog, openRunDetailDialog } from "./agentDialogs.ts";
import { checksFromTraces, riskFlags, type RiskFlag, type RunCheck } from "../../shared/runEvidence.ts";
import { createAgentMascot, mascotMoodForStatus, type AgentMascot } from "./agentMascot.ts";
import { defaultMascotFor, type MascotLook } from "./mascotStyle.ts";
import { STARTERS_MARKER, starterAgents } from "./starterAgents.ts";

export interface AgentsPageDeps {
  /** Runs start from an isolated copy of the files on disk, so unsaved edits are saved first. */
  readonly saveAllOpenFiles: () => void | Promise<void>;
  readonly chat: {
    busy(): { readonly busy: boolean; readonly title: string };
    onBusyChange(listener: (busy: boolean) => void): void;
  };
  readonly showChat: () => void;
  /** Put text in the chat's composer (never sends) and show the chat. */
  readonly draftInChat: (text: string) => void;
  /** Open a staged change in the existing review. */
  readonly reviewTask: (task: AiWorkspaceTaskView) => void;
  readonly openConnect: () => void;
  readonly openFolder: () => void;
  readonly askText: (title: string, body: string, value: string) => Promise<string | null>;
  /** The ad ledger's preformatted available balance, or "" when there is none to show. */
  readonly onEarnings?: (listener: (label: string) => void) => void;
}

export interface AgentsPage {
  readonly element: HTMLElement;
  shown(): void;
  hidden(): void;
  refresh(): Promise<void>;
  newTask(agentId?: string | null): void;
  newAgent(): void;
  /** New task with Race switched on. */
  newRace(): void;
  /** New task about something picked elsewhere, such as an element in Preview. */
  newTaskAbout(attachment: { readonly label: string; readonly text: string }): void;
}

const ACTION_LABEL: Readonly<Record<BoxAction, string>> = {
  stop: "Stop",
  start: "Start",
  review: "Review",
  apply: "Apply",
  "apply-continue": "Apply & continue",
  discard: "Discard",
  undo: "Undo",
  continue: "Continue",
  resolve: "Resolve",
  retry: "Run again",
  "open-chat": "Open in chat",
  "raise-cap": "Run with a higher cap",
  resume: "Resume",
  connect: "Connect a model",
  rethink: "Try another way",
  compare: "Compare",
};

const COLUMNS: readonly { readonly id: Exclude<BoxColumn, "finished">; readonly label: string; readonly empty: string }[] = [
  { id: "working", label: "Working", empty: "No agent is working. Start a task and it shows up here." },
  { id: "needs-you", label: "Needs you", empty: "Nothing is waiting for you." },
  { id: "ready", label: "Ready", empty: "Finished work that needs a look appears here." },
];

const CHAT_LOOK: MascotLook = { shape: "circle", color: "blue" };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : fallback;
}

interface BoxEntry {
  readonly li: HTMLLIElement;
  readonly open: HTMLButtonElement;
  readonly mascots: HTMLElement;
  readonly title: HTMLElement;
  readonly who: HTMLElement;
  readonly status: HTMLElement;
  readonly meta: HTMLElement;
  readonly race: HTMLElement;
  readonly evidence: HTMLElement;
  readonly warnings: HTMLElement;
  readonly actions: HTMLElement;
  mascotList: AgentMascot[];
  lookKey: string;
  actionKey: string;
  evidenceKey: string;
}

export function createAgentsPage(deps: AgentsPageDeps): AgentsPage {
  const element = el("div", "agents-page");
  element.setAttribute("aria-labelledby", "agents-title");

  /* ── Header ────────────────────────────────────────────────────────────── */
  const header = el("header", "agents-header");
  const headingBlock = el("div", "agents-heading");
  const title = el("h1", "agents-title", "Agents");
  title.id = "agents-title";
  const summary = el("p", "agents-summary", "Nothing running");
  summary.setAttribute("role", "status");
  summary.setAttribute("aria-live", "polite");
  // Spend beside earnings, as the ledger formats them: the renderer does no arithmetic on
  // ad money (§1), so there is deliberately no "ads covered X%".
  const earnings = el("p", "agents-earnings");
  earnings.hidden = true;
  deps.onEarnings?.((label) => {
    earnings.hidden = label === "";
    earnings.textContent = label === "" ? "" : `Your ad earnings: ${label} available`;
  });
  headingBlock.append(title, summary, earnings);
  const newTaskButton = el("button", "agents-primary", "New task");
  newTaskButton.type = "button";
  newTaskButton.prepend(createIcon(ICON.plus));
  newTaskButton.title = "Give an agent a task; it works in its own copy of the project";
  newTaskButton.addEventListener("click", () => newTask(null));
  const headerActions = el("div", "agents-header-actions");
  headerActions.append(newTaskButton);
  header.append(headingBlock, headerActions);

  const connectBanner = el("div", "agents-banner");
  connectBanner.hidden = true;
  const connectText = el("p", "", "Connect a model to run agents. Your key stays on this computer.");
  const connectButton = el("button", "agents-secondary", "Connect a model");
  connectButton.type = "button";
  connectButton.addEventListener("click", () => deps.openConnect());
  connectBanner.append(connectText, connectButton);

  const folderBanner = el("div", "agents-banner");
  folderBanner.hidden = true;
  const folderButton = el("button", "agents-secondary", "Open a project");
  folderButton.type = "button";
  folderButton.addEventListener("click", () => deps.openFolder());
  folderBanner.append(el("p", "", "Agents work on a project. Open a folder to start one."), folderButton);

  const notice = el("p", "agents-notice");
  notice.setAttribute("role", "alert");
  notice.hidden = true;
  let noticeTimer: number | undefined;
  function say(text: string): void {
    notice.textContent = text;
    notice.hidden = text === "";
    if (noticeTimer !== undefined) window.clearTimeout(noticeTimer);
    if (text !== "") noticeTimer = window.setTimeout(() => { notice.hidden = true; }, 9_000);
  }

  /* ── Board ─────────────────────────────────────────────────────────────── */
  const board = el("section", "agents-board");
  board.setAttribute("aria-label", "Agent runs");
  const columnLists = new Map<BoxColumn, { list: HTMLUListElement; count: HTMLElement; empty: HTMLElement }>();
  for (const column of COLUMNS) {
    const section = el("section", "agents-column");
    section.dataset["column"] = column.id;
    const heading = el("h2", "agents-column-title");
    heading.id = `agents-column-${column.id}`;
    const count = el("span", "agents-count", "0");
    heading.append(document.createTextNode(column.label), count);
    const list = el("ul", "agents-list");
    list.setAttribute("role", "list");
    list.setAttribute("aria-labelledby", heading.id);
    const empty = el("p", "agents-empty", column.empty);
    section.append(heading, list, empty);
    board.append(section);
    columnLists.set(column.id, { list, count, empty });
  }
  const finished = el("details", "agents-finished");
  const finishedSummary = el("summary", "agents-finished-summary", "Finished today (0)");
  const finishedList = el("ul", "agents-list agents-finished-list");
  finishedList.setAttribute("role", "list");
  finishedList.setAttribute("aria-label", "Finished today");
  finished.append(finishedSummary, finishedList);
  finished.hidden = true;
  columnLists.set("finished", { list: finishedList, count: finishedSummary, empty: el("p", "") });

  /* ── Library ───────────────────────────────────────────────────────────── */
  const library = el("section", "agents-library");
  library.setAttribute("aria-labelledby", "agents-library-title");
  const libraryHead = el("div", "agents-library-head");
  const libraryTitle = el("h2", "agents-library-title", "Your agents");
  libraryTitle.id = "agents-library-title";
  const libraryHint = el("p", "agents-library-hint", "Specialists you can hand a task to. Each has its own look, model and tools.");
  const selectButton = el("button", "agents-secondary", "Select for a Team");
  selectButton.type = "button";
  selectButton.setAttribute("aria-pressed", "false");
  selectButton.title = "Pick two to four agents to split one task";
  const libraryText = el("div", "");
  libraryText.append(libraryTitle, libraryHint);
  libraryHead.append(libraryText, selectButton);
  const teamBar = el("div", "agents-team-bar");
  teamBar.hidden = true;
  const teamText = el("p", "", "Pick two to four agents.");
  teamText.setAttribute("role", "status");
  const teamStart = el("button", "agents-primary", "Set up Team");
  teamStart.type = "button";
  const teamCancel = el("button", "agents-secondary", "Cancel");
  teamCancel.type = "button";
  teamBar.append(teamText, teamStart, teamCancel);
  const grid = el("ul", "agents-grid");
  grid.setAttribute("role", "list");
  grid.setAttribute("aria-labelledby", libraryTitle.id);
  library.append(libraryHead, teamBar, grid);

  element.append(header, connectBanner, folderBanner, notice, board, finished, library);

  /* ── State ─────────────────────────────────────────────────────────────── */
  let profiles: AgentProfile[] = [];
  const teams = new Map<string, AiTeamView>();
  let tasks: readonly AiWorkspaceTaskView[] = [];
  let status: AiStatus | null = null;
  let hasFolder = true;
  let visible = false;
  let selecting = false;
  const selected = new Set<string>();
  const entries = new Map<string, BoxEntry>();
  /** Proof of work per finished run, fetched once per update of that run. */
  const evidence = new Map<string, { readonly key: number; readonly checks: readonly RunCheck[]; readonly risks: readonly RiskFlag[] }>();
  const evidenceLoading = new Set<string>();
  let lastBoard: ReturnType<typeof buildBoard> | null = null;

  const profileFor = (id: string | undefined): AgentProfile | null => profiles.find((agent) => agent.id === id) ?? null;
  const lookFor = (id: string): MascotLook => profileFor(id)?.mascot ?? defaultMascotFor(id);

  /* ── Rendering ─────────────────────────────────────────────────────────── */
  // Coalesce a burst of change events into one render. A microtask rather than a frame: a
  // board in a hidden or occluded window must still be current when it is next shown.
  let renderQueued = false;
  function scheduleRender(): void {
    if (renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => { renderQueued = false; render(); });
  }

  function render(): void {
    const chat = deps.chat.busy();
    const now = Date.now();
    const next = buildBoard({ teams: [...teams.values()], tasks, chat: { streaming: chat.busy, title: chat.title }, now });
    lastBoard = next;
    summary.textContent = boardSummary(next);
    connectBanner.hidden = status === null || status.ready;
    folderBanner.hidden = hasFolder;
    const live = new Set<string>();
    for (const [column, target] of columnLists) {
      const boxes = next[column];
      for (const box of boxes) live.add(box.id);
      boxes.forEach((box, index) => {
        const entry = entries.get(box.id) ?? createEntry(box.id);
        updateEntry(entry, box, now);
        const at = target.list.children[index];
        if (at !== entry.li) target.list.insertBefore(entry.li, at ?? null);
      });
      if (column === "finished") {
        finished.hidden = boxes.length === 0;
        finishedSummary.textContent = `Finished today (${boxes.length})`;
      } else {
        target.count.textContent = String(boxes.length);
        target.count.dataset["count"] = String(boxes.length);
        target.empty.hidden = boxes.length > 0;
      }
    }
    for (const [id, entry] of entries) {
      if (live.has(id)) continue;
      entry.li.remove();
      entries.delete(id);
    }
    syncTicker(next.working.length > 0);
  }

  function createEntry(id: string): BoxEntry {
    const li = el("li", "agent-box");
    li.setAttribute("role", "listitem");
    li.dataset["id"] = id;
    const open = el("button", "agent-box-open");
    open.type = "button";
    const mascots = el("span", "agent-box-mascots");
    const text = el("span", "agent-box-text");
    const titleNode = el("strong", "agent-box-title");
    const who = el("span", "agent-box-who");
    const statusNode = el("span", "agent-box-status");
    const meta = el("span", "agent-box-meta");
    const race = el("span", "agent-box-race");
    race.hidden = true;
    text.append(race, titleNode, who, statusNode, meta);
    open.append(mascots, text);
    const evidence = el("div", "agent-box-evidence");
    evidence.setAttribute("aria-label", "Proof of work");
    const warnings = el("ul", "agent-box-warnings");
    const actions = el("div", "agent-box-actions");
    li.append(open, evidence, warnings, actions);
    open.addEventListener("click", () => {
      const box = findBox(id);
      if (box !== null) openDetail(box);
    });
    const entry: BoxEntry = { li, open, mascots, title: titleNode, who, status: statusNode, meta, race, evidence, warnings, actions, mascotList: [], lookKey: "", actionKey: "", evidenceKey: "" };
    entries.set(id, entry);
    return entry;
  }

  function updateEntry(entry: BoxEntry, box: BoxModel, now: number): void {
    entry.li.dataset["status"] = box.status;
    entry.li.dataset["kind"] = box.kind;
    const looks = box.kind === "chat" ? [CHAT_LOOK] : box.roleIds.slice(0, 3).map(lookFor);
    const lookKey = JSON.stringify(looks);
    const mood = mascotMoodForStatus(box.status);
    if (lookKey !== entry.lookKey) {
      entry.lookKey = lookKey;
      entry.mascotList = looks.map((look, index) => createAgentMascot({ look, mood, size: index === 0 ? 40 : 28 }));
      entry.mascots.replaceChildren(...entry.mascotList.map((mascot) => mascot.element));
      entry.mascots.dataset["count"] = String(looks.length);
    } else {
      for (const mascot of entry.mascotList) mascot.setMood(mood);
    }
    entry.title.textContent = box.title;
    entry.who.textContent = [box.agentLabel, box.modelLabel].filter(Boolean).join(" · ");
    entry.status.textContent = box.statusText;
    const running = box.column === "working";
    entry.meta.textContent = [
      box.files > 0 ? `${box.files} file${box.files === 1 ? "" : "s"}` : "",
      box.usage,
      box.cost ?? "",
      running ? elapsed(now - box.startedAt) : "",
    ].filter(Boolean).join(" · ");
    entry.race.hidden = box.raceLabel === null;
    entry.race.textContent = box.raceLabel ?? "";
    const proof = evidence.get(box.id);
    const chips = proof === undefined ? [] : evidenceChips(proof.checks, proof.risks);
    const evidenceKey = JSON.stringify(chips);
    if (evidenceKey !== entry.evidenceKey) {
      entry.evidenceKey = evidenceKey;
      entry.evidence.replaceChildren(...chips.map((chip) => {
        const node = el("span", "agent-chip", chip.text);
        node.dataset["tone"] = chip.tone;
        node.title = chip.title;
        return node;
      }));
    }
    entry.warnings.replaceChildren(...box.warnings.map((warning) => el("li", "", warning)));
    if (box.kind !== "chat" && box.combinedTaskId !== null && box.column !== "working") void loadEvidence(box);
    entry.open.setAttribute("aria-label", `${box.title}. ${box.agentLabel}. ${box.statusText}.${box.warnings.length > 0 ? ` Warning: ${box.warnings.join(". ")}.` : ""} Open details`);
    const actionKey = box.actions.join(",");
    if (actionKey !== entry.actionKey) {
      entry.actionKey = actionKey;
      entry.actions.replaceChildren(...box.actions.map((action, index) => {
        const control = el("button", index === 0 ? "agent-box-action agent-box-action-primary" : "agent-box-action", ACTION_LABEL[action]);
        control.type = "button";
        control.dataset["action"] = action;
        control.addEventListener("click", () => {
          const current = findBox(box.id);
          if (current !== null) void act(action, current, control);
        });
        return control;
      }));
    }
  }

  function findBox(id: string): BoxModel | null {
    if (lastBoard === null) return null;
    for (const column of ["working", "needs-you", "ready", "finished"] as const) {
      const box = lastBoard[column].find((candidate) => candidate.id === id);
      if (box !== undefined) return box;
    }
    return null;
  }

  let ticker: number | undefined;
  function syncTicker(needed: boolean): void {
    const want = needed && visible;
    if (want && ticker === undefined) ticker = window.setInterval(() => render(), 1_000);
    if (!want && ticker !== undefined) {
      window.clearInterval(ticker);
      ticker = undefined;
    }
  }

  function renderLibrary(): void {
    grid.replaceChildren();
    for (const agent of profiles) {
      const card = el("li", "agent-card");
      card.setAttribute("role", "listitem");
      card.dataset["selected"] = String(selected.has(agent.id));
      const mascot = createAgentMascot({ look: agent.mascot ?? defaultMascotFor(agent.id), mood: "happy", size: 44 });
      const text = el("div", "agent-card-text");
      const access = agent.toolAccess === undefined || agent.toolAccess === "all"
        ? "All tools"
        : agent.toolAccess === "read-only" ? "Read-only" : `${agent.toolAccess.length} tool${agent.toolAccess.length === 1 ? "" : "s"}`;
      text.append(el("strong", "agent-card-name", agent.name), el("span", "agent-card-model", `${agent.model} · ${access}`), el("p", "agent-card-instructions", agent.instructions));
      const actions = el("div", "agent-card-actions");
      if (selecting) {
        const pick = el("label", "agent-card-pick");
        const box = el("input", "");
        box.type = "checkbox";
        box.checked = selected.has(agent.id);
        box.setAttribute("aria-label", `Add ${agent.name} to the Team`);
        box.addEventListener("change", () => {
          if (box.checked && selected.size >= 4) {
            box.checked = false;
            teamText.textContent = "A Team has at most four agents.";
            return;
          }
          if (box.checked) selected.add(agent.id); else selected.delete(agent.id);
          card.dataset["selected"] = String(box.checked);
          syncTeamBar();
        });
        pick.append(box, document.createTextNode("In the Team"));
        actions.append(pick);
      } else {
        const run = el("button", "agent-box-action agent-box-action-primary", "Run");
        run.type = "button";
        run.setAttribute("aria-label", `Give ${agent.name} a task`);
        run.addEventListener("click", () => newTask(agent.id));
        const edit = el("button", "agent-box-action", "Edit");
        edit.type = "button";
        edit.setAttribute("aria-label", `Edit ${agent.name}`);
        edit.addEventListener("click", () => void editAgent(agent));
        const copy = el("button", "agent-box-action", "Duplicate");
        copy.type = "button";
        copy.setAttribute("aria-label", `Duplicate ${agent.name}`);
        copy.addEventListener("click", () => void duplicateAgent(agent));
        actions.append(run, edit, copy);
      }
      card.append(mascot.element, text, actions);
      grid.append(card);
    }
    const add = el("li", "agent-card agent-card-new");
    add.setAttribute("role", "listitem");
    const addButton = el("button", "agent-card-add", "New agent");
    addButton.type = "button";
    addButton.prepend(createIcon(ICON.plus));
    addButton.addEventListener("click", () => newAgent());
    add.append(addButton);
    grid.append(add);
    // A repaint of the board may need new looks for agents that were just edited.
    for (const entry of entries.values()) entry.lookKey = "";
    scheduleRender();
  }

  function syncTeamBar(): void {
    teamBar.hidden = !selecting;
    selectButton.setAttribute("aria-pressed", String(selecting));
    selectButton.textContent = selecting ? "Done selecting" : "Select for a Team";
    teamText.textContent = selected.size < 2 ? `Pick ${selected.size === 0 ? "two to four" : "at least one more"} agent${selected.size === 1 ? "" : "s"}.` : `${selected.size} agents selected.`;
    teamStart.disabled = selected.size < 2;
  }
  selectButton.addEventListener("click", () => {
    selecting = !selecting;
    if (!selecting) selected.clear();
    syncTeamBar();
    renderLibrary();
  });
  teamCancel.addEventListener("click", () => {
    selecting = false;
    selected.clear();
    syncTeamBar();
    renderLibrary();
  });
  teamStart.addEventListener("click", () => void setUpTeam());

  /* ── Data ──────────────────────────────────────────────────────────────── */
  function upsert(team: AiTeamView): void {
    teams.set(team.id, team);
    scheduleRender();
  }

  async function refresh(): Promise<void> {
    try {
      const [values, list, taskList, aiStatus, current] = await Promise.all([
        window.adcode.settings.read(),
        window.adcode.aiTeam.list().catch(() => [] as readonly AiTeamView[]),
        window.adcode.aiWorkspace.list().catch(() => [] as readonly AiWorkspaceTaskView[]),
        window.adcode.ai.status().catch(() => null),
        window.adcode.workspace.current().catch(() => null),
      ]);
      status = aiStatus;
      hasFolder = current !== null && typeof current === "object" && "root" in current;
      teams.clear();
      for (const team of list) teams.set(team.id, team);
      tasks = taskList;
      profiles = parseAgentProfiles(values[AGENT_PROFILES_SETTING]);
      await seedStarters();
      renderLibrary();
      render();
    } catch (error) {
      say(errorText(error, "Could not load agents."));
    }
  }

  /** Five ready-made agents, once, so the page is useful before anyone configures anything. */
  async function seedStarters(): Promise<void> {
    if (profiles.length > 0 || status === null || !status.activeProvider) return;
    let seeded = false;
    try { seeded = localStorage.getItem(STARTERS_MARKER) === "done"; } catch { seeded = false; }
    if (seeded) return;
    try { localStorage.setItem(STARTERS_MARKER, "done"); } catch { /* Optional storage: worst case they are offered again. */ }
    const starters = starterAgents({ provider: status.activeProvider, model: status.activeModel });
    const values = await window.adcode.settings.write(AGENT_PROFILES_SETTING, JSON.stringify(starters));
    profiles = parseAgentProfiles(values[AGENT_PROFILES_SETTING]);
  }

  async function persistProfiles(next: AgentProfile[]): Promise<void> {
    const values = await window.adcode.settings.write(AGENT_PROFILES_SETTING, JSON.stringify(next));
    profiles = parseAgentProfiles(values[AGENT_PROFILES_SETTING]);
    renderLibrary();
  }

  let taskRefresh: number | undefined;
  function scheduleTaskRefresh(): void {
    if (taskRefresh !== undefined) return;
    taskRefresh = window.setTimeout(() => {
      taskRefresh = undefined;
      void window.adcode.aiWorkspace.list().then((list) => { tasks = list; scheduleRender(); }).catch(() => undefined);
    }, 150);
  }

  window.adcode.aiTeam.onChanged((team) => upsert(team));
  window.adcode.aiWorkspace.onChanged(() => scheduleTaskRefresh());
  window.adcode.settings.onChanged((values) => {
    const next = parseAgentProfiles(values[AGENT_PROFILES_SETTING]);
    if (JSON.stringify(next) === JSON.stringify(profiles)) return;
    profiles = next;
    renderLibrary();
  });
  window.adcode.workspace.onChanged(() => { if (visible) void refresh(); });
  deps.chat.onBusyChange(() => scheduleRender());

  /* ── Starting work ─────────────────────────────────────────────────────── */
  /** What a finished run proved and risked: from its recorded steps and its diff, not its words. */
  async function loadEvidence(box: BoxModel): Promise<void> {
    if (box.combinedTaskId === null || evidenceLoading.has(box.id) || evidence.get(box.id)?.key === box.updatedAt) return;
    evidenceLoading.add(box.id);
    try {
      const [traces, changes] = await Promise.all([window.adcode.aiTeam.traces(box.id), window.adcode.aiWorkspace.changes(box.combinedTaskId)]);
      evidence.set(box.id, { key: box.updatedAt, checks: checksFromTraces(traces), risks: riskFlags(changes) });
      scheduleRender();
    } catch {
      // No proof to show is better than a wrong one; the box stays as it is.
    } finally {
      evidenceLoading.delete(box.id);
    }
  }

  async function startRun(prompt: string, agent: AgentProfile | null, capDollars?: number, group?: string): Promise<void> {
    try {
      await deps.saveAllOpenFiles();
      const input = buildSoloRun(prompt, agent, { ...(capDollars === undefined ? {} : { capDollars }), ...(group === undefined ? {} : { group }) });
      const configured = await window.adcode.aiTeam.configure(input);
      upsert(configured);
      try {
        upsert(await window.adcode.aiTeam.start(configured.id));
      } catch (error) {
        // It stays on the board under Needs you with Start, so the reason is fixable in place.
        say(errorText(error, "The agent could not start."));
      }
    } catch (error) {
      say(errorText(error, "Could not start the agent."));
    }
  }

  function newTask(agentId: string | null = null, extra: { readonly race?: boolean; readonly attachment?: { readonly label: string; readonly text: string } } = {}): void {
    void openNewTaskDialog({
      agents: profiles,
      agentId: profileFor(agentId ?? undefined)?.id ?? null,
      defaultModel: status?.activeModel ?? "",
      ...(extra.race === true ? { race: true } : {}),
      ...(extra.attachment === undefined ? {} : { attachment: extra.attachment }),
    }).then((request) => {
      if (request === null) return;
      if (request.raceAgentIds !== undefined) {
        // One lane per agent, same task, one group: compared when every lane is done.
        const group = `race-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
        for (const laneAgent of request.raceAgentIds) void startRun(request.prompt, profileFor(laneAgent ?? undefined), request.capDollars ?? profileFor(laneAgent ?? undefined)?.capDollars, group);
        say(`Race started with ${request.raceAgentIds.length} agents. Compare them when they finish.`);
        return;
      }
      void startRun(request.prompt, profileFor(request.agentId ?? undefined), request.capDollars);
    });
  }

  function followUp(box: BoxModel): void {
    const team = teams.get(box.id);
    if (team === undefined) return;
    const agent = profileFor(box.roleIds[0]);
    void openNewTaskDialog({
      agents: profiles,
      agentId: agent?.id ?? null,
      defaultModel: status?.activeModel ?? "",
      followUp: { title: box.title },
    }).then((request) => {
      if (request === null) return;
      const handoff = team.handoffs[team.handoffs.length - 1];
      const prompt = continuationPrompt(
        { prompt: team.prompt, summary: handoff?.summary ?? box.statusText, changedPaths: handoff?.changedPaths ?? [] },
        request.prompt,
      );
      void startRun(prompt, profileFor(request.agentId ?? undefined), request.capDollars);
    });
  }

  async function setUpTeam(): Promise<void> {
    const chosen = profiles.filter((agent) => selected.has(agent.id));
    if (chosen.length < 2) return;
    const request = await openNewTaskDialog({
      agents: profiles,
      agentId: null,
      defaultModel: status?.activeModel ?? "",
      team: { names: chosen.map((agent) => agent.name) },
    });
    if (request === null) return;
    try {
      await deps.saveAllOpenFiles();
      upsert(await window.adcode.aiTeam.configure(buildNamedAgentTeam(request.prompt, chosen)));
      selecting = false;
      selected.clear();
      syncTeamBar();
      renderLibrary();
      say("Team plan ready - press Start on its box under Needs you.");
    } catch (error) {
      say(errorText(error, "Could not set up the Team."));
    }
  }

  /* ── Box actions ───────────────────────────────────────────────────────── */
  function combinedTask(box: BoxModel): AiWorkspaceTaskView | null {
    return box.combinedTaskId === null ? null : (tasks.find((task) => task.id === box.combinedTaskId) ?? null);
  }

  async function applyAll(box: BoxModel): Promise<boolean> {
    if (box.combinedTaskId === null) return false;
    const changes = await window.adcode.aiWorkspace.changes(box.combinedTaskId);
    const result = await window.adcode.aiWorkspace.apply(box.combinedTaskId, changes.map((change) => ({ path: change.path, acceptedHunkIds: change.hunks.map((hunk) => hunk.id) })));
    if (!result.ok) say(result.message);
    scheduleTaskRefresh();
    return result.ok;
  }

  function chatSummary(box: BoxModel): string {
    const team = teams.get(box.id);
    const handoff = team?.handoffs[team.handoffs.length - 1];
    const files = handoff?.changedPaths ?? [];
    return [
      `About the agent run "${box.title}" (${box.agentLabel}, ${box.statusText}):`,
      handoff?.summary ? `It reported: ${handoff.summary}` : "",
      files.length > 0 ? `Files it changed: ${files.slice(0, 20).join(", ")}` : "",
      "",
      "",
    ].filter((line, index, all) => line !== "" || index >= all.length - 2).join("\n");
  }

  async function act(action: BoxAction, box: BoxModel, control?: HTMLButtonElement): Promise<void> {
    if (control) control.disabled = true;
    try {
      const team = teams.get(box.id);
      switch (action) {
        case "connect":
          deps.openConnect();
          return;
        case "open-chat":
          if (box.kind === "chat") deps.showChat();
          else deps.draftInChat(chatSummary(box));
          return;
        case "stop": {
          const running = box.column === "working";
          if (running && !await askThemed({ title: "Stop this agent?", body: "Its unfinished changes are thrown away. Your project is not touched.", confirmLabel: "Stop", danger: true })) return;
          upsert(await window.adcode.aiTeam.cancel(box.id));
          return;
        }
        case "start":
        case "resume":
          await deps.saveAllOpenFiles();
          upsert(await window.adcode.aiTeam.start(box.id));
          return;
        case "review":
        case "resolve": {
          const task = combinedTask(box);
          if (task !== null) deps.reviewTask(task);
          else openDetail(box);
          return;
        }
        case "apply":
          await applyAll(box);
          return;
        case "apply-continue":
          if (await applyAll(box)) followUp(box);
          return;
        case "discard": {
          if (box.combinedTaskId === null) return;
          if (!await askThemed({ title: "Discard this work?", body: "The agent's changes are thrown away. Your project files are not touched.", confirmLabel: "Discard", danger: true })) return;
          await window.adcode.aiWorkspace.discard(box.combinedTaskId);
          scheduleTaskRefresh();
          return;
        }
        case "undo": {
          if (box.combinedTaskId === null) return;
          const result = await window.adcode.aiWorkspace.rollback(box.combinedTaskId);
          if (!result.ok) say(result.message);
          scheduleTaskRefresh();
          return;
        }
        case "continue":
          followUp(box);
          return;
        case "rethink": {
          if (team === undefined) return;
          const reason = team.nodes.find((node) => node.failure !== null)?.failure ?? "it got stuck";
          await startRun(`${team.prompt}\n\nA previous attempt at this task was stopped - ${reason}. Do not repeat that approach: step back, check the assumption that kept failing, and try a different way.`, profileFor(box.roleIds[0]));
          return;
        }
        case "compare":
          openCompare(box);
          return;
        case "retry":
          if (team !== undefined) await startRun(team.prompt, profileFor(box.roleIds[0]));
          return;
        case "raise-cap": {
          if (team === undefined) return;
          const spent = team.budget.usedCostMicros / 1_000_000;
          const answer = await deps.askText("Run again with a higher cap", "The stopped run is closed and the task starts again with this cost cap, in US dollars.", String(Math.max(1, Math.ceil(spent * 2))));
          if (answer === null) return;
          const dollars = Number(answer);
          if (!Number.isFinite(dollars) || dollars <= 0) { say("A cost cap is an amount above zero, like 2 or 5.50."); return; }
          if (team.state !== "cancelled") await window.adcode.aiTeam.cancel(team.id).catch(() => undefined);
          await startRun(team.prompt, profileFor(box.roleIds[0]), dollars);
          return;
        }
      }
    } catch (error) {
      say(errorText(error, "That did not work. Try again."));
    } finally {
      if (control?.isConnected) control.disabled = false;
    }
  }

  /** Every lane of a race side by side; keeping one applies it and discards the rest. */
  function openCompare(box: BoxModel): void {
    if (lastBoard === null || box.group === null) return;
    const lanes = [...lastBoard.working, ...lastBoard["needs-you"], ...lastBoard.ready, ...lastBoard.finished].filter((lane) => lane.group === box.group).sort((a, b) => a.startedAt - b.startedAt);
    openRaceCompareDialog({
      lanes: lanes.map((lane) => {
        const proof = evidence.get(lane.id);
        const team = teams.get(lane.id);
        return {
          box: lane,
          mascot: createAgentMascot({ look: lookFor(lane.roleIds[0] ?? lane.id), mood: mascotMoodForStatus(lane.status), size: 36 }).element,
          summary: team?.handoffs.map((handoff) => handoff.summary).join("\n\n") ?? "",
          chips: proof === undefined ? [] : evidenceChips(proof.checks, proof.risks),
        };
      }),
      onKeep: (laneId) => void keepLane(laneId, lanes),
    });
  }

  async function keepLane(laneId: string, lanes: readonly BoxModel[]): Promise<void> {
    const kept = lanes.find((lane) => lane.id === laneId);
    if (kept === undefined) return;
    try {
      if (!await applyAll(kept)) return;
      for (const lane of lanes) {
        if (lane.id === laneId || lane.status !== "ready" || lane.combinedTaskId === null) continue;
        await window.adcode.aiWorkspace.discard(lane.combinedTaskId).catch(() => null);
      }
      scheduleTaskRefresh();
      say(`Kept ${kept.agentLabel}'s work; the other lanes were discarded.`);
    } catch (error) {
      say(errorText(error, "Could not keep that lane."));
    }
  }

  function openDetail(box: BoxModel): void {
    if (box.kind === "chat") { deps.showChat(); return; }
    const team = teams.get(box.id);
    const handoff = team?.handoffs[team.handoffs.length - 1];
    const task = combinedTask(box);
    const looks = box.roleIds.slice(0, 3).map(lookFor);
    const mascots = el("span", "agent-box-mascots");
    for (const [index, look] of looks.entries()) mascots.append(createAgentMascot({ look, mood: mascotMoodForStatus(box.status), size: index === 0 ? 48 : 32 }).element);
    openRunDetailDialog({
      box,
      summary: team?.handoffs.map((item) => item.summary).join("\n\n") ?? "",
      changedPaths: task?.changedPaths ?? handoff?.changedPaths ?? [],
      loadTraces: () => window.adcode.aiTeam.traces(box.id),
      mascot: mascots,
      evidence: evidence.get(box.id) ?? null,
      actions: [
        ...agentBoxActions(box.status, box.kind === "team" ? "team" : "solo")
          .filter((action) => action !== "open-chat")
          .map((action, index) => ({ label: ACTION_LABEL[action], primary: index === 0, run: () => void act(action, box) })),
        { label: "Open in chat", run: () => void act("open-chat", box) },
      ],
    });
  }

  /* ── Agents ────────────────────────────────────────────────────────────── */
  function validate(agent: AgentProfile): string | null {
    try {
      saveAgentProfile(profiles, agent);
      return null;
    } catch (error) {
      return errorText(error, "Check the agent's name, instructions and model.");
    }
  }

  async function editAgent(agent: AgentProfile | null): Promise<void> {
    const aiStatus = status ?? await window.adcode.ai.status().catch(() => null);
    const result = await openAgentEditorDialog({
      agent,
      providers: aiStatus?.providers ?? [],
      activeProvider: aiStatus?.activeProvider ?? "",
      activeModel: aiStatus?.activeModel ?? "",
      validate,
    });
    if (result === null) return;
    try {
      if (result.kind === "delete") {
        if (!await askThemed({ title: `Delete ${result.agent.name}?`, body: "Runs it already did stay on the board. This cannot be undone.", confirmLabel: "Delete", danger: true })) return;
        await persistProfiles(removeAgentProfile(profiles, result.agent.id));
        say(`${result.agent.name} deleted.`);
        return;
      }
      await persistProfiles(saveAgentProfile(profiles, result.agent));
      say(`${result.agent.name} saved.`);
    } catch (error) {
      say(errorText(error, "Could not save the agent."));
    }
  }

  async function duplicateAgent(agent: AgentProfile): Promise<void> {
    const copy: AgentProfile = { ...agent, id: `agent-${crypto.randomUUID()}`, name: `${agent.name} copy`.slice(0, 80) };
    try {
      await persistProfiles(saveAgentProfile(profiles, copy));
      say(`${copy.name} added.`);
    } catch (error) {
      say(errorText(error, "Could not duplicate the agent."));
    }
  }

  function newAgent(): void {
    void editAgent(null);
  }

  syncTeamBar();
  return {
    element,
    shown(): void {
      visible = true;
      void refresh();
    },
    hidden(): void {
      visible = false;
      syncTicker(false);
    },
    refresh,
    newTask: (agentId) => newTask(agentId ?? null),
    newRace: () => newTask(null, { race: true }),
    newTaskAbout: (attachment) => newTask(null, { attachment }),
    newAgent,
  };
}
