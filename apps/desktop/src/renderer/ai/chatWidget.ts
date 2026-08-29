/**
 * The chat, trace, and inline-diff widgets.
 *
 * Brief §5.3: "The AI surface is **floating widgets**, not a docked side panel. Panels
 * force a layout decision on every session; widgets appear where the work is and get out
 * of the way."
 *
 * - Chat: floating, draggable, resizable, summoned by shortcut, remembers its position
 *   per workspace, "dismisses on Escape without losing the conversation."
 * - Trace: "shows the agent's *workings*, live... Collapsed to one line by default,
 *   expandable to full detail. This is what makes the AI legible instead of magical, and
 *   it is what a developer will judge the feature on."
 * - Inline diff: accepted or rejected per hunk. Nothing is written to disk unseen.
 *
 * Only `transform` and `opacity` animate (§1) - the card is positioned with a translate,
 * never with `left`/`top`, so dragging never triggers layout.
 */
import type {
  AiAutomationView,
  AiTeamSuggestionView,
  AiTeamView,
  AiWorkspaceChangeView,
  AiWorkspaceTaskView,
  ChatSessionView,
  ProposedEditView,
} from "../../shared/api.ts";
import { runChatWidgetIntent } from "./chatWidgetIntents.ts";
import {
  aiWorkspaceActions,
  formatAiWorkspaceUsage,
  summarizeAiWorkspaceTask,
  traceTone,
} from "./aiWorkspaceViewModel.ts";
import {
  aiTeamActions,
  aiTeamStateLabel,
  buildAiTeamConfigureInput,
  extractTeamFileHints,
  formatAiTeamUsage,
  manualTeamSuggestion,
} from "./aiTeamViewModel.ts";
import {
  aiAutomationCanCancel,
  aiAutomationCanRunMissed,
  summarizeAiAutomation,
} from "./aiAutomationViewModel.ts";
import {
  aiAutomationTargets,
  onAiAutomationTargetsChanged,
} from "./automationHost.ts";

interface Position {
  x: number;
  y: number;
}

/** §5.3: "Remembers position per workspace." */
function positionKey(workspace: string | null): string {
  return `adcode.chat.position.${workspace ?? "no-workspace"}`;
}

function loadPosition(workspace: string | null): Position | null {
  try {
    const raw = localStorage.getItem(positionKey(workspace));
    if (raw === null) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;

    const { x, y } = parsed as Position;
    return typeof x === "number" && typeof y === "number" ? { x, y } : null;
  } catch {
    return null;
  }
}

function savePosition(workspace: string | null, position: Position): void {
  try {
    localStorage.setItem(positionKey(workspace), JSON.stringify(position));
  } catch {
    // A full or disabled storage costs a remembered position, nothing more.
  }
}

export interface ChatWidget {
  toggle(): void;
  open(): void;
  /** Bring chat forward and open the existing, confirmed Team setup flow. */
  openTeamSetup(): void;
  /** Bring chat forward and open the existing local schedule composer. */
  openScheduleComposer(): void;
  close(): void;
  isOpen(): boolean;
  /**
   * Open the card with a question already asked.
   *
   * The Problems panel's "Explain this" is the caller: a diagnostic it has no rewrite for
   * is exactly the case where the assistant earns its place. It sends rather than merely
   * prefilling, because the user already expressed the intent by clicking a button that
   * says what it does - and if no provider is configured, the send fails and the card's
   * own header already reads "No API key", which is the honest answer to why.
   */
  ask(question: string): void;
  setWorkspace(root: string | null): void;
  /**
   * Fires whenever the card opens or closes.
   *
   * The title bar's assistant button reflects this in `aria-pressed`, and the card can go
   * away without the button being touched - Escape dismisses it, and so does its own Close
   * - so polling the command that opened it would leave the button claiming otherwise.
   */
  onVisibilityChange(listener: (open: boolean) => void): void;
}

export interface ChatWidgetDeps {
  readonly host: HTMLElement;
  readonly openExternalPath: (path: string) => void;
  /** Open the Connect screen, which owns providers, keys and models. */
  readonly openConnect: () => void;
  /** Ask the user for a new name, or null if they changed their mind. */
  readonly askForName: (current: string) => Promise<string | null>;
}

export function createChatWidget(deps: ChatWidgetDeps): ChatWidget {
  let workspace: string | null = null;
  let open = false;
  let position: Position = { x: 0, y: 0 };
  let streamingBubble: HTMLElement | null = null;

  const card = document.createElement("section");
  card.className = "chat-card";
  card.hidden = true;
  card.setAttribute("role", "complementary");
  card.setAttribute("aria-label", "Assistant");

  /* ── Header (drag handle) ─────────────────────────────────────────────── */

  const header = document.createElement("header");
  header.className = "chat-header";

  const title = document.createElement("span");
  title.className = "chat-title";
  title.textContent = "Assistant";

  const modelLabel = document.createElement("span");
  modelLabel.className = "chat-model";

  const historyButton = document.createElement("button");
  historyButton.className = "ghost-button";
  historyButton.textContent = "History";
  historyButton.title = "Past conversations in this project";
  historyButton.setAttribute("aria-expanded", "false");
  historyButton.addEventListener("click", () => toggleHistory());

  const connectButton = document.createElement("button");
  connectButton.className = "ghost-button";
  connectButton.textContent = "Connect";
  connectButton.title = "Choose a provider and model";
  connectButton.addEventListener("click", () => deps.openConnect());

  const resetButton = document.createElement("button");
  resetButton.className = "ghost-button";
  resetButton.textContent = "New";
  resetButton.title = "Start a new conversation - the current one is kept in History";
  resetButton.addEventListener("click", () => {
    window.adcode.ai.reset();
    transcript.replaceChildren();
    streamingBubble = null;
    renderMemory(null);
    void refreshHistory();
  });

  const closeButton = document.createElement("button");
  closeButton.className = "ghost-button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", () => api.close());

  header.append(title, modelLabel, historyButton, connectButton, resetButton, closeButton);

  /* ── Transcript ───────────────────────────────────────────────────────── */

  const transcript = document.createElement("div");
  transcript.className = "chat-transcript";
  transcript.setAttribute("aria-live", "polite");

  /* ── Composer ─────────────────────────────────────────────────────────── */

  /* -- History ---------------------------------------------------------- */

  const history = document.createElement("aside");
  history.className = "chat-history";
  history.hidden = true;
  history.setAttribute("aria-label", "Past conversations");

  const historySearch = document.createElement("input");
  historySearch.className = "chat-history-search";
  historySearch.type = "search";
  historySearch.placeholder = "Search conversations";
  historySearch.setAttribute("aria-label", "Search conversations");
  historySearch.addEventListener("input", () => renderHistory());

  const historyList = document.createElement("div");
  historyList.className = "chat-history-list";

  const clearAll = document.createElement("button");
  clearAll.type = "button";
  clearAll.className = "chat-history-clear";
  clearAll.textContent = "Clear all";
  clearAll.title = "Delete every saved conversation for this project";
  clearAll.addEventListener("click", () => {
    void window.adcode.chat.clear().then((sessions) => {
      saved = sessions;
      renderHistory();
    });
  });

  history.append(historySearch, historyList, clearAll);

  let saved: readonly ChatSessionView[] = [];

  async function refreshHistory(): Promise<void> {
    saved = await window.adcode.chat.sessions();
    renderHistory();
  }

  function toggleHistory(): void {
    history.hidden = !history.hidden;
    historyButton.setAttribute("aria-expanded", String(!history.hidden));
    if (!history.hidden) void refreshHistory();
  }

  function renderHistory(): void {
    const needle = historySearch.value.trim().toLowerCase();
    historyList.replaceChildren();

    const shown = saved.filter((session) => {
      if (needle.length === 0) return true;
      if (session.title.toLowerCase().includes(needle)) return true;
      // Searching inside the conversation, because people remember a phrase from the
      // middle of one rather than whatever its first line happened to be.
      return session.messages.some((message) => message.text.toLowerCase().includes(needle));
    });

    if (shown.length === 0) {
      const empty = document.createElement("p");
      empty.className = "chat-history-empty";
      empty.textContent =
        saved.length === 0 ? "No conversations yet." : "Nothing matches that.";
      historyList.append(empty);
      return;
    }

    for (const session of shown) {
      const row = document.createElement("div");
      row.className = "chat-history-row";

      const openIt = document.createElement("button");
      openIt.type = "button";
      openIt.className = "chat-history-open";
      openIt.textContent = session.title;
      openIt.title = "Reopen this conversation";
      openIt.addEventListener("click", () => void resume(session.id));

      const rename = document.createElement("button");
      rename.type = "button";
      rename.className = "chat-history-action";
      rename.textContent = "Rename";
      rename.addEventListener("click", () => {
        void deps.askForName(session.title).then(async (name) => {
          if (name === null) return;
          saved = await window.adcode.chat.rename(session.id, name);
          renderHistory();
        });
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chat-history-action";
      remove.textContent = "Delete";
      remove.addEventListener("click", () => {
        void window.adcode.chat.remove(session.id).then((sessions) => {
          saved = sessions;
          renderHistory();
        });
      });

      row.append(openIt, rename, remove);
      historyList.append(row);
    }
  }

  /** Draw a past conversation back into the transcript. */
  async function resume(id: string): Promise<void> {
    const session = await window.adcode.chat.resume(id);
    if (session === null) return;

    transcript.replaceChildren();
    streamingBubble = null;

    for (const message of session.messages) {
      bubble(message.role === "user" ? "user" : "assistant", message.text);
    }

    renderMemory(session);
    history.hidden = true;
    historyButton.setAttribute("aria-expanded", "false");
  }

  /* -- What is being remembered ----------------------------------------- */

  /*
   * The strip exists so that clearing a conversation is a button whose effect is visible.
   * An assistant that remembers invisibly is worse than one that forgets.
   */
  const memory = document.createElement("div");
  memory.className = "chat-memory";

  function renderMemory(session: ChatSessionView | null): void {
    const turns = session?.messages.length ?? 0;

    memory.textContent =
      turns === 0
        ? "New conversation - nothing remembered yet."
        : `Carrying ${String(turns)} message${turns === 1 ? "" : "s"} from this conversation.`;
  }

  renderMemory(null);

  /* -- Isolated task status -------------------------------------------- */

  let activeWorkspaceTask: AiWorkspaceTaskView | null = null;
  let taskRefreshGeneration = 0;

  const taskStrip = document.createElement("section");
  taskStrip.className = "ai-workspace-strip";
  taskStrip.hidden = true;
  taskStrip.setAttribute("aria-label", "Isolated AI task");

  const taskState = document.createElement("span");
  taskState.className = "ai-workspace-state";

  const taskUsage = document.createElement("span");
  taskUsage.className = "ai-workspace-usage";

  const taskNotice = document.createElement("span");
  taskNotice.className = "ai-workspace-notice";
  taskNotice.setAttribute("role", "status");

  const taskReview = document.createElement("button");
  taskReview.type = "button";
  taskReview.className = "ghost-button";
  taskReview.textContent = "Review";

  const taskTrace = document.createElement("button");
  taskTrace.type = "button";
  taskTrace.className = "ghost-button";
  taskTrace.textContent = "Trace";

  const taskDiscard = document.createElement("button");
  taskDiscard.type = "button";
  taskDiscard.className = "ghost-button ai-workspace-danger";
  taskDiscard.textContent = "Discard";

  const taskRollback = document.createElement("button");
  taskRollback.type = "button";
  taskRollback.className = "ghost-button";
  taskRollback.textContent = "Roll back";

  taskStrip.append(taskState, taskUsage, taskNotice, taskReview, taskTrace, taskDiscard, taskRollback);

  /* -- Team suggestion and progress ----------------------------------- */

  let activeTeam: AiTeamView | null = null;
  let activeSuggestion: AiTeamSuggestionView | null = null;
  let suggestionPrompt = "";
  let teamRefreshGeneration = 0;
  let suggestionGeneration = 0;
  let suggestionTimer: number | null = null;

  const teamPanel = document.createElement("section");
  teamPanel.className = "ai-team-panel";
  teamPanel.hidden = true;
  teamPanel.setAttribute("aria-label", "AI Team");

  const teamTop = document.createElement("div");
  teamTop.className = "ai-team-top";
  const teamState = document.createElement("span");
  teamState.className = "ai-team-state";
  const teamUsage = document.createElement("span");
  teamUsage.className = "ai-team-usage";
  teamTop.append(teamState, teamUsage);

  const teamRoles = document.createElement("div");
  teamRoles.className = "ai-team-roles";

  const teamReason = document.createElement("p");
  teamReason.className = "ai-team-reason";

  const teamNotice = document.createElement("p");
  teamNotice.className = "ai-team-notice";
  teamNotice.setAttribute("role", "status");

  const teamActions = document.createElement("div");
  teamActions.className = "ai-team-actions";
  const teamSetup = document.createElement("button");
  teamSetup.type = "button";
  teamSetup.className = "chat-send";
  teamSetup.textContent = "Set up Team";
  const teamStart = document.createElement("button");
  teamStart.type = "button";
  teamStart.className = "chat-send";
  teamStart.textContent = "Start Team";
  const teamTrace = document.createElement("button");
  teamTrace.type = "button";
  teamTrace.className = "ghost-button";
  teamTrace.textContent = "Trace";
  const teamReview = document.createElement("button");
  teamReview.type = "button";
  teamReview.className = "ghost-button";
  teamReview.textContent = "Review";
  const teamConflict = document.createElement("button");
  teamConflict.type = "button";
  teamConflict.className = "ghost-button";
  teamConflict.textContent = "Conflicts";
  const teamCancel = document.createElement("button");
  teamCancel.type = "button";
  teamCancel.className = "ghost-button ai-workspace-danger";
  teamCancel.textContent = "Cancel";
  const teamDismiss = document.createElement("button");
  teamDismiss.type = "button";
  teamDismiss.className = "ghost-button";
  teamDismiss.textContent = "Not now";
  teamActions.append(
    teamSetup,
    teamStart,
    teamTrace,
    teamReview,
    teamConflict,
    teamCancel,
    teamDismiss,
  );
  teamPanel.append(teamTop, teamRoles, teamReason, teamNotice, teamActions);

  /* -- Scheduled AI messages ----------------------------------------- */

  const automationPanel = document.createElement("section");
  automationPanel.className = "ai-automation-panel";
  automationPanel.hidden = true;
  automationPanel.setAttribute("aria-label", "Scheduled AI messages");

  const automationTop = document.createElement("div");
  automationTop.className = "ai-automation-top";
  const automationTitle = document.createElement("span");
  automationTitle.className = "ai-automation-title";
  automationTitle.textContent = "Schedule a message";
  const automationClose = document.createElement("button");
  automationClose.type = "button";
  automationClose.className = "ghost-button";
  automationClose.textContent = "Close";
  automationTop.append(automationTitle, automationClose);

  const automationFields = document.createElement("div");
  automationFields.className = "ai-automation-fields";
  const automationTarget = document.createElement("select");
  automationTarget.className = "ai-automation-target";
  automationTarget.setAttribute("aria-label", "AI target");
  const automationDue = document.createElement("input");
  automationDue.className = "ai-automation-due";
  automationDue.type = "datetime-local";
  automationDue.setAttribute("aria-label", "Delivery time");
  const automationCreate = document.createElement("button");
  automationCreate.type = "button";
  automationCreate.className = "chat-send";
  automationCreate.textContent = "Schedule";
  automationFields.append(automationTarget, automationDue, automationCreate);

  const automationNotice = document.createElement("p");
  automationNotice.className = "ai-automation-notice";
  automationNotice.setAttribute("role", "status");
  automationNotice.textContent = "Messages run only while ADCode is open and this project is active.";

  const automationList = document.createElement("div");
  automationList.className = "ai-automation-list";
  automationPanel.append(automationTop, automationFields, automationNotice, automationList);

  const composer = document.createElement("form");
  composer.className = "chat-composer";

  const input = document.createElement("textarea");
  input.className = "chat-input";
  input.rows = 2;
  input.placeholder = "Ask about this project…";
  input.setAttribute("aria-label", "Message the assistant");

  const sendButton = document.createElement("button");
  sendButton.className = "chat-send";
  sendButton.type = "submit";
  sendButton.textContent = "Send";

  const manualTeam = document.createElement("button");
  manualTeam.className = "chat-team-button";
  manualTeam.type = "button";
  manualTeam.textContent = "Team";
  manualTeam.title = "Split this task into isolated AI roles";

  const scheduleMessage = document.createElement("button");
  scheduleMessage.className = "chat-team-button";
  scheduleMessage.type = "button";
  scheduleMessage.textContent = "Schedule";
  scheduleMessage.title = "Send this message later while ADCode is open";

  composer.append(input, manualTeam, scheduleMessage, sendButton);

  const resizeGrip = document.createElement("div");
  resizeGrip.className = "chat-resize";
  resizeGrip.setAttribute("aria-hidden", "true");

  const chatBody = document.createElement("div");
  chatBody.className = "chat-body";
  chatBody.append(history, transcript);

  card.append(header, taskStrip, teamPanel, automationPanel, chatBody, memory, composer, resizeGrip);

  window.adcode.chat.onChanged((session) => renderMemory(session));
  void window.adcode.chat.current().then((session) => renderMemory(session));
  deps.host.append(card);

  /* ── Rendering ────────────────────────────────────────────────────────── */

  function scrollToEnd(): void {
    transcript.scrollTop = transcript.scrollHeight;
  }

  function bubble(role: "user" | "assistant", text: string): HTMLElement {
    const element = document.createElement("div");
    element.className = `chat-bubble chat-bubble-${role}`;
    element.textContent = text;
    transcript.append(element);
    scrollToEnd();
    return element;
  }

  /**
   * One trace line. §5.3: "Collapsed to one line by default, expandable to full detail."
   * A `<details>` gives that for free, with correct keyboard and screen-reader behaviour.
   */
  function trace(summary: string, detail: string, state: "running" | "ok" | "error"): HTMLElement {
    const element = document.createElement("details");
    element.className = "trace-entry";
    element.dataset["state"] = state;

    const line = document.createElement("summary");
    line.className = "trace-summary";
    line.textContent = summary;

    const body = document.createElement("pre");
    body.className = "trace-detail";
    body.textContent = detail;

    element.append(line, body);
    transcript.append(element);
    scrollToEnd();
    return element;
  }

  function showOnlyTeamActions(visible: readonly HTMLButtonElement[]): void {
    const shown = new Set(visible);
    for (const button of [
      teamSetup,
      teamStart,
      teamTrace,
      teamReview,
      teamConflict,
      teamCancel,
      teamDismiss,
    ]) {
      button.hidden = !shown.has(button);
    }
  }

  function renderTeamRole(label: string, state: string): void {
    const role = document.createElement("span");
    role.className = "ai-team-role";
    role.dataset["state"] = state;
    role.textContent = label;
    teamRoles.append(role);
  }

  function paintTeamSuggestion(suggestion: AiTeamSuggestionView, prompt: string): void {
    activeSuggestion = suggestion;
    suggestionPrompt = prompt;
    teamPanel.hidden = false;
    teamPanel.dataset["mode"] = "suggestion";
    teamPanel.dataset["state"] = "configured";
    teamState.textContent = "Team suggested";
    teamUsage.textContent = `${String(suggestion.estimatedParallelMinutes.min)}-${String(
      suggestion.estimatedParallelMinutes.max,
    )} min · up to ${String(Math.ceil(suggestion.estimatedTokens.max / 1_000))}k tokens`;
    teamRoles.replaceChildren();
    for (const role of suggestion.roles) renderTeamRole(role.label, "suggested");
    teamReason.textContent = suggestion.reasons.join(" ");
    teamNotice.textContent = "Review the roles first. No agent starts until you confirm Start Team.";
    showOnlyTeamActions([teamSetup, teamDismiss]);
  }

  function paintTeam(team: AiTeamView | null): void {
    activeTeam = team;
    activeSuggestion = null;
    teamNotice.textContent = "";
    if (team === null) {
      teamPanel.hidden = true;
      return;
    }
    teamPanel.hidden = false;
    teamPanel.dataset["mode"] = "team";
    teamPanel.dataset["state"] = team.state;
    teamState.textContent = aiTeamStateLabel(team.state);
    teamUsage.textContent = formatAiTeamUsage(team);
    teamRoles.replaceChildren();
    for (const role of team.roles) {
      const nodes = team.nodes.filter((node) => node.roleId === role.id);
      const state =
        nodes.find((node) => node.state === "running")?.state ??
        nodes.find((node) => node.state === "failed" || node.state === "blocked")?.state ??
        (nodes.every((node) => node.state === "completed") ? "completed" : nodes[0]?.state ?? "pending");
      renderTeamRole(role.label, state);
    }
    const completed = team.nodes.filter((node) => node.state === "completed").length;
    teamReason.textContent =
      team.state === "configured"
        ? "The role plan is saved. Starting captures one immutable base and may use your connected model."
        : `${String(completed)} of ${String(team.nodes.length)} tasks complete · ${String(team.concurrency)} max in parallel`;
    const actions = aiTeamActions(team);
    const visibleActions: HTMLButtonElement[] = [];
    if (actions.start) visibleActions.push(teamStart);
    if (actions.trace) visibleActions.push(teamTrace);
    if (actions.review) visibleActions.push(teamReview);
    if (actions.conflict) visibleActions.push(teamConflict);
    if (actions.cancel) visibleActions.push(teamCancel);
    showOnlyTeamActions(visibleActions);
  }

  async function refreshTeam(): Promise<void> {
    const generation = ++teamRefreshGeneration;
    const teams = await window.adcode.aiTeam.list().catch(() => []);
    if (generation === teamRefreshGeneration) paintTeam(teams[0] ?? null);
  }

  async function renderTeamTrace(team: AiTeamView): Promise<void> {
    teamTrace.disabled = true;
    try {
      const events = await window.adcode.aiTeam.traces(team.id);
      if (events.length === 0) {
        teamNotice.textContent = "No Team trace events yet.";
        return;
      }
      for (const event of events) {
        const lane = event.nodeId === null ? "Team" : event.nodeId;
        trace(`${lane} · ${event.summary}`, event.detail, traceTone(event.outcome));
      }
    } finally {
      teamTrace.disabled = false;
    }
  }

  function renderTeamConflicts(team: AiTeamView): void {
    transcript.querySelectorAll(`[data-team-conflict="${team.id}"]`).forEach((node) => node.remove());
    for (const conflict of team.merge.conflicts) {
      const panel = document.createElement("div");
      panel.className = "diff-panel";
      panel.dataset["teamConflict"] = team.id;
      const heading = document.createElement("div");
      heading.className = "diff-heading";
      heading.textContent = `Team conflict — ${conflict.path}`;
      panel.append(heading);
      for (const proposal of conflict.proposals) {
        const roleHeading = document.createElement("div");
        roleHeading.className = "ai-team-conflict-role";
        roleHeading.textContent = proposal.nodeId;
        panel.append(roleHeading);
        for (const hunk of proposal.hunks) {
          const body = document.createElement("pre");
          body.className = "diff-body ai-team-conflict-hunk";
          for (const line of hunk.original) {
            const removed = document.createElement("span");
            removed.className = "diff-line diff-removed";
            removed.textContent = `- ${line}`;
            body.append(removed);
          }
          for (const line of hunk.replacement) {
            const added = document.createElement("span");
            added.className = "diff-line diff-added";
            added.textContent = `+ ${line}`;
            body.append(added);
          }
          panel.append(body);
        }
      }
      transcript.append(panel);
    }
    teamNotice.textContent = "No proposal was chosen automatically. Inspect each role before continuing.";
    scrollToEnd();
  }

  teamSetup.addEventListener("click", () => {
    const suggestion = activeSuggestion;
    if (suggestion === null || suggestionPrompt.length === 0) return;
    teamSetup.disabled = true;
    void window.adcode.aiTeam
      .configure(buildAiTeamConfigureInput(suggestionPrompt, suggestion))
      .then((team) => {
        paintTeam(team);
        bubble("user", `Team plan: ${suggestionPrompt}`);
        input.value = "";
      })
      .catch((error: unknown) => {
        teamNotice.textContent = error instanceof Error ? error.message : "Could not configure Team.";
      })
      .finally(() => {
        teamSetup.disabled = false;
      });
  });

  teamStart.addEventListener("click", () => {
    const team = activeTeam;
    if (team === null) return;
    teamStart.disabled = true;
    teamNotice.textContent = "Capturing the immutable project base…";
    void window.adcode.aiTeam
      .start(team.id)
      .then((started) => paintTeam(started))
      .catch((error: unknown) => {
        teamNotice.textContent = error instanceof Error ? error.message : "Could not start Team.";
      })
      .finally(() => {
        teamStart.disabled = false;
      });
  });

  teamTrace.addEventListener("click", () => {
    if (activeTeam !== null) void renderTeamTrace(activeTeam);
  });
  teamReview.addEventListener("click", () => {
    const combinedId = activeTeam?.merge.combinedTaskId;
    if (combinedId === null || combinedId === undefined) return;
    teamReview.disabled = true;
    void window.adcode.aiWorkspace
      .list()
      .then((tasks) => {
        const task = tasks.find((candidate) => candidate.id === combinedId);
        if (task === undefined) {
          teamNotice.textContent = "Combined review task was not found.";
          return;
        }
        paintWorkspaceTask(task);
        return renderPersistedReview(task);
      })
      .finally(() => {
        teamReview.disabled = false;
      });
  });
  teamConflict.addEventListener("click", () => {
    if (activeTeam !== null) renderTeamConflicts(activeTeam);
  });
  teamCancel.addEventListener("click", () => {
    const team = activeTeam;
    if (team === null || !window.confirm("Cancel this Team? Isolated proposals remain unavailable to the project.")) {
      return;
    }
    teamCancel.disabled = true;
    void window.adcode.aiTeam
      .cancel(team.id)
      .then((cancelled) => paintTeam(cancelled))
      .finally(() => {
        teamCancel.disabled = false;
      });
  });
  teamDismiss.addEventListener("click", () => {
    if (activeSuggestion !== null && activeSuggestion.dismissalKey !== "manual-team") {
      try {
        localStorage.setItem(activeSuggestion.dismissalKey, "dismissed");
      } catch {
        // A disabled local store costs only this remembered dismissal.
      }
    }
    activeSuggestion = null;
    teamPanel.hidden = true;
  });

  window.adcode.aiTeam.onChanged((team) => {
    if (activeTeam === null || activeTeam.id === team.id) paintTeam(team);
  });
  void refreshTeam();

  function localDateTimeValue(at: number): string {
    const date = new Date(at);
    const local = new Date(at - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  }

  function refreshAutomationTargets(): void {
    const selected = automationTarget.value;
    automationTarget.replaceChildren();
    for (const target of aiAutomationTargets()) {
      const option = document.createElement("option");
      option.value = target.id;
      option.textContent = target.label;
      automationTarget.append(option);
    }
    if ([...automationTarget.options].some((option) => option.value === selected)) {
      automationTarget.value = selected;
    }
    automationCreate.disabled = automationTarget.options.length === 0;
    if (automationTarget.options.length === 0 && !automationPanel.hidden) {
      automationNotice.textContent = "Connect the built-in assistant or start a supported terminal AI first.";
    }
  }

  function paintAutomations(items: readonly AiAutomationView[]): void {
    automationList.replaceChildren();
    const visible = items
      .filter((item) => item.state !== "cancelled")
      .sort((a, b) => {
        const activeA = aiAutomationCanCancel(a) ? 0 : 1;
        const activeB = aiAutomationCanCancel(b) ? 0 : 1;
        return activeA - activeB || a.dueAt - b.dueAt;
      })
      .slice(0, 4);
    for (const item of visible) {
      const row = document.createElement("div");
      row.className = "ai-automation-row";
      row.dataset["state"] = item.state;
      const copy = document.createElement("span");
      copy.className = "ai-automation-copy";
      copy.textContent = summarizeAiAutomation(item);
      copy.title = item.lastError === null ? item.message : `${item.message}\n${item.lastError}`;
      row.append(copy);
      if (aiAutomationCanRunMissed(item)) {
        const run = document.createElement("button");
        run.type = "button";
        run.className = "chat-send";
        run.textContent = "Run now";
        run.addEventListener("click", () => {
          if (!window.confirm("Run this missed AI message now?")) return;
          run.disabled = true;
          void window.adcode.aiAutomation.confirmMissed(item.id).then(() => refreshAutomations());
        });
        row.append(run);
      }
      if (aiAutomationCanCancel(item)) {
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "ghost-button ai-workspace-danger";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => {
          cancel.disabled = true;
          void window.adcode.aiAutomation.cancel(item.id).then(() => refreshAutomations());
        });
        row.append(cancel);
      }
      automationList.append(row);
    }
  }

  async function refreshAutomations(): Promise<void> {
    paintAutomations(await window.adcode.aiAutomation.list().catch(() => []));
  }

  function showScheduleComposer(): void {
    automationPanel.hidden = false;
    refreshAutomationTargets();
    if (automationDue.value.length === 0) {
      automationDue.value = localDateTimeValue(Date.now() + 15 * 60_000);
    }
    void refreshAutomations();
  }

  scheduleMessage.addEventListener("click", () => api.openScheduleComposer());

  automationClose.addEventListener("click", () => {
    automationPanel.hidden = true;
  });

  automationCreate.addEventListener("click", () => {
    const message = input.value.trim();
    const option = automationTarget.selectedOptions[0];
    const dueAt = new Date(automationDue.value).getTime();
    if (message.length === 0) {
      automationNotice.textContent = "Write the message in the composer first.";
      input.focus();
      return;
    }
    if (option === undefined || !Number.isFinite(dueAt)) {
      automationNotice.textContent = "Choose a connected AI and delivery time.";
      return;
    }
    automationCreate.disabled = true;
    void window.adcode.aiAutomation
      .create({ message, targetId: option.value, targetLabel: option.textContent, dueAt })
      .then((item) => {
        bubble("user", `Scheduled for ${item.targetLabel}: ${message}`);
        input.value = "";
        automationNotice.textContent = "Scheduled locally. It will run only while ADCode and this project are open.";
        return refreshAutomations();
      })
      .catch((error: unknown) => {
        automationNotice.textContent = error instanceof Error ? error.message : "Could not schedule the message.";
      })
      .finally(() => {
        automationCreate.disabled = automationTarget.options.length === 0;
      });
  });

  onAiAutomationTargetsChanged(refreshAutomationTargets);
  window.adcode.aiAutomation.onChanged(() => {
    if (!automationPanel.hidden) void refreshAutomations();
  });
  refreshAutomationTargets();

  function paintWorkspaceTask(task: AiWorkspaceTaskView | null): void {
    activeWorkspaceTask = task;
    taskStrip.hidden = task === null;
    taskNotice.textContent = "";
    if (task === null) return;

    taskStrip.dataset["state"] = task.state;
    taskState.textContent = summarizeAiWorkspaceTask(task);
    taskState.title = task.changedPaths.length === 0 ? task.prompt : task.changedPaths.join("\n");
    taskUsage.textContent = formatAiWorkspaceUsage(task);
    taskUsage.title = "Task token and cost budget";

    const actions = aiWorkspaceActions(task);
    taskReview.hidden = !actions.review;
    taskDiscard.hidden = !actions.discard;
    taskRollback.hidden = !actions.rollback;
    taskTrace.hidden = false;
  }

  async function refreshWorkspaceTask(): Promise<void> {
    const generation = ++taskRefreshGeneration;
    const task = await window.adcode.aiWorkspace.current().catch(() => null);
    if (generation === taskRefreshGeneration) paintWorkspaceTask(task);
  }

  function persistedDiff(task: AiWorkspaceTaskView, change: AiWorkspaceChangeView): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "diff-panel";
    panel.dataset["taskReview"] = task.id;

    const heading = document.createElement("div");
    heading.className = "diff-heading";
    heading.textContent = `Task change — ${change.path}`;
    panel.append(heading);

    const accepted = new Set(change.hunks.map((hunk) => hunk.id));
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "chat-send";
    apply.textContent = "Apply selected";

    for (const hunk of change.hunks) {
      const block = document.createElement("div");
      block.className = "diff-hunk";
      block.dataset["accepted"] = "true";

      const toggle = document.createElement("label");
      toggle.className = "diff-toggle";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) accepted.add(hunk.id);
        else accepted.delete(hunk.id);
        block.dataset["accepted"] = String(checkbox.checked);
        apply.disabled = accepted.size === 0;
      });
      const label = document.createElement("span");
      label.textContent = `Line ${String(hunk.startLine + 1)}`;
      toggle.append(checkbox, label);

      const body = document.createElement("pre");
      body.className = "diff-body";
      for (const line of hunk.original) {
        const removed = document.createElement("span");
        removed.className = "diff-line diff-removed";
        removed.textContent = `- ${line}`;
        body.append(removed);
      }
      for (const line of hunk.replacement) {
        const added = document.createElement("span");
        added.className = "diff-line diff-added";
        added.textContent = `+ ${line}`;
        body.append(added);
      }
      block.append(toggle, body);
      panel.append(block);
    }

    const actions = document.createElement("div");
    actions.className = "diff-actions";
    apply.addEventListener("click", () => {
      apply.disabled = true;
      void window.adcode.aiWorkspace
        .apply(task.id, [{ path: change.path, acceptedHunkIds: [...accepted] }])
        .then((result) => {
          paintWorkspaceTask(result.task);
          heading.textContent = result.ok ? `Applied — ${change.path}` : result.message;
          if (result.ok) actions.remove();
          else apply.disabled = false;
        })
        .catch(() => {
          heading.textContent = `Could not apply ${change.path}`;
          apply.disabled = false;
        });
    });
    actions.append(apply);
    panel.append(actions);
    return panel;
  }

  async function renderPersistedReview(task: AiWorkspaceTaskView): Promise<void> {
    taskReview.disabled = true;
    try {
      const changes = await window.adcode.aiWorkspace.changes(task.id);
      transcript.querySelectorAll(`[data-task-review="${task.id}"]`).forEach((node) => node.remove());
      if (changes.length === 0) {
        taskNotice.textContent = "No pending file changes.";
        return;
      }
      for (const change of changes) transcript.append(persistedDiff(task, change));
      scrollToEnd();
    } finally {
      taskReview.disabled = false;
    }
  }

  async function renderPersistedTrace(task: AiWorkspaceTaskView): Promise<void> {
    taskTrace.disabled = true;
    try {
      const events = await window.adcode.aiWorkspace.traces(task.id);
      if (events.length === 0) {
        taskNotice.textContent = "No operational trace events yet.";
        return;
      }
      for (const event of events) {
        trace(event.summary, event.detail, traceTone(event.outcome));
      }
    } finally {
      taskTrace.disabled = false;
    }
  }

  taskReview.addEventListener("click", () => {
    if (activeWorkspaceTask !== null) void renderPersistedReview(activeWorkspaceTask);
  });
  taskTrace.addEventListener("click", () => {
    if (activeWorkspaceTask !== null) void renderPersistedTrace(activeWorkspaceTask);
  });
  taskDiscard.addEventListener("click", () => {
    const task = activeWorkspaceTask;
    if (task === null || !window.confirm("Discard this isolated AI task and its pending changes?")) return;
    taskDiscard.disabled = true;
    void window.adcode.aiWorkspace
      .discard(task.id)
      .then((discarded) => {
        paintWorkspaceTask(discarded);
        taskNotice.textContent = discarded === null ? "Task was not found." : "Sandbox changes discarded.";
      })
      .finally(() => {
        taskDiscard.disabled = false;
      });
  });
  taskRollback.addEventListener("click", () => {
    const task = activeWorkspaceTask;
    if (task === null) return;
    taskRollback.disabled = true;
    void window.adcode.aiWorkspace
      .rollback(task.id)
      .then((result) => {
        paintWorkspaceTask(result.task);
        taskNotice.textContent = result.message;
      })
      .finally(() => {
        taskRollback.disabled = false;
      });
  });

  window.adcode.aiWorkspace.onChanged((task) => paintWorkspaceTask(task));
  void refreshWorkspaceTask();

  function inlineDiff(edit: ProposedEditView): void {
    const panel = document.createElement("div");
    panel.className = "diff-panel";

    const heading = document.createElement("div");
    heading.className = "diff-heading";
    heading.textContent = `${edit.summary} — ${edit.displayPath}`;

    const accepted = new Set(edit.hunks.map((hunk) => hunk.id));
    panel.append(heading);

    for (const hunk of edit.hunks) {
      const block = document.createElement("div");
      block.className = "diff-hunk";

      const toggle = document.createElement("label");
      toggle.className = "diff-toggle";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) accepted.add(hunk.id);
        else accepted.delete(hunk.id);
        block.dataset["accepted"] = String(checkbox.checked);
      });

      const label = document.createElement("span");
      label.textContent = `Line ${hunk.startLine + 1}`;
      toggle.append(checkbox, label);

      const body = document.createElement("pre");
      body.className = "diff-body";

      for (const line of hunk.original) {
        const removed = document.createElement("span");
        removed.className = "diff-line diff-removed";
        removed.textContent = `- ${line}`;
        body.append(removed);
      }
      for (const line of hunk.replacement) {
        const added = document.createElement("span");
        added.className = "diff-line diff-added";
        added.textContent = `+ ${line}`;
        body.append(added);
      }

      block.dataset["accepted"] = "true";
      block.append(toggle, body);
      panel.append(block);
    }

    const actions = document.createElement("div");
    actions.className = "diff-actions";

    const apply = document.createElement("button");
    apply.className = "chat-send";
    apply.textContent = "Apply selected";
    apply.addEventListener("click", () => {
      if (accepted.size === 0) {
        heading.textContent = `Select at least one change in ${edit.displayPath}`;
        return;
      }
      apply.disabled = true;
      void window.adcode.aiWorkspace
        .apply(edit.taskId, [{ path: edit.relativePath, acceptedHunkIds: [...accepted] }])
        .then((result) => {
          paintWorkspaceTask(result.task);
          heading.textContent = result.ok
            ? `Applied ${accepted.size} of ${edit.hunks.length} to ${edit.displayPath}`
            : result.message;
          if (result.ok) {
            actions.remove();
            deps.openExternalPath(edit.path);
          } else {
            apply.disabled = false;
          }
        })
        .catch(() => {
          heading.textContent = `Could not apply ${edit.displayPath}`;
          apply.disabled = false;
        });
    });

    const reject = document.createElement("button");
    reject.className = "ghost-button";
    reject.textContent = "Reject all";
    reject.addEventListener("click", () => {
      // Applying nothing is how a rejection is recorded: the proposal is discarded and
      // the file is left byte-identical.
      void window.adcode.ai.applyHunks(edit.path, []).then(() => {
        heading.textContent = `Rejected — ${edit.displayPath} is unchanged`;
        actions.remove();
      });
    });

    actions.append(apply, reject);
    panel.append(actions);
    transcript.append(panel);
    scrollToEnd();
  }

  /* ── Events from the agent ────────────────────────────────────────────── */

  window.adcode.ai.onEvent((raw) => {
    const event = raw as { kind: string; [key: string]: unknown };

    switch (event.kind) {
      case "text": {
        // Append to the live bubble rather than creating one per delta.
        streamingBubble ??= bubble("assistant", "");
        streamingBubble.textContent = `${streamingBubble.textContent ?? ""}${String(event["text"])}`;
        scrollToEnd();
        break;
      }

      case "thinking":
        trace("Thinking", String(event["text"]), "running");
        break;

      case "tool-call": {
        const call = event["call"] as { name: string; input: unknown };
        streamingBubble = null;
        trace(`Using ${call.name}`, JSON.stringify(call.input, null, 2), "running");
        break;
      }

      case "tool-result": {
        const isError = event["isError"] === true;
        trace(
          `${isError ? "Failed" : "Result"}: ${String(event["name"])}`,
          String(event["content"]).slice(0, 4000),
          isError ? "error" : "ok",
        );
        break;
      }

      case "refusal":
        streamingBubble = null;
        bubble("assistant", `The model declined this request. ${String(event["detail"] ?? "")}`.trim());
        break;

      case "error":
        streamingBubble = null;
        trace("Error", String(event["detail"] ?? "unknown"), "error");
        break;

      case "cancelled":
        streamingBubble = null;
        trace("Cancelled", "You stopped this turn.", "ok");
        break;

      case "turn-end":
        streamingBubble = null;
        sendButton.disabled = false;
        break;
    }
  });

  window.adcode.ai.onProposedEdit((edit) => {
    streamingBubble = null;
    inlineDiff(edit);
  });

  /* ── Sending ──────────────────────────────────────────────────────────── */

  function submit(): void {
    const text = input.value.trim();
    if (text.length === 0) return;

    if (activeSuggestion !== null) {
      activeSuggestion = null;
      teamPanel.hidden = true;
    }

    bubble("user", text);
    input.value = "";
    sendButton.disabled = true;
    streamingBubble = null;

    void window.adcode.ai.send(text).catch(() => {
      sendButton.disabled = false;
    });
  }

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });

  input.addEventListener("keydown", (event) => {
    // Enter sends, Shift+Enter is a newline - the convention every chat surface uses.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });

  function canOfferAnotherTeam(): boolean {
    return (
      activeTeam === null ||
      activeTeam.state === "completed" ||
      activeTeam.state === "cancelled"
    );
  }

  async function suggestForComposer(manual: boolean): Promise<void> {
    const prompt = input.value.trim();
    if (prompt.length === 0) {
      input.placeholder = "Describe the task, then choose Team";
      input.focus();
      return;
    }
    if (!canOfferAnotherTeam()) {
      teamNotice.textContent = "Finish or cancel the current Team before setting up another.";
      return;
    }
    const generation = ++suggestionGeneration;
    const fileHints = extractTeamFileHints(prompt);
    const suggested = await window.adcode.aiTeam
      .suggest({
        prompt,
        contextTokens: Math.ceil(prompt.length / 3),
        fileHints,
      })
      .catch(() => null);
    if (generation !== suggestionGeneration || input.value.trim() !== prompt) return;
    const result = suggested ?? (manual ? manualTeamSuggestion(prompt) : null);
    if (result === null) return;
    if (!manual) {
      try {
        if (localStorage.getItem(result.dismissalKey) === "dismissed") return;
      } catch {
        // A disabled local store means the suggestion may return next time.
      }
    }
    if (activeTeam?.state === "completed" || activeTeam?.state === "cancelled") activeTeam = null;
    paintTeamSuggestion(result, prompt);
  }

  manualTeam.addEventListener("click", () => api.openTeamSetup());

  input.addEventListener("input", () => {
    if (suggestionTimer !== null) window.clearTimeout(suggestionTimer);
    if (!canOfferAnotherTeam() || input.value.trim().length < 20) {
      if (activeSuggestion !== null) {
        activeSuggestion = null;
        teamPanel.hidden = true;
      }
      return;
    }
    suggestionTimer = window.setTimeout(() => {
      suggestionTimer = null;
      void suggestForComposer(false);
    }, 350);
  });

  /* ── Dragging and resizing ────────────────────────────────────────────── */

  /**
   * A translation that keeps the header on screen.
   *
   * The card is anchored bottom-right and moved with a translate, so a large negative `y`
   * walks it off the top of the window - and the header is the drag handle, the model
   * picker and the close button. Once it was up there nothing could bring it back. This
   * is also what a saved position needs on the way in: the window it was saved from may
   * have been bigger than the one it is being restored into.
   *
   * The bottom and right edges are deliberately allowed to hang off. Only the header has
   * to stay reachable, and clamping all four would fight the user over a card they
   * dragged half off the edge on purpose.
   */
  function clamp(next: Position): Position {
    const box = card.getBoundingClientRect();

    /*
     * A hidden card has no box, and clamping against an empty rect is not conservative -
     * it is wrong. Every measurement below reads zero, so the "keep 48px on screen" floor
     * became `x >= 48` and each call pushed the card another 48px right. Two calls before
     * it was ever shown left it permanently 96px off the right edge.
     */
    if (box.width === 0 && box.height === 0) return next;

    // Where the card would sit with no translation at all.
    const restX = box.left - position.x;
    const restY = box.top - position.y;

    const KEEP = 48;
    const minX = -restX - box.width + KEEP;
    const maxX = window.innerWidth - restX - KEEP;
    const minY = -restY;
    const maxY = window.innerHeight - restY - KEEP;

    return {
      x: Math.min(Math.max(next.x, minX), Math.max(minX, maxX)),
      y: Math.min(Math.max(next.y, minY), Math.max(minY, maxY)),
    };
  }

  function place(next: Position): void {
    position = clamp(next);
    // A translate, never `left`/`top`: §1 allows only transform and opacity to animate,
    // and dragging with layout properties janks the editor behind it.
    card.style.transform = `translate(${position.x}px, ${position.y}px)`;
  }

  /*
   * Shrinking the window can strand a card that was perfectly placed a moment ago, so the
   * clamp is re-applied rather than only being checked while dragging. Passing the current
   * position back through `place` is enough - `clamp` re-reads the window each time.
   */
  window.addEventListener("resize", () => {
    place(position);
  });

  header.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).tagName === "BUTTON") return;

    const startX = event.clientX - position.x;
    const startY = event.clientY - position.y;
    header.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      place({ x: moveEvent.clientX - startX, y: moveEvent.clientY - startY });
    };

    const release = (): void => {
      header.removeEventListener("pointermove", move);
      header.removeEventListener("pointerup", release);
      savePosition(workspace, position);
    };

    header.addEventListener("pointermove", move);
    header.addEventListener("pointerup", release);
  });

  resizeGrip.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const startWidth = card.offsetWidth;
    const startHeight = card.offsetHeight;
    const startX = event.clientX;
    const startY = event.clientY;
    resizeGrip.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      /*
       * A ceiling as well as a floor. The minimums were always here; without maximums you
       * could drag the card larger than the window it lives in, and the CSS `max-width`
       * would then quietly disagree with the inline width - so the grip stopped following
       * the pointer and the card looked stuck.
       */
      const maxWidth = Math.max(320, window.innerWidth - 32);
      const maxHeight = Math.max(260, window.innerHeight - 72);

      const width = startWidth + (moveEvent.clientX - startX);
      const height = startHeight + (moveEvent.clientY - startY);

      card.style.width = `${Math.min(Math.max(320, width), maxWidth)}px`;
      card.style.height = `${Math.min(Math.max(260, height), maxHeight)}px`;

      // Growing downward or rightward can push the header off; re-clamp as it changes.
      place(position);
    };

    const release = (): void => {
      resizeGrip.removeEventListener("pointermove", move);
      resizeGrip.removeEventListener("pointerup", release);
    };

    resizeGrip.addEventListener("pointermove", move);
    resizeGrip.addEventListener("pointerup", release);
  });

  /* ── Open / close ─────────────────────────────────────────────────────── */

  const onKeydown = (event: KeyboardEvent): void => {
    // §5.3: "Dismisses on Escape without losing the conversation." The transcript and the
    // agent's history both survive - only the card is hidden.
    if (event.key === "Escape" && open) {
      event.preventDefault();
      api.close();
    }
  };

  const visibilityListeners: ((open: boolean) => void)[] = [];
  const announce = (): void => {
    for (const listener of visibilityListeners) listener(open);
  };

  const api: ChatWidget = {
    open(): void {
      if (open) return;
      open = true;
      announce();

      card.hidden = false;
      requestAnimationFrame(() => {
        /*
         * The first moment the card has a box, so the first moment its saved position can
         * honestly be checked against the window. Anything earlier measures a zero rect.
         */
        place(position);

        requestAnimationFrame(() => {
          card.dataset["state"] = "open";
          input.focus();
        });
      });

      void window.adcode.ai.status().then((status) => {
        modelLabel.textContent = status.ready
          ? status.activeModel
          : "No API key — add one in Settings";
      });
      void refreshWorkspaceTask();
      void refreshTeam();
      if (!automationPanel.hidden) void refreshAutomations();

      document.addEventListener("keydown", onKeydown);
    },

    openTeamSetup(): void {
      runChatWidgetIntent("team", {
        open: () => api.open(),
        showTeam: () => void suggestForComposer(true),
        showSchedule: showScheduleComposer,
      });
    },

    openScheduleComposer(): void {
      runChatWidgetIntent("schedule", {
        open: () => api.open(),
        showTeam: () => void suggestForComposer(true),
        showSchedule: showScheduleComposer,
      });
    },

    close(): void {
      if (!open) return;
      open = false;
      announce();

      delete card.dataset["state"];
      document.removeEventListener("keydown", onKeydown);
      window.setTimeout(() => {
        if (!open) card.hidden = true;
      }, 200);
    },

    toggle(): void {
      if (open) api.close();
      else api.open();
    },

    isOpen: () => open,

    ask(question: string): void {
      const text = question.trim();
      if (text.length === 0) return;

      api.open();
      input.value = text;

      // `open()` focuses the input across two animation frames. Submitting inside the same
      // tick would race that: the value lands, the frame callback fires afterwards, and
      // the user is left looking at their own question sitting unsent in the box.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => submit());
      });
    },

    setWorkspace(root: string | null): void {
      workspace = root;
      suggestionGeneration += 1;
      if (suggestionTimer !== null) {
        window.clearTimeout(suggestionTimer);
        suggestionTimer = null;
      }
      activeSuggestion = null;
      activeTeam = null;
      teamPanel.hidden = true;
      automationPanel.hidden = true;
      automationList.replaceChildren();
      place(loadPosition(root) ?? { x: 0, y: 0 });
      if (root === null) {
        paintWorkspaceTask(null);
      } else {
        void refreshWorkspaceTask();
        void refreshTeam();
      }
    },

    onVisibilityChange(listener): void {
      visibilityListeners.push(listener);
    },
  };

  place({ x: 0, y: 0 });
  return api;
}
