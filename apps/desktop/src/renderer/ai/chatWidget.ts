/**
 * The chat, trace, and inline-diff widgets.
 *
 * The same live conversation can sit beside the editor or in an expanded workspace.
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
import { createChatPreview } from "./chatPreview.ts";
import type { PreviewStatus } from "../../shared/api.ts";
import type {
  AiAttachmentView,
  AiEditorContextView,
  AiAutomationView,
  AiTeamSuggestionView,
  AiTeamView,
  AiWorkspaceChangeView,
  AiWorkspaceTaskView,
  ChatSessionView,
  ProposedEditView,
} from "../../shared/api.ts";
import {
  admitFiles,
  fileToAttachment,
  formatBytes,
  MAX_ATTACHMENTS,
  MAX_TEXT_CHARS,
  type AttachmentSource,
  type PendingAttachment,
} from "./attachments.ts";
import {
  createComposerMenu,
  matchSlashCommands,
  menuTriggerAt,
  rememberPrompt,
  replaceTrigger,
  type MenuTrigger,
  type SlashCommand,
} from "./composerMenu.ts";
import { runChatWidgetIntent } from "./chatWidgetIntents.ts";
import { createIcon, ICON } from "../workbench/icons.ts";
import type { CodeReference } from "../editor/codeReferences.ts";
import {
  groupChatSessions,
  renderChatMessageHtml,
} from "./chatMarkdown.ts";
import {
  createActivityBlock,
  createResultImage,
  formatFailedLabel,
  summarizeToolInput,
  toolHeaderLabel,
  type ActivityBlockHandle,
} from "./chatActivity.ts";
import { createAgentLibrary } from "./agentLibrary.ts";
import { createAssistantControls } from "./assistantControls.ts";
import { createFrameTask } from "../frameTask.ts";
import { attachChatLayout } from "./chatLayout.ts";
import {
  aiWorkspaceActions,
  formatAiWorkspaceUsage,
  summarizeAiWorkspaceTask,
  traceTone,
} from "./aiWorkspaceViewModel.ts";
import { copyText } from "../clipboard.ts";
import {
  aiTeamActions,
  aiTeamStateLabel,
  buildAiTeamConfigureInput,
  extractTeamFileHints,
  formatAiTeamUsage,
  manualTeamSuggestion,
  formatConnectionQueue,
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

export interface ChatWidget {
  readonly element: HTMLElement;
  readonly connectButton: HTMLButtonElement;
  /** Inspect any persisted task without replacing or resetting the active conversation. */
  reviewTask(task: AiWorkspaceTaskView): void;
  /** Prepare editable instructions; never sends or interrupts a running turn. */
  draft(question: string): void;
  setDocked(docked: boolean, historyHost?: HTMLElement): void;
  shown(focus?: boolean): void;
  hidden(): void;
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
  /**
   * Put text in the composer as a context chip - a selection from the editor, say - and
   * bring the composer forward. Never sends: the user adds their question first.
   */
  addContext(name: string, text: string): void;
  /** Bring the composer forward with its `/` command menu or `@` file menu open. */
  openComposerMenu(trigger: "/" | "@"): void;
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
  readonly openPreview?: () => void;
  readonly openExternalPath: (path: string) => void;
  readonly openCodeReference?: (reference: CodeReference) => void;
  /** Open the Connect screen, which owns providers, keys and models. */
  readonly openConnect: () => void;
  /** Save every open editor, so the isolated task can start from current files. */
  readonly saveAllOpenFiles: () => void;
  /** The coordinator owns the workspace shell and all dismissal. */
  readonly requestOpen: () => void;
  readonly requestClose: () => void;
  readonly togglePresentation?: () => void;
  readonly revealHistory?: () => void;
  /** Ask the user for a new name, or null if they changed their mind. */
  readonly askForName: (current: string) => Promise<string | null>;
  /** What the user is looking at; rides with each send so "this file" means something. */
  readonly editorContext?: () => AiEditorContextView | null;
  /** Workspace files matching an `@` query, as workspace-relative paths. */
  readonly mentionFiles?: (query: string) => Promise<readonly string[]>;
  /** A mentioned file's text: the open buffer when there is one, so unsaved edits count. */
  readonly readMention?: (relativePath: string) => Promise<string | null>;
  /** Uncommitted changes as a unified diff for /review and /commit, "" when clean. */
  readonly uncommittedDiff?: () => Promise<string>;
}

export function dispatchChatSend(
  text: string,
  deps: {
    readonly showUser: (text: string, attachments?: readonly AiAttachmentView[]) => void;
    readonly aiSend: (text: string, attachments?: readonly AiAttachmentView[]) => Promise<boolean>;
    readonly onFailure: () => void;
  },
  attachments: readonly AiAttachmentView[] = [],
): boolean {
  const message = text.trim();
  if (message.length === 0 && attachments.length === 0) return false;

  deps.showUser(message, attachments);
  // No attachments keeps the exact historical call shape; attachments ride along.
  const sent = attachments.length === 0 ? deps.aiSend(message) : deps.aiSend(message, attachments);
  void sent.then((ok) => { if (!ok) deps.onFailure(); }).catch(deps.onFailure);
  return true;
}

export function createChatWidget(deps: ChatWidgetDeps): ChatWidget {
  let open = false;
  let streamingBubble: HTMLElement | null = null;
  const messageSources = new WeakMap<HTMLElement, string>();
  window.adcode.settings.onChanged(() => { if (open) void refreshModelStatus(); });
  const dirtyMessages = new Set<HTMLElement>();
  const streamPaint = createFrameTask(() => {
    for (const element of dirtyMessages) {
      if (transcript.contains(element)) renderMessage(element, messageSources.get(element) ?? "");
    }
    dirtyMessages.clear();
    scrollToEnd();
  });
  function flushStream(): void {
    if (dirtyMessages.size) streamPaint.schedule();
    streamPaint.flush();
  }
  document.addEventListener("visibilitychange", () => {
    if (open && !document.hidden && dirtyMessages.size) streamPaint.schedule();
  });

  function wireMessageButtons(scope: HTMLElement): void {
    for (const copy of scope.querySelectorAll<HTMLButtonElement>(".chat-codeblock-copy")) {
      copy.addEventListener("click", () => {
        const code = copy.closest(".chat-codeblock")?.querySelector("code")?.textContent ?? "";
        copy.disabled = true;
        const done = (ok: boolean): void => {
          copy.textContent = ok ? "Copied" : "Copy failed";
          window.setTimeout(() => {
            copy.textContent = "Copy";
            copy.disabled = false;
          }, 1400);
        };
        void copyText(code).then(done, () => done(false));
      });
    }
    if (deps.openCodeReference) {
      const openReference = deps.openCodeReference;
      for (const link of scope.querySelectorAll<HTMLButtonElement>(".chat-code-reference[data-path]")) {
        link.title = `Open ${link.dataset["path"] ?? ""} at line ${link.dataset["line"] ?? "1"}`;
        link.addEventListener("click", () => {
          openReference({
            path: link.dataset["path"] ?? "",
            line: Number(link.dataset["line"] ?? 1),
            column: Number(link.dataset["column"] ?? 1),
          });
        });
      }
    }
  }

  function renderMessage(element: HTMLElement, text: string): void {
    messageSources.set(element, text);
    // Rich Claude-style HTML (escaped, code blocks, lists, inline code, file
    // links). Buttons are wired after insert so copy and open-file work.
    element.innerHTML = renderChatMessageHtml(text);
    wireMessageButtons(element);
  }

  const card = document.createElement("section");
  card.className = "chat-card";
  card.setAttribute("aria-label", "Assistant workspace");

  let historyOpen = false;
  let inspectorOpen = false;
  let docked = false;
  let externalHistory = false;

  /* ── Header ───────────────────────────────────────────────────────────── */

  const header = document.createElement("header");
  header.className = "chat-header";

  const title = document.createElement("span");
  title.className = "chat-title";
  title.textContent = "ADCode Assistant";

  // Claude-style conversation title: the active chat's name, updated on
  // resume / reset / history refresh. A plain label, not a menu - renaming
  // already lives on each history row.
  const conversationTitle = document.createElement("span");
  conversationTitle.className = "chat-conversation-title";
  conversationTitle.textContent = "New conversation";
  conversationTitle.title = "Current conversation";

  const modelLabel = document.createElement("button");
  modelLabel.type = "button";
  modelLabel.className = "chat-model";
  modelLabel.title = "Choose a provider and model (Connect)";
  modelLabel.setAttribute("aria-label", "Choose a provider and model");
  modelLabel.addEventListener("click", () => deps.openConnect());
  const queueLabel = document.createElement("span");
  queueLabel.className = "chat-queue-status";
  queueLabel.setAttribute("role", "status");
  queueLabel.hidden = true;
  let statusTimer: number | null = null;
  let statusRefreshInFlight = false;
  async function refreshModelStatus(): Promise<void> {
    // Guard overlapping 2s polls: a slow status read must never stack up and
    // flicker the pill. The pill keeps its last good value while refreshing.
    if (statusRefreshInFlight) return;
    statusRefreshInFlight = true;
    try {
      const status = await window.adcode.ai.status();
      const active = status.providers.find((provider) => provider.id === status.activeProvider);
      const saved = status.providers.some((provider) => provider.hasKey && provider.needsKey);
      const label = status.ready
        ? `${active?.displayName ?? status.activeProvider} / ${status.activeModel}`
        : saved ? "Select a saved connection" : "Connect a model to begin";
      // No flicker: only touch the DOM when the label actually changed.
      if (modelLabel.textContent !== label) modelLabel.textContent = label;
      connectButton.textContent = status.ready || saved ? "Models" : "Connect";
      modelLabel.dataset["ready"] = String(status.ready);
      modelLabel.title = status.ready
        ? `${status.activeModel} — change provider or model (Connect)`
        : "Choose a provider and model (Connect)";
      modelLabel.setAttribute("aria-label", status.ready
        ? `Model: ${status.activeModel}. Change provider or model`
        : "Choose a provider and model");
      setupStatus.dataset["state"] = status.ready ? "ready" : "idle";
      const setupLabel = status.ready
        ? `Connected: ${active?.displayName ?? status.activeProvider} — you're set.`
        : "Not connected yet — step 1 takes about a minute.";
      if (setupStatus.textContent !== setupLabel) setupStatus.textContent = setupLabel;
      const queued = formatConnectionQueue(status.connections ?? [], Date.now());
      if (queueLabel.textContent !== queued) queueLabel.textContent = queued;
        queueLabel.hidden = !queueLabel.textContent;
        let dismissed = false;
        try {
          dismissed = localStorage.getItem("adcode.chat.connectBannerDismissed") === "1";
        } catch {
          dismissed = false;
        }
        connectBanner.hidden = status.ready || dismissed;
        if (open && inspectorOpen) void refreshAgentActivity();
    } catch {
      if (modelLabel.textContent !== "Connection status unavailable") {
        modelLabel.textContent = "Connection status unavailable";
      }
    } finally {
      statusRefreshInFlight = false;
    }
  }

  const historyButton = document.createElement("button");
  historyButton.className = "ghost-button";
  historyButton.dataset["chatAction"] = "history";
  historyButton.textContent = "History";
  historyButton.title = "Past conversations in this project";
  historyButton.setAttribute("aria-expanded", String(historyOpen));
  historyButton.setAttribute("aria-controls", "chat-history-panel");
  historyButton.addEventListener("click", () => toggleHistory());

  const connectButton = document.createElement("button");
  connectButton.className = "ghost-button";
  connectButton.dataset["chatAction"] = "models";
  connectButton.textContent = "Connect";
  connectButton.title = "Choose a provider and model";
  connectButton.addEventListener("click", () => deps.openConnect());

  const inspectorButton = document.createElement("button");
  inspectorButton.className = "ghost-button";
  inspectorButton.dataset["chatAction"] = "inspector";
  inspectorButton.textContent = "Inspector";
  inspectorButton.title = "Show task, Team, and schedule details";
  inspectorButton.setAttribute("aria-expanded", String(inspectorOpen));
  inspectorButton.addEventListener("click", () => toggleInspector());

  const resetButton = document.createElement("button");
  resetButton.className = "ghost-button";
  resetButton.textContent = "+ New";
  resetButton.title = "Start a new conversation - the current one is kept in History";
  resetButton.setAttribute("aria-label", "Start a new conversation");
  resetButton.addEventListener("click", () => {
    window.adcode.ai.reset();
    resetActivity();
    chatPreview.clear();
    previewCalls.clear();
    transcript.replaceChildren();
    streamingBubble = null;
    activeSessionId = null;
    conversationTitle.textContent = "New conversation";
    renderMemory(null);
    void refreshHistory();
  });

  const shareButton = document.createElement("button");
  shareButton.className = "ghost-button";
  shareButton.dataset["chatAction"] = "share";
  shareButton.textContent = "Share";
  shareButton.title = "Copy this conversation as markdown";
  shareButton.setAttribute("aria-label", "Copy conversation as markdown");
  shareButton.addEventListener("click", () => {
    const lines: string[] = [`# ${conversationTitle.textContent}`];
    for (const [role, text] of transcriptMessages()) {
      lines.push(role === "user" ? `## You\n${text}` : `## ADCode\n${text}`);
    }
    const markdown = lines.join("\n\n");
    shareButton.disabled = true;
    const done = (ok: boolean): void => {
      shareButton.textContent = ok ? "Copied" : "Copy failed";
      window.setTimeout(() => {
        shareButton.textContent = "Share";
        shareButton.disabled = false;
      }, 1400);
    };
    void copyText(markdown).then(done, () => done(false));
  });

  function transcriptMessages(): readonly (readonly ["user" | "assistant", string])[] {
    const out: (readonly ["user" | "assistant", string])[] = [];
    for (const child of transcript.children) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.classList.contains("chat-bubble-user")) {
        out.push(["user", messageSources.get(child) ?? ""] as const);
      } else if (child.classList.contains("chat-bubble-assistant")) {
        out.push(["assistant", messageSources.get(child) ?? ""] as const);
      }
    }
    return out;
  }

  const closeButton = document.createElement("button");
  closeButton.className = "ghost-button";
  closeButton.textContent = "Close";
  closeButton.setAttribute("aria-label", "Close Assistant");
  closeButton.title = "Close Assistant";
  closeButton.addEventListener("click", () => api.close());

  const identity = document.createElement("div");
  identity.className = "chat-identity";
  identity.append(title, conversationTitle);
  const headerActions = document.createElement("div");
  const controlsButton = document.createElement("button");
  controlsButton.className = "ghost-button";
  controlsButton.dataset["chatAction"] = "controls";
  controlsButton.textContent = "Tools & skills";
  controlsButton.title = "Manage MCP servers, tool access, and workspace skills";
  controlsButton.addEventListener("click", () => {
    revealInspector();
    controls.element.hidden = false;
    controlsButton.setAttribute("aria-expanded", "true");
    controls.show();
    controls.element.scrollIntoView({ block: "nearest" });
  });
  headerActions.className = "chat-header-actions";
  headerActions.append(
    historyButton,
    connectButton,
    controlsButton,
    inspectorButton,
    resetButton,
    shareButton,
    closeButton,
  );
  const presentationButton = document.createElement("button");
  presentationButton.className = "ghost-button chat-presentation";
  presentationButton.textContent = "Expand";
  presentationButton.addEventListener("click", () => deps.togglePresentation?.());
  if (deps.togglePresentation) headerActions.insertBefore(presentationButton, closeButton);
  const moreActions = document.createElement("details");
  moreActions.className = "chat-more-actions";
  moreActions.hidden = true;
  const moreSummary = document.createElement("summary");
  moreSummary.textContent = "•••";
  moreSummary.setAttribute("aria-label", "Assistant actions");
  const moreMenu = document.createElement("div");
  moreMenu.className = "chat-more-menu";
  moreActions.append(moreSummary, moreMenu);
  headerActions.insertBefore(moreActions, closeButton);
  const secondaryActions = [historyButton, connectButton, controlsButton, inspectorButton, shareButton];
  for (const action of secondaryActions) action.addEventListener("click", () => { moreActions.open = false; });
  header.append(identity, queueLabel, headerActions);

  // Claude-style connect banner: when no model is ready, the transcript top
  // explains the assistant works with the open codebase and offers Connect.
  const connectBanner = document.createElement("div");
  connectBanner.className = "chat-connect-banner";
  connectBanner.hidden = true;
  const connectBannerText = document.createElement("span");
  connectBannerText.textContent = "ADCode works directly with your codebase";
  const connectBannerButton = document.createElement("button");
  connectBannerButton.type = "button";
  connectBannerButton.className = "chat-send";
  connectBannerButton.textContent = "Connect";
  connectBannerButton.addEventListener("click", () => deps.openConnect());
  const connectBannerDismiss = document.createElement("button");
  connectBannerDismiss.type = "button";
  connectBannerDismiss.className = "ghost-button";
  connectBannerDismiss.append(createIcon(ICON.close));
  connectBannerDismiss.setAttribute("aria-label", "Dismiss connect suggestion");
  connectBannerDismiss.addEventListener("click", () => {
    connectBanner.hidden = true;
    try {
      localStorage.setItem("adcode.chat.connectBannerDismissed", "1");
    } catch {
      // Dismissal memory is optional.
    }
  });
  connectBanner.append(connectBannerText, connectBannerButton, connectBannerDismiss);

  /* ── Transcript ───────────────────────────────────────────────────────── */

  const transcript = document.createElement("div");
  const chatPreview = createChatPreview(transcript);
  const previewCalls = new Set<string>();
  transcript.className = "chat-transcript";
  transcript.setAttribute("aria-live", "polite");
  transcript.setAttribute("role", "log");
  transcript.setAttribute("aria-label", "Conversation");

  /* ── Composer ─────────────────────────────────────────────────────────── */

  /* -- History ---------------------------------------------------------- */

  const history = document.createElement("aside");
  history.className = "chat-history";
  history.id = "chat-history-panel";
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

  const historyHeading = document.createElement("h2");
  historyHeading.className = "chat-section-heading";
  historyHeading.textContent = "Chats and tasks";
  history.append(historyHeading, historySearch, historyList, clearAll);

  let saved: readonly ChatSessionView[] = [];
  let activeSessionId: string | null = null;

  async function refreshHistory(): Promise<void> {
    saved = await window.adcode.chat.sessions();
    const current = await window.adcode.chat.current().catch(() => null);
    activeSessionId = current?.id ?? null;
    conversationTitle.textContent = current === null || current.messages.length === 0
      ? "New conversation"
      : current.title;
    renderHistory();
  }

  function toggleHistory(): void {
    if (externalHistory) { deps.revealHistory?.(); historySearch.focus(); return; }
    historyOpen = !historyOpen;
    if (historyOpen && card.dataset["layout"] === "compact") inspectorOpen = false;
    applyDisclosures();
    if (historyOpen) void refreshHistory();
  }

  function renderHistoryRow(session: ChatSessionView): HTMLElement {
    const row = document.createElement("div");
    row.className = "chat-history-row";
    if (session.id === activeSessionId) row.dataset["active"] = "true";
    row.dataset["sessionId"] = session.id;

    // Status icon: spinner while this chat works, branch for a renamed
    // (user-owned) conversation, dot for idle. Purely presentational — the
    // backend has no fork flag, so a custom title is the closest signal that
    // the user took ownership of an auto-titled thread.
    const status = document.createElement("span");
    status.className = "chat-history-status";
    status.setAttribute("aria-hidden", "true");
    const isWorking = session.id === activeSessionId && card.dataset["working"] === "true";
    const kind = isWorking ? "working" : session.renamed ? "forked" : "idle";
    status.dataset["status"] = kind;
    status.title = isWorking ? "Working" : session.renamed ? "Renamed" : "Idle";
    row.append(status);

    const openIt = document.createElement("button");
    openIt.type = "button";
    openIt.className = "chat-history-open";
    openIt.textContent = session.title;
    openIt.title = "Reopen this conversation";
    openIt.setAttribute("aria-current", session.id === activeSessionId ? "true" : "false");
    openIt.addEventListener("click", () => void resume(session.id));

    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "chat-history-action";
    rename.textContent = "Rename";
    rename.setAttribute("aria-label", `Rename ${session.title}`);
    rename.addEventListener("click", () => {
      void deps.askForName(session.title).then(async (name) => {
        if (name === null) return;
        saved = await window.adcode.chat.rename(session.id, name);
        if (session.id === activeSessionId) conversationTitle.textContent = name;
        renderHistory();
      });
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chat-history-action";
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Delete ${session.title}`);
    remove.addEventListener("click", () => {
      void window.adcode.chat.remove(session.id).then((sessions) => {
        saved = sessions;
        if (session.id === activeSessionId) {
          activeSessionId = null;
          conversationTitle.textContent = "New conversation";
        }
        renderHistory();
      });
    });

    row.append(openIt, rename, remove);
    return row;
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
        saved.length === 0
          ? "No chats yet. Start one below - it stays on this machine, per project."
          : "Nothing matches that.";
      historyList.append(empty);
      return;
    }

    if (needle.length > 0) {
      for (const session of [...shown].sort((a, b) => b.updatedAt - a.updatedAt)) {
        historyList.append(renderHistoryRow(session));
      }
      return;
    }

    for (const group of groupChatSessions(shown)) {
      const heading = document.createElement("h3");
      heading.className = "chat-history-group";
      heading.textContent = group.label;
      historyList.append(heading);
      for (const entry of group.sessions) {
        const full = shown.find((session) => session.id === entry.id);
        if (full) historyList.append(renderHistoryRow(full));
      }
    }
  }

  /** Draw a past conversation back into the transcript. */
  async function resume(id: string): Promise<void> {
    if (docked) api.open();
    const session = await window.adcode.chat.resume(id);
    if (session === null) return;

    resetActivity();
    chatPreview.clear();
    previewCalls.clear();
    transcript.replaceChildren();
    streamingBubble = null;
    activeSessionId = session.id;
    conversationTitle.textContent = session.title;

    for (const message of session.messages) {
      bubble(message.role === "user" ? "user" : "assistant", message.text, [], message.at);
    }

    renderMemory(session);
    renderHistory();
    historyOpen = false;
    applyDisclosures();
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
  input.placeholder = "Describe what to build or change… @ adds a file, / runs a command";
  input.setAttribute("aria-label", "Message the assistant");

  // Auto-growing composer, capped at ~140px per the Agent Chat reference.
  // Height is the only layout read here, on local keystrokes — never in an
  // animation loop — so it cannot regress input latency (§1).
  function autogrowComposer(): void {
    input.style.height = "auto";
    const next = Math.min(input.scrollHeight, 140);
    input.style.height = `${String(next)}px`;
    input.style.overflowY = input.scrollHeight > 140 ? "auto" : "hidden";
  }
  input.addEventListener("input", autogrowComposer);

  const sendButton = document.createElement("button");
  sendButton.className = "chat-send";
  sendButton.type = "submit";
  sendButton.textContent = "↑";
  sendButton.title = "Send (Enter)";
  sendButton.setAttribute("aria-label", "Send message");
  sendButton.dataset["mode"] = "send";

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

  // `@` opens the file picker at the caret, exactly as typing it does. A chosen file rides
  // the next turn as a chip, with the editor's unsaved text when it is open.
  const attachContext = document.createElement("button");
  attachContext.className = "chat-team-button";
  attachContext.type = "button";
  attachContext.textContent = "@ Files";
  attachContext.title = "Add a project file to the conversation (or type @)";
  attachContext.setAttribute("aria-label", "Add a project file to the conversation");
  attachContext.addEventListener("click", () => {
    const caret = input.selectionStart ?? input.value.length;
    const needsSpace = caret > 0 && !/\s/.test(input.value[caret - 1] ?? "");
    input.setRangeText(`${needsSpace ? " " : ""}@`, caret, input.selectionEnd ?? caret, "end");
    input.focus();
    refreshComposerMenu();
  });

  /* ── Attachments: picker, drag-drop and paste land on the same strip ── */

  // Files waiting to ride the next turn. Cleared on send, kept on cancel - a
  // stopped turn should not eat the screenshot it was about.
  let pending: PendingAttachment[] = [];

  const attachmentStrip = document.createElement("div");
  attachmentStrip.className = "chat-attachments";
  attachmentStrip.hidden = true;
  attachmentStrip.setAttribute("aria-label", "Attached files");

  const composerNotice = document.createElement("p");
  composerNotice.className = "chat-composer-notice";
  composerNotice.setAttribute("role", "status");
  composerNotice.hidden = true;

  function renderAttachments(): void {
    attachmentStrip.replaceChildren();
    attachmentStrip.hidden = pending.length === 0;
    for (const item of pending) {
      const chip = document.createElement("div");
      chip.className = "chat-attachment";
      chip.dataset["attachmentId"] = item.id;

      if (item.kind === "image" && item.previewUrl.length > 0) {
        const thumb = document.createElement("img");
        thumb.className = "chat-attachment-thumb";
        thumb.src = item.previewUrl;
        thumb.alt = "";
        chip.append(thumb);
      } else {
        const glyph = document.createElement("span");
        glyph.className = "chat-attachment-glyph";
        glyph.textContent = "≡";
        glyph.setAttribute("aria-hidden", "true");
        chip.append(glyph);
      }

      const meta = document.createElement("span");
      meta.className = "chat-attachment-meta";
      const name = document.createElement("span");
      name.className = "chat-attachment-name";
      name.textContent = item.name;
      name.title = item.name;
      const size = document.createElement("span");
      size.className = "chat-attachment-size";
      size.textContent = formatBytes(item.size);
      meta.append(name, size);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chat-attachment-remove";
      remove.append(createIcon(ICON.close));
      remove.title = `Remove ${item.name}`;
      remove.setAttribute("aria-label", `Remove ${item.name}`);
      remove.addEventListener("click", () => {
        pending = pending.filter((other) => other.id !== item.id);
        renderAttachments();
        input.focus();
      });

      chip.append(meta, remove);
      attachmentStrip.append(chip);
    }
  }

  function complain(message: string): void {
    composerNotice.textContent = message;
    composerNotice.hidden = false;
    window.setTimeout(() => {
      if (composerNotice.textContent === message) composerNotice.hidden = true;
    }, 5000);
  }

  function clearAttachments(): void {
    pending = [];
    renderAttachments();
  }

  /** Add text as a context chip. Same limits as a dropped file; a repeat is a no-op. */
  function addTextContext(name: string, text: string): boolean {
    const data = text.length > MAX_TEXT_CHARS
      ? `${text.slice(0, MAX_TEXT_CHARS)}\n[Truncated at ${MAX_TEXT_CHARS.toLocaleString()} characters - read the file for the rest]`
      : text;
    if (pending.some((item) => item.name === name && item.data === data)) return true;
    if (pending.length >= MAX_ATTACHMENTS) {
      complain(`Up to ${MAX_ATTACHMENTS} files per message. Remove one to add ${name}.`);
      return false;
    }
    pending = [...pending, {
      id: `context-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.length > 200 ? `…${name.slice(-199)}` : name,
      kind: "text",
      mediaType: "text/plain",
      size: new Blob([data]).size,
      previewUrl: "",
      data,
    }];
    renderAttachments();
    return true;
  }

  async function addFiles(sources: readonly AttachmentSource[]): Promise<void> {
    if (sources.length === 0) return;
    const { admitted, rejected } = admitFiles(
      sources.map((file) => ({ name: file.name, type: file.type, size: file.size })),
      pending.length,
    );
    for (const message of rejected) complain(message);
    for (const index of admitted) {
      const source = sources[index] as AttachmentSource;
      try {
        pending = [...pending, await fileToAttachment(source)];
      } catch (error) {
        complain(error instanceof Error ? error.message : `${source.name} could not be attached.`);
      }
    }
    renderAttachments();
  }

  const attachButton = document.createElement("button");
  attachButton.className = "chat-team-button";
  attachButton.type = "button";
  attachButton.textContent = "+ Attach";
  attachButton.title = "Attach images or documents (or drag them in, or paste)";
  attachButton.setAttribute("aria-label", "Attach images or documents");

  const filePicker = document.createElement("input");
  filePicker.type = "file";
  filePicker.multiple = true;
  filePicker.hidden = true;
  // Images plus text documents; anything else is refused with an explanation.
  filePicker.accept = "image/png,image/jpeg,image/webp,image/gif,.txt,.md,.markdown,.json,.jsonc,.csv,.tsv,.log,.yaml,.yml,.xml,.toml,.ini,.cfg,.conf,.sh,.js,.jsx,.ts,.tsx,.py,.java,.c,.h,.cpp,.hpp,.rs,.go,.rb,.php,.swift,.kt,.sql,.css,.scss";
  filePicker.setAttribute("aria-hidden", "true");
  filePicker.addEventListener("change", () => {
    void addFiles([...filePicker.files ?? []]);
    filePicker.value = "";
  });
  attachButton.addEventListener("click", () => filePicker.click());

  const voiceButton = document.createElement("button");
  voiceButton.className = "chat-team-button chat-voice";
  voiceButton.type = "button";
  voiceButton.append(createIcon(ICON.mic));
  voiceButton.title = "Dictate a message";
  voiceButton.setAttribute("aria-label", "Dictate a message");
  voiceButton.hidden = true;
  const speechRecognition =
    (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition ??
    (window as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition;
  if (typeof speechRecognition === "function") {
    voiceButton.hidden = false;
    voiceButton.addEventListener("click", () => {
      try {
        const recognition = new (speechRecognition as new () => {
          lang: string;
          interimResults: boolean;
          onresult: ((event: { results: { transcript: string }[][] }) => void) | null;
          onerror: (() => void) | null;
          onend: (() => void) | null;
          start: () => void;
          stop: () => void;
        })();
        recognition.lang = navigator.language || "en-US";
        recognition.interimResults = false;
        voiceButton.disabled = true;
        voiceButton.dataset["recording"] = "true";
        recognition.onresult = (event) => {
          const heard = event.results
            .map((result) => result[0]?.transcript ?? "")
            .join(" ")
            .trim();
          if (heard.length > 0) input.value = `${input.value}${input.value.endsWith(" ") || input.value.length === 0 ? "" : " "}${heard}`;
          input.focus();
        };
        recognition.onerror = () => {
          voiceButton.disabled = false;
          delete voiceButton.dataset["recording"];
        };
        recognition.onend = () => {
          voiceButton.disabled = false;
          delete voiceButton.dataset["recording"];
        };
        recognition.start();
      } catch {
        voiceButton.hidden = true;
      }
    });
  }

  // Mode pill: decorative by design — the assistant always runs as an agent
  // with tools here. It sits beside the live model pill so the composer reads
  // the way the reference does (mode + model, send at right).
  const modePill = document.createElement("span");
  modePill.className = "chat-mode-pill";
  modePill.textContent = "Agent";
  modePill.title = "Agent mode — the assistant can read and propose changes";

  const toolbar = document.createElement("div");
  toolbar.className = "chat-toolbar";
  const spacer = document.createElement("span");
  spacer.className = "chat-toolbar-spacer";
  modelLabel.classList.add("chat-model-pill");
  const composerTools = document.createElement("details");
  composerTools.className = "composer-tools";
  const toolsLabel = document.createElement("summary");
  toolsLabel.textContent = "Tools";
  const toolsMenu = document.createElement("div");
  toolsMenu.className = "composer-tools-menu";
  const livePreviewButton = document.createElement("button");
  livePreviewButton.type = "button";
  livePreviewButton.className = "chat-team-button";
  livePreviewButton.textContent = "Live preview";
  livePreviewButton.addEventListener("click", () => { void chatPreview.start(); });
  toolsMenu.append(livePreviewButton, manualTeam, scheduleMessage, voiceButton);
  composerTools.append(toolsLabel, toolsMenu);
  toolsMenu.addEventListener("click", () => { composerTools.open = false; });
  document.addEventListener("pointerdown", event => {
    if (event.target instanceof Node && !composerTools.contains(event.target)) composerTools.open = false;
  });
  composerTools.addEventListener("keydown", event => {
    if (event.key === "Escape" && composerTools.open) { event.stopPropagation(); composerTools.open = false; toolsLabel.focus(); }
  });
  toolbar.append(attachButton, attachContext, composerTools, spacer, modePill, modelLabel, sendButton);
  const composerFooter = document.createElement("div");
  composerFooter.className = "chat-composer-footer";
  const disclaimer = document.createElement("span");
  disclaimer.className = "chat-disclaimer";
  disclaimer.textContent = "Enter to send · Shift+Enter new line · @ file · / command · ↑ last prompt · Review changes before applying";
  composerFooter.append(disclaimer);
  composer.append(input, attachmentStrip, composerNotice, toolbar, composerFooter, filePicker);

  /* ── Typed menus: `/` runs a command, `@` adds a file ─────────────────── */

  const composerMenu = createComposerMenu();
  composer.append(composerMenu.element);
  input.setAttribute("aria-controls", composerMenu.element.id);
  let menuTrigger: MenuTrigger | null = null;
  let mentionGeneration = 0;

  /** Swap the typed `/query` or `@query` for `insert`, leaving the caret after it. */
  function applyTrigger(insert: string): void {
    if (menuTrigger === null) return;
    const caret = input.selectionStart ?? input.value.length;
    const next = replaceTrigger(input.value, caret, menuTrigger, insert);
    input.value = next.text;
    input.setSelectionRange(next.caret, next.caret);
    menuTrigger = null;
    composerMenu.hide();
    autogrowComposer();
    input.focus();
  }

  async function runSlashCommand(command: SlashCommand, autoSend = false): Promise<void> {
    applyTrigger("");
    switch (command.id) {
      case "new": resetButton.click(); return;
      case "history": historyButton.click(); return;
      case "model": deps.openConnect(); return;
      case "preview": void chatPreview.start(); return;
      case "team": api.openTeamSetup(); return;
      case "schedule": api.openScheduleComposer(); return;
    }
    if (command.kind === "diff") {
      const diff = await (deps.uncommittedDiff?.() ?? Promise.resolve("")).catch(() => "");
      if (diff.trim().length === 0) {
        complain("No uncommitted changes to look at: git diff HEAD is empty.");
        input.focus();
        return;
      }
      if (!addTextContext("uncommitted-changes.diff", diff)) return;
    }
    const rest = input.value.trim();
    input.value = `${command.prompt ?? ""}${rest}`;
    const end = input.value.length;
    input.setSelectionRange(end, end);
    autogrowComposer();
    input.focus();
    if (autoSend) submit();
  }

  async function chooseMention(path: string): Promise<void> {
    applyTrigger(`@${path} `);
    const text = await (deps.readMention?.(path) ?? Promise.resolve(null)).catch(() => null);
    if (text === null) {
      complain(`${path} could not be read here; the assistant can still open it with its tools.`);
      return;
    }
    addTextContext(path, text);
  }

  function refreshComposerMenu(): void {
    const caret = input.selectionStart ?? input.value.length;
    const trigger = input.selectionStart === input.selectionEnd ? menuTriggerAt(input.value, caret) : null;
    menuTrigger = trigger;
    if (trigger === null) {
      composerMenu.hide();
      return;
    }
    if (trigger.kind === "slash") {
      composerMenu.show("Commands", matchSlashCommands(trigger.query).map((command) => ({
        label: `/${command.id}`,
        detail: command.hint,
        run: () => void runSlashCommand(command),
      })));
      return;
    }
    const mentionFiles = deps.mentionFiles;
    if (mentionFiles === undefined) {
      composerMenu.hide();
      return;
    }
    const generation = ++mentionGeneration;
    void mentionFiles(trigger.query).then((files) => {
      if (generation !== mentionGeneration || menuTrigger?.kind !== "mention") return;
      composerMenu.show("Add a file to the conversation", files.slice(0, 8).map((path) => ({
        label: path.split(/[\\/]/).pop() || path,
        detail: path,
        run: () => void chooseMention(path),
      })));
    }, () => composerMenu.hide());
  }

  input.addEventListener("input", refreshComposerMenu);
  input.addEventListener("click", refreshComposerMenu);
  input.addEventListener("keyup", (event) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) refreshComposerMenu();
  });
  input.addEventListener("blur", () => window.setTimeout(() => {
    if (document.activeElement !== input) composerMenu.hide();
  }, 150));

  /* Prompt history: ↑ in an empty composer brings back what you sent before. */

  const PROMPT_HISTORY_KEY = "adcode.chat.promptHistory";
  let promptHistory: string[] = [];
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(PROMPT_HISTORY_KEY) ?? "[]");
    if (Array.isArray(stored)) promptHistory = stored.filter((entry): entry is string => typeof entry === "string").slice(-50);
  } catch {
    // Recall is a convenience; an unreadable store starts it empty.
  }
  let historyIndex: number | null = null;
  let draftBeforeRecall = "";
  input.addEventListener("input", () => { historyIndex = null; });

  function recallPrompt(direction: -1 | 1): boolean {
    if (promptHistory.length === 0) return false;
    if (historyIndex === null) {
      if (direction === 1) return false;
      draftBeforeRecall = input.value;
      historyIndex = promptHistory.length;
    }
    const next = historyIndex + direction;
    if (next < 0) return true;
    if (next >= promptHistory.length) {
      historyIndex = null;
      input.value = draftBeforeRecall;
    } else {
      historyIndex = next;
      input.value = promptHistory[next] ?? "";
    }
    autogrowComposer();
    const end = input.value.length;
    input.setSelectionRange(end, end);
    return true;
  }

  function rememberSent(text: string): void {
    promptHistory = rememberPrompt(promptHistory, text);
    historyIndex = null;
    try {
      localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(promptHistory));
    } catch {
      // Optional storage.
    }
  }

  function currentEditorContext(): AiEditorContextView | null {
    try {
      return deps.editorContext?.() ?? null;
    } catch {
      return null;
    }
  }

  const conversation = document.createElement("main");
  conversation.className = "chat-conversation";
  const welcome = document.createElement("section");
  welcome.className = "chat-welcome";
  const welcomeTitle = document.createElement("h2");
  const welcomeMark = createIcon("M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6z");
  welcomeMark.classList.add("chat-welcome-mark");
  const welcomeGreeting = document.createElement("span");
  const hour = new Date().getHours();
  welcomeGreeting.textContent = hour < 5
    ? "Working late"
    : hour < 12
      ? "Good morning"
      : hour < 18
        ? "Good afternoon"
        : "Good evening";
  welcomeTitle.append(welcomeMark, welcomeGreeting);
  const welcomeText = document.createElement("p");
  welcomeText.textContent = "What can I help you build or change in this project?";

  /*
   * Guided setup, not a feature list: every step is a button that does the
   * thing. The status line mirrors the live connection pill, and the whole
   * block lives inside the welcome section so it leaves with it once the
   * first exchange lands.
   */
  const setupSteps = document.createElement("ol");
  setupSteps.className = "chat-setup-steps";

  const setupConnectItem = document.createElement("li");
  setupConnectItem.className = "chat-setup-step";
  const setupConnect = document.createElement("button");
  setupConnect.type = "button";
  setupConnect.className = "chat-send chat-setup-action";
  setupConnect.textContent = "1 · Connect a model";
  setupConnect.addEventListener("click", () => deps.openConnect());
  const setupStatus = document.createElement("span");
  setupStatus.className = "chat-setup-status";
  setupStatus.setAttribute("role", "status");
  setupStatus.textContent = "Checking connection…";
  setupConnectItem.append(setupConnect, setupStatus);

  const setupAskItem = document.createElement("li");
  setupAskItem.className = "chat-setup-step";
  const setupAsk = document.createElement("button");
  setupAsk.type = "button";
  setupAsk.className = "ghost-button chat-setup-action";
  setupAsk.textContent = "2 · Ask your first question";
  setupAsk.addEventListener("click", () => {
    input.value = "What can you do with my project? ";
    input.focus();
    autogrowComposer();
  });
  const setupHint = document.createElement("span");
  setupHint.className = "chat-setup-status";
  setupHint.textContent = "Write below, Enter sends";
  setupAskItem.append(setupAsk, setupHint);

  setupSteps.append(setupConnectItem, setupAskItem);
  const quickActions = document.createElement("div");
  quickActions.className = "chat-quick-actions";
  // A starter that ends in ": " waits for the user's words; a complete one sends at once,
  // and a slash starter runs its command (attaching the diff for a review, say).
  const starters: ReadonlyArray<{ label: string; hint: string; prompt?: string; slash?: string }> = [
    { label: "Build something", hint: "Describe it in plain words", prompt: "Build this in my project, end to end, and run the tests: " },
    { label: "Fix an error", hint: "Paste it or name the file", prompt: "Find the root cause of this error and fix it, then verify the fix: " },
    { label: "Explain this project", hint: "A five-minute tour", prompt: "Give me a five-minute tour of this project: what it does, how it is organised, the main entry points, and where the important code lives." },
    { label: "Review my changes", hint: "Catch bugs before you commit", slash: "review" },
    { label: "Write tests", hint: "With your test setup", prompt: "Find the most important untested code in this project, write focused tests for it with the existing test setup, and run them: " },
    { label: "Find bugs", hint: "A careful read for problems", prompt: "Read the core of this project carefully and list the most likely real bugs, with file and line, most severe first. Do not change files yet." },
  ];
  for (const starter of starters) {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "chat-quick-action";
    action.textContent = starter.label;
    const hint = document.createElement("small");
    hint.textContent = starter.hint;
    action.append(hint);
    action.addEventListener("click", () => {
      const slash = starter.slash === undefined ? undefined : matchSlashCommands(starter.slash)[0];
      if (slash !== undefined) {
        menuTrigger = null;
        void runSlashCommand(slash, true);
        return;
      }
      input.value = starter.prompt ?? "";
      autogrowComposer();
      input.focus();
      if (!input.value.endsWith(": ")) submit();
    });
    quickActions.append(action);
  }
  welcome.append(welcomeTitle, welcomeText, setupSteps);
  const refreshWelcome = (): void => {
    const empty = transcript.childElementCount === 0;
    welcome.hidden = !empty;
    quickActions.hidden = !empty;
    conversation.dataset["empty"] = String(empty);
  };
  new MutationObserver(refreshWelcome).observe(transcript, { childList: true });
  conversation.append(memory, connectBanner, welcome, transcript, composer, quickActions);
  refreshWelcome();
  const working = document.createElement("div");
  working.className = "chat-working";
  working.hidden = true;
  working.setAttribute("role", "status");
  const workingText = document.createElement("span");
  workingText.className = "chat-working-text";
  workingText.textContent = "Thinking";
  working.append(workingText);

  const agentLibrary = createAgentLibrary({
    prompt: () => input.value.trim(),
    openConnect: deps.openConnect,
    configure: async (configuration) => {
      if (!canOfferAnotherTeam()) throw new Error("Finish or cancel the current Team before setting up another.");
      const team = await window.adcode.aiTeam.configure(configuration);
      paintTeam(team);
      bubble("user", `Team plan: ${configuration.prompt}`);
      input.value = "";
    },
  });

  const inspector = document.createElement("aside");
  inspector.className = "chat-inspector";
  inspector.id = "chat-inspector-panel";
  inspector.setAttribute("aria-label", "AI task inspector");
  const inspectorHeading = document.createElement("h2");
  inspectorHeading.className = "chat-section-heading";
  inspectorHeading.textContent = "Agents & activity";
  const controls = createAssistantControls();
  controls.element.hidden = true;
  const backToChat = document.createElement("button");
  backToChat.className = "ghost-button chat-inspector-dismiss";
  backToChat.textContent = "Back to chat";
  backToChat.addEventListener("click", () => { inspectorOpen = false; applyDisclosures(); });
  inspector.append(inspectorHeading, backToChat, controls.element, teamPanel, taskStrip, agentLibrary.element, automationPanel);

  const body = document.createElement("div");
  body.className = "chat-body";
  body.append(history, conversation, inspector);
  card.append(header, body);

  // The panels float over the conversation instead of squeezing it, so an
  // open panel dims what is behind it. One click on the dimming returns to
  // the conversation - the same dismissal a popup offers.
  const scrim = document.createElement("div");
  scrim.className = "chat-scrim";
  scrim.hidden = true;
  scrim.setAttribute("aria-hidden", "true");
  scrim.addEventListener("click", () => {
    historyOpen = false;
    inspectorOpen = false;
    applyDisclosures();
    input.focus();
  });
  body.prepend(scrim);
  const updateLayout = attachChatLayout(card, body, () => {
    historyOpen = false;
    card.dataset["historyOpen"] = "false";
    history.hidden = true;
    historyButton.setAttribute("aria-expanded", "false");
  });

  function applyDisclosures(): void {
    card.dataset["historyOpen"] = String(!externalHistory && historyOpen);
    card.dataset["inspectorOpen"] = String(inspectorOpen);
    history.hidden = !externalHistory && !historyOpen;
    inspector.hidden = !inspectorOpen;
    scrim.hidden = !((historyOpen && !externalHistory) || inspectorOpen);
    historyButton.setAttribute("aria-expanded", String(historyOpen));
    inspectorButton.setAttribute("aria-expanded", String(inspectorOpen));
    controlsButton.setAttribute("aria-expanded", String(inspectorOpen && !controls.element.hidden));
    updateLayout();
  }

  function toggleInspector(): void {
    inspectorOpen = !inspectorOpen;
    if (inspectorOpen && card.dataset["layout"] === "compact") historyOpen = false;
    applyDisclosures();
  }

  function revealInspector(): void {
    inspectorOpen = true;
    if (card.dataset["layout"] === "compact") historyOpen = false;
    applyDisclosures();
  }

  applyDisclosures();

  window.adcode.chat.onChanged((session) => renderMemory(session));
  void window.adcode.chat.current().then((session) => renderMemory(session));

  /* ── Rendering ────────────────────────────────────────────────────────── */

  function scrollToEnd(): void {
    if (!working.hidden && transcript.lastElementChild !== working) transcript.append(working);
    transcript.scrollTop = transcript.scrollHeight;
  }

  let lastUserPrompt = "";

  /* ── Agent activity: one collapsible block per assistant turn ──────────
   *
   * The backend already streams everything this needs — `thinking`, `tool-call`,
   * `tool-result`, `text` — so the block is a pure presentation mapping. No new
   * message model, no new IPC: thinking events become muted thought rows, tool
   * calls become tool rows (spinner → green check), and the active tool's label
   * becomes the header label. `trace()` below stays for persisted Team /
   * workspace traces and for errors; live turns use this block instead.
   */
  let activeActivity: ActivityBlockHandle | null = null;
  const activityToolRows = new Map<string, true>();

  /** Create the turn's block in its default "Thinking" state, above the answer. */
  function ensureActivity(): ActivityBlockHandle {
    if (activeActivity !== null) return activeActivity;
    // The activity block is the turn's status line — the legacy dot-pulse
    // working row would read as a second, competing "Thinking" underneath it.
    working.hidden = true;
    working.remove();
    const block = createActivityBlock({ label: "Thinking" });
    // Above the final answer: before the live bubble when one exists,
    // otherwise at the end (ahead of the working indicator, which
    // scrollToEnd keeps last).
    if (streamingBubble !== null && transcript.contains(streamingBubble)) {
      transcript.insertBefore(block.element, streamingBubble);
    } else {
      transcript.append(block.element);
    }
    activeActivity = block;
    scrollToEnd();
    return block;
  }

  function finishActivity(label?: string): void {
    if (activeActivity === null) return;
    const elapsed = (Date.now() - activeActivity.startedAt) / 1000;
    activeActivity.finalize(elapsed, label);
    activeActivity = null;
    activityToolRows.clear();
    scrollToEnd();
  }

  /** Drop a live block without finalizing (reset / resume replace the transcript). */
  function resetActivity(): void {
    streamPaint.cancel();
    dirtyMessages.clear();
    if (activeActivity !== null) {
      activeActivity.destroy();
      activeActivity = null;
    }
    activityToolRows.clear();
  }

  /** A collapsed errored turn never claims it worked. */
  function finishActivityFailed(): void {
    if (activeActivity === null) return;
    finishActivity(formatFailedLabel((Date.now() - activeActivity.startedAt) / 1000));
  }

  /*
   * A send that never reached a model ends with a way forward, not a silent
   * collapse: one assistant bubble explaining the miss, with a button that
   * opens Connect. Deduped so retries cannot stack the same card.
   */
  function connectNudge(): void {    const last = transcript.lastElementChild;
    if (last instanceof HTMLElement && last.dataset["nudge"] === "connect") {
      scrollToEnd();
      return;
    }
    const element = bubble(
      "assistant",
      "No answer came back — the assistant has no working model connection right now. Connecting takes about a minute.",
    );
    element.dataset["nudge"] = "connect";
    const action = document.createElement("button");
    action.type = "button";
    action.className = "chat-send chat-nudge-action";
    action.textContent = "Connect a model";
    action.addEventListener("click", () => deps.openConnect());
    element.append(action);
    scrollToEnd();
  }

  /*
   * A task paused by its token cap ends with three ways forward, not a bare
   * error line: remove the cap, raise it, or start fresh. Same deduped card
   * shape as connectNudge, so retries cannot stack it.
   */
  function budgetNudge(): void {
    const last = transcript.lastElementChild;
    if (last instanceof HTMLElement && last.dataset["nudge"] === "budget") {
      scrollToEnd();
      return;
    }
    const element = bubble(
      "assistant",
      "This task paused at its token cap. Your key is fine and nothing is lost - pick how to continue.",
    );
    element.dataset["nudge"] = "budget";
    const row = document.createElement("div");
    row.className = "chat-nudge-row";
    const choice = (
      label: string,
      title: string,
      run: () => void,
    ): HTMLButtonElement => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "chat-send chat-nudge-action";
      option.textContent = label;
      option.title = title;
      option.addEventListener("click", run);
      row.append(option);
      return option;
    };
    choice("Remove limit", "Never pause tasks for tokens again", () => {
      void window.adcode.settings.write("adcode.ai.taskTokenBudget", "unlimited").then(
        () => void window.adcode.ai.send("Continue where you left off."),
        () => undefined,
      );
    });
    choice("Raise to 250k", "Keep a cap, but a larger one", () => {
      void window.adcode.settings.write("adcode.ai.taskTokenBudget", "250000").then(
        () => void window.adcode.ai.send("Continue where you left off."),
        () => undefined,
      );
    });
    choice("New task", "Start over with a fresh task workspace", () => {
      resetButton.click();
    });
    element.append(row);
    scrollToEnd();
  }

  /*
   * A turn blocked by unsaved files ends with the actual choice: save them,
   * or hear the answer anyway without file tools. Names the files so nobody
   * hunts through tabs, and dedupes like every other nudge.
   */
  function draftNudge(): void {
    const last = transcript.lastElementChild;
    if (last instanceof HTMLElement && last.dataset["nudge"] === "drafts") {
      scrollToEnd();
      return;
    }
    const element = bubble(
      "assistant",
      "Unsaved files are holding this turn back - the isolated task must start from what you see on disk.",
    );
    element.dataset["nudge"] = "drafts";
    const row = document.createElement("div");
    row.className = "chat-nudge-row";
    const choice = (
      label: string,
      title: string,
      run: () => void,
    ): void => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "chat-send chat-nudge-action";
      option.textContent = label;
      option.title = title;
      option.addEventListener("click", run);
      row.append(option);
    };
    choice("Save all files", "Save every open editor, then continue", () => {
      deps.saveAllOpenFiles();
      if (resend(lastUserPrompt)) {
        element.dataset["nudge"] = "drafts-sent";
      }
    });
    choice("Answer anyway", "Answer from the conversation only, without file tools", () => {
      window.adcode.ai.answerAnyway();
      if (resend(lastUserPrompt)) {
        element.dataset["nudge"] = "drafts-sent";
      }
    });
    element.append(row);
    scrollToEnd();
  }

  /** Current-chat spinner in History without a full re-render (keeps scroll). */
  function paintWorkingStatus(): void {
    const working = card.dataset["working"] === "true";
    for (const row of historyList.querySelectorAll<HTMLElement>(".chat-history-row[data-session-id]")) {
      const icon = row.querySelector<HTMLElement>(".chat-history-status");
      if (!icon) continue;
      const isActive = row.dataset["sessionId"] === activeSessionId;
      if (isActive && working) {
        icon.dataset["status"] = "working";
        icon.title = "Working";
      } else if (isActive && row.dataset["active"] === "true") {
        icon.dataset["status"] = "idle";
        icon.title = "Current conversation";
      }
    }
  }

  /** Short clock time for a message ("14:32"), full date on hover. */
  function formatMessageTime(at: number): { text: string; title: string } {
    const date = new Date(at);
    return {
      text: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      title: date.toLocaleString([], {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        day: "numeric",
        month: "short",
      }),
    };
  }

  function messageTime(at: number): HTMLElement {
    const formatted = formatMessageTime(at);
    const time = document.createElement("span");
    time.className = "chat-message-time";
    time.textContent = formatted.text;
    time.title = `Sent ${formatted.title}`;
    return time;
  }

  /** One open overflow menu at a time; anything else (outside press, Escape, send) closes it. */
  let openMenu: { menu: HTMLElement; button: HTMLButtonElement } | null = null;

  function closeOpenMenu(refocus = false): void {
    if (openMenu === null) return;
    const { menu, button } = openMenu;
    openMenu = null;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (refocus) button.focus();
  }

  document.addEventListener("pointerdown", (event) => {
    if (openMenu !== null && !openMenu.menu.contains(event.target as Node) &&
      !openMenu.button.contains(event.target as Node)) {
      closeOpenMenu();
    }
  });

  function bubble(
    role: "user" | "assistant",
    text: string,
    attachments: readonly AiAttachmentView[] = [],
    at: number = Date.now(),
  ): HTMLElement {
    const element = document.createElement("div");
    element.className = `chat-bubble chat-bubble-${role}`;
    element.dataset["at"] = String(at);
    if (role === "user" && text.trim().length > 0) lastUserPrompt = text;
    if (role === "assistant" && text.length === 0) element.classList.add("is-streaming");
    if (attachments.length > 0) {
      const row = document.createElement("div");
      row.className = "chat-bubble-attachments";
      for (const attachment of attachments) {
        const chip = document.createElement("span");
        chip.className = "chat-bubble-attachment";
        if (attachment.kind === "image") {
          const thumb = document.createElement("img");
          thumb.className = "chat-bubble-thumb";
          thumb.alt = attachment.name;
          thumb.title = attachment.name;
          // Data URLs only: the bubble never points at the user's disk.
          if (attachment.data.length > 0) {
            thumb.src = `data:${attachment.mediaType};base64,${attachment.data}`;
          }
          chip.append(thumb);
        } else {
          chip.textContent = `≡ ${attachment.name}`;
          chip.title = attachment.name;
        }
        row.append(chip);
      }
      element.append(row);
    }
    renderMessage(element, text);
    transcript.append(element);
    if (role === "assistant" && text.length > 0) transcript.append(messageActions(element));
    if (role === "user" && text.trim().length > 0) transcript.append(userMessageActions(element, text));
    scrollToEnd();
    return element;
  }

  /** Copy the stored source so code blocks copy exactly, with timed feedback. */
  function wireCopyButton(copy: HTMLButtonElement, bubbleElement: HTMLElement, label: string): void {
    copy.addEventListener("click", () => {
      const source = messageSources.get(bubbleElement) ?? "";
      copy.disabled = true;
      const done = (ok: boolean): void => {
        copy.textContent = ok ? "Copied" : "Failed";
        window.setTimeout(() => {
          copy.textContent = label;
          copy.disabled = false;
        }, 1400);
      };
      void copyText(source).then(done, () => done(false));
    });
  }

  /** Re-send a prompt, unless a turn is already running. */
  function resend(prompt: string): boolean {
    if (sendButton.dataset["mode"] === "stop") return false;
    if (prompt.trim().length === 0) return false;
    void window.adcode.ai.send(prompt, undefined, currentEditorContext()).catch(() => undefined);
    setSendMode("stop");
    streamingBubble = null;
    return true;
  }

  /*
   * A turn that ran out of steps or output tokens is not a failure of the work - the
   * conversation holds everything done so far. One button picks it back up.
   */
  function continueNudge(): void {
    const last = transcript.lastElementChild;
    if (last instanceof HTMLElement && last.dataset["nudge"] === "continue") {
      scrollToEnd();
      return;
    }
    const element = bubble(
      "assistant",
      "I stopped at a limit before finishing. Everything so far is kept - continue and I'll pick up the remaining steps.",
    );
    element.dataset["nudge"] = "continue";
    const action = document.createElement("button");
    action.type = "button";
    action.className = "chat-send chat-nudge-action";
    action.textContent = "Continue";
    action.title = "Pick up where the assistant stopped";
    action.addEventListener("click", () => {
      if (resend("Continue from where you stopped and finish the remaining steps.")) {
        element.dataset["nudge"] = "continue-sent";
        action.disabled = true;
      }
    });
    element.append(action);
    scrollToEnd();
  }

  /*
   * Per-message action bar: a slim row under the message with its sent time
   * and hover-revealed actions (CSS). Primary acts stay inline — Copy, Retry —
   * while votes live in the overflow popup so the transcript reads clean.
   */
  function messageActions(bubbleElement: HTMLElement): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "chat-message-actions";
    bar.setAttribute("aria-label", "Response actions");
    bar.append(messageTime(Number(bubbleElement.dataset["at"] ?? Date.now())));

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "chat-message-action";
    copy.textContent = "Copy";
    copy.title = "Copy response";
    copy.setAttribute("aria-label", "Copy response");
    wireCopyButton(copy, bubbleElement, "Copy");

    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "chat-message-action";
    retry.textContent = "Retry";
    retry.title = "Send the last message again";
    retry.setAttribute("aria-label", "Retry last message");
    retry.addEventListener("click", () => {
      if (!resend(lastUserPrompt)) return;
      retry.disabled = true;
      window.setTimeout(() => {
        retry.disabled = false;
      }, 2000);
    });

    const wrap = document.createElement("span");
    wrap.className = "chat-message-more-wrap";
    const more = document.createElement("button");
    more.type = "button";
    more.className = "chat-message-action chat-message-more";
    more.append(createIcon(ICON.more));
    more.title = "More actions";
    more.setAttribute("aria-label", "More response actions");
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");

    const menu = document.createElement("div");
    menu.className = "chat-message-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;

    // Votes are local-only signals, toggled in place.
    const vote = (chosen: HTMLButtonElement, other: HTMLButtonElement): void => {
      const pressed = chosen.getAttribute("aria-pressed") === "true";
      chosen.setAttribute("aria-pressed", String(!pressed));
      other.setAttribute("aria-pressed", "false");
    };
    const menuItem = (label: string, pressed: boolean): HTMLButtonElement => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "chat-message-menu-item";
      item.textContent = label;
      item.setAttribute("role", "menuitem");
      item.setAttribute("aria-pressed", String(pressed));
      return item;
    };
    const good = menuItem("Mark helpful", false);
    good.title = "Helpful (stored on this machine only)";
    good.setAttribute("aria-label", "Mark helpful");
    const bad = menuItem("Mark not helpful", false);
    bad.title = "Not helpful (stored on this machine only)";
    bad.setAttribute("aria-label", "Mark not helpful");
    good.addEventListener("click", () => {
      vote(good, bad);
      closeOpenMenu();
    });
    bad.addEventListener("click", () => {
      vote(bad, good);
      closeOpenMenu();
    });
    menu.append(good, bad);
    wrap.append(more, menu);

    more.addEventListener("click", () => {
      if (openMenu?.menu === menu) {
        closeOpenMenu();
        return;
      }
      closeOpenMenu();
      openMenu = { menu, button: more };
      menu.hidden = false;
      more.setAttribute("aria-expanded", "true");
    });
    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeOpenMenu(true);
      }
    });

    bar.append(copy, retry, wrap);
    return bar;
  }

  /*
   * Your own messages get Edit (back into the composer), Copy, and Retry for
   * that exact prompt — plus the time it was sent.
   */
  function userMessageActions(bubbleElement: HTMLElement, text: string): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "chat-message-actions is-user";
    bar.setAttribute("aria-label", "Message actions");
    bar.append(messageTime(Number(bubbleElement.dataset["at"] ?? Date.now())));

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "chat-message-action";
    edit.textContent = "Edit";
    edit.title = "Edit this message in the composer";
    edit.setAttribute("aria-label", "Edit message");
    edit.addEventListener("click", () => {
      input.value = messageSources.get(bubbleElement) ?? text;
      input.focus();
      autogrowComposer();
    });

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "chat-message-action";
    copy.textContent = "Copy";
    copy.title = "Copy message";
    copy.setAttribute("aria-label", "Copy message");
    wireCopyButton(copy, bubbleElement, "Copy");

    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "chat-message-action";
    retry.textContent = "Retry";
    retry.title = "Send this message again";
    retry.setAttribute("aria-label", "Resend message");
    retry.addEventListener("click", () => {
      resend(messageSources.get(bubbleElement) ?? text);
    });

    bar.append(edit, copy, retry);
    return bar;
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

  function renderTeamRole(label: string, state: string): HTMLElement {
    const role = document.createElement("article");
    role.className = "ai-team-role";
    role.dataset["state"] = state;
    const name = document.createElement("strong");
    name.textContent = label;
    const status = document.createElement("span");
    status.className = "ai-team-role-state";
    status.textContent = state;
    role.append(name, status);
    teamRoles.append(role);
    return role;
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
    teamStart.textContent = team.state === "paused" ? "Resume Team" : "Start Team";
    teamUsage.textContent = formatAiTeamUsage(team);
    teamRoles.replaceChildren();
    for (const role of team.roles) {
      const nodes = team.nodes.filter((node) => node.roleId === role.id);
      const state =
        nodes.find((node) => node.state === "running")?.state ??
        nodes.find((node) => node.state === "failed" || node.state === "blocked")?.state ??
        (nodes.every((node) => node.state === "completed") ? "completed" : nodes[0]?.state ?? "pending");
      const row = renderTeamRole(role.label, state);
      row.dataset["roleId"] = role.id;
      const objective = document.createElement("p");
      objective.textContent = role.objective;
      const tasks = document.createElement("p");
      tasks.textContent = nodes.map(node => `${node.title}: ${node.state}${node.failure ? ` · ${node.failure}` : ""}`).join(" · ");
      const route = nodes.map(node => team.routes[node.id]).find(value => value !== undefined);
      const routeLabel = document.createElement("p");
      routeLabel.textContent = route ? `${route.providerId} · ${route.modelId}` : role.route ? `${role.route.provider} · ${role.route.model}` : "Current connected model";
      const activity = document.createElement("button");
      activity.type = "button";
      activity.className = "ghost-button";
      activity.textContent = "Agent trace";
      activity.setAttribute("aria-label", `View ${role.label} trace`);
      activity.disabled = team.confirmedAt === null;
      activity.addEventListener("click", () => void renderTeamTrace(team, role.id));
      const latest = document.createElement("p");
      latest.className = "ai-team-latest";
      latest.textContent = team.handoffs.find(handoff => nodes.some(node => node.id === handoff.nodeId))?.summary ?? "";
      row.append(objective, tasks, routeLabel, latest, activity);
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
    if (open && inspectorOpen) void refreshAgentActivity();
  }

  let activityRefreshing = false;
  async function refreshAgentActivity(): Promise<void> {
    const team = activeTeam;
    if (team === null || team.confirmedAt === null || activityRefreshing) return;
    activityRefreshing = true;
    try {
      const events = await window.adcode.aiTeam.traces(team.id);
      if (activeTeam?.id !== team.id || !open) return;
      for (const row of teamRoles.querySelectorAll<HTMLElement>("[data-role-id]")) {
        const nodeIds = team.nodes.filter(node => node.roleId === row.dataset["roleId"]).map(node => node.id);
        if (team.handoffs.some(handoff => nodeIds.includes(handoff.nodeId))) continue;
        const latest = [...events].reverse().find(event => event.roleId === row.dataset["roleId"] || (event.nodeId !== null && nodeIds.includes(event.nodeId)));
        const target = row.querySelector<HTMLElement>(".ai-team-latest");
        if (latest && target) {
          target.textContent = [latest.summary, latest.detail].filter(Boolean).join(" — ");
          target.title = target.textContent;
        }
      }
    } catch { /* A trace read must not interrupt the agent or its controls. */ }
    finally { activityRefreshing = false; }
  }

  async function refreshTeam(): Promise<void> {
    const generation = ++teamRefreshGeneration;
    const teams = await window.adcode.aiTeam.list().catch(() => []);
    if (generation === teamRefreshGeneration) paintTeam(teams[0] ?? null);
  }

  async function renderTeamTrace(team: AiTeamView, roleId?: string): Promise<void> {
    teamTrace.disabled = true;
    try {
      const allEvents = await window.adcode.aiTeam.traces(team.id);
      const events = roleId === undefined ? allEvents : allEvents.filter(event => event.roleId === roleId || team.nodes.some(node => node.roleId === roleId && node.id === event.nodeId));
      if (events.length === 0) {
        teamNotice.textContent = "No Team trace events yet.";
        return;
      }
      for (const event of events) {
        const node = team.nodes.find(item => item.id === event.nodeId);
        const lane = team.roles.find(item => item.id === (event.roleId ?? node?.roleId))?.label ?? "Team";
        trace(`${lane} · ${event.summary}`, event.detail, traceTone(event.outcome));
      }
    } catch (error) {
      teamNotice.textContent = error instanceof Error ? error.message : "Could not load Team trace.";
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
    if (team.state === "paused") {
      teamNotice.textContent = "Revalidating the Team budget and isolated role workspaces...";
    } else {
      teamNotice.textContent = "Capturing the immutable project base...";
    }
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
    revealInspector();
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
    const openFile = document.createElement("button");
    openFile.type = "button";
    openFile.className = "ghost-button";
    openFile.textContent = "Open project file";
    openFile.title = "Open the current project copy in Code. Proposed changes are shown below.";
    openFile.addEventListener("click", () => deps.openExternalPath(change.path));
    panel.append(openFile);

    const accepted = new Set(change.hunks.map((hunk) => hunk.id));
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "chat-send";
    apply.textContent = "Apply selected";
    apply.hidden = !aiWorkspaceActions(task).review;

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
      const summary = document.createElement("section");
      summary.className = "task-review-summary";
      summary.dataset["taskReview"] = task.id;
      const title = document.createElement("h3");
      title.textContent = task.prompt;
      const state = document.createElement("p");
      const hunks = changes.flatMap(change => change.hunks);
      state.textContent = `${summarizeAiWorkspaceTask(task)} · +${hunks.reduce((n, h) => n + h.replacement.length, 0)} −${hunks.reduce((n, h) => n + h.original.length, 0)}`;
      const actions = document.createElement("div");
      actions.className = "task-review-actions";
      const action = (label: string, run: () => void): HTMLButtonElement => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ghost-button";
        button.textContent = label;
        button.addEventListener("click", run);
        actions.append(button);
        return button;
      };
      action("Work history", () => { void renderPersistedTrace(task).catch(() => { state.textContent = "Could not load work history. Try again."; }); });
      action("Task actions", () => { paintWorkspaceTask(task); revealInspector(); });
      if (deps.openPreview) action("Open preview", deps.openPreview);
      if (aiWorkspaceActions(task).review && changes.length) {
        const applyAll = action("Apply all changes", () => {
          applyAll.disabled = true;
          void window.adcode.aiWorkspace.apply(task.id, changes.map(change => ({ path: change.path, acceptedHunkIds: change.hunks.map(h => h.id) }))).then(result => {
            paintWorkspaceTask(result.task);
            state.textContent = result.message;
            if (result.ok) {
              for (const button of transcript.querySelectorAll<HTMLButtonElement>(`[data-task-review="${task.id}"] .diff-actions button`)) button.disabled = true;
            } else applyAll.disabled = false;
          }).catch(() => { state.textContent = "Could not apply changes. Your project may have changed; review and retry."; applyAll.disabled = false; });
        });
      }
      summary.append(title, state, actions);
      transcript.append(summary);
      if (changes.length === 0) {
        state.textContent = `${summarizeAiWorkspaceTask(task)} · No pending file changes. Open work history for recorded commands and results.`;
        scrollToEnd();
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

  /*
   * A proposal that arrives silently is a file the user never finds: the
   * change lives in the isolated task workspace, not the project, so nothing
   * appears in the Explorer until it is applied. This notice says exactly
   * that, right under the diff, and updates in place when the same file is
   * proposed again instead of stacking.
   */
  const proposalNotices = new Map<string, HTMLElement>();

  function proposalNotice(edit: ProposedEditView): void {
    const key = `${edit.taskId} ${edit.relativePath}`;
    const text =
      `Proposed ${edit.hunks.length} change${edit.hunks.length === 1 ? "" : "s"} to ` +
      `${edit.displayPath} — waiting in the isolated task workspace, not in your project yet. ` +
      `Review the diff above and choose Apply selected; the file lands in your Explorer once applied.`;
    const existing = proposalNotices.get(key);
    if (existing !== undefined && existing.isConnected) {
      messageSources.set(existing, text);
      renderMessage(existing, text);
      scrollToEnd();
      return;
    }
    const element = bubble("assistant", text);
    element.classList.add("chat-bubble-proposal");
    proposalNotices.set(key, element);
  }

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

  function setSendMode(mode: "send" | "stop"): void {
    working.hidden = mode !== "stop";
    if (mode === "stop") {
      transcript.append(working);
      scrollToEnd();
    } else {
      working.remove();
    }
    card.dataset["working"] = String(mode === "stop");
    if (mode === "stop") workingText.textContent = "Thinking";
    sendButton.dataset["mode"] = mode;
    // Cursor-style stop: while a turn runs the button stops it, so it stays
    // enabled and wears a spinner ring (CSS) rather than going dead. New sends
    // are what get disabled — Enter while running stops, never queues.
    sendButton.disabled = false;
    sendButton.setAttribute("aria-busy", String(mode === "stop"));
    input.setAttribute("aria-busy", String(mode === "stop"));
    if (mode === "stop") {
      sendButton.textContent = "■";
      sendButton.title = "Stop this turn";
      sendButton.setAttribute("aria-label", "Stop this turn");
    } else {
      sendButton.textContent = "↑";
      sendButton.title = "Send (Enter)";
      sendButton.setAttribute("aria-label", "Send message");
    }
    paintWorkingStatus();
  }

  window.adcode.ai.onEvent((raw) => {
    const event = raw as { kind: string; [key: string]: unknown };
    // Flush before tool boundaries, cancellation, and completion so no final text
    // is stranded in a scheduled frame or attached to the next message.
    if (event.kind !== "text") flushStream();

    switch (event.kind) {
      case "text": {
        workingText.textContent = "Writing response";
        const block = ensureActivity();
        if (activityToolRows.size === 0) block.setLabel("Writing response");
        // Append to the live bubble rather than creating one per delta. The
        // bubble streams with a blinking orange caret (CSS) until turn-end.
        streamingBubble ??= bubble("assistant", "");
        // The activity block must stay above the final answer.
        if (block.element.nextElementSibling !== streamingBubble && transcript.contains(block.element)) {
          transcript.insertBefore(block.element, streamingBubble);
        }
        messageSources.set(streamingBubble, `${messageSources.get(streamingBubble) ?? ""}${String(event["text"])}`);
        dirtyMessages.add(streamingBubble);
        if (open && !document.hidden) streamPaint.schedule();
        break;
      }

      case "thinking": {
        workingText.textContent = "Planning next steps";
        const block = ensureActivity();
        block.setLabel("Planning next steps");
        break;
      }

      case "tool-call": {
        const call = event["call"] as { id?: string; name: string; input: unknown };
        if (call.name === "open_preview" && call.id) previewCalls.add(call.id);
        const label = toolHeaderLabel(call.name);
        workingText.textContent = label;
        const block = ensureActivity();
        block.setLabel(label);
        const detail = summarizeToolInput(call.input);
        const rowId = typeof call.id === "string" && call.id.length > 0 ? call.id : `${call.name}-${String(Date.now())}`;
        block.addRow({ kind: "tool", text: detail.length > 0 ? `${call.name} · ${detail}` : call.name, status: "running", id: rowId, detail });
        activityToolRows.set(rowId, true);
        streamingBubble = null;
        scrollToEnd();
        break;
      }

      case "tool-result": {
        workingText.textContent = "Reviewing results";
        const isError = event["isError"] === true;
        const block = ensureActivity();
        const toolCallId = typeof event["toolCallId"] === "string" ? event["toolCallId"] : null;
        if (toolCallId !== null && previewCalls.delete(toolCallId)) {
          try {
            const result = JSON.parse(String(event["content"])) as { type?: string; status?: PreviewStatus };
            if (result.type === "live-preview" && result.status) chatPreview.show(result.status);
          } catch { /* A failed tool's text stays in the activity trace. */ }
        }
        if (toolCallId !== null && activityToolRows.has(toolCallId)) {
          block.completeRow(toolCallId, !isError);
        } else {
          const latest = [...activityToolRows.keys()].pop();
          if (latest !== undefined) block.completeRow(latest, !isError);
        }
        block.setLabel("Reviewing results");
        scrollToEnd();
        break;
      }

      case "refusal":
        streamingBubble?.classList.remove("is-streaming");
        streamingBubble = null;
        finishActivity("Declined");
        setSendMode("send");
        bubble("assistant", `The model declined this request. ${String(event["detail"] ?? "")}`.trim());
        break;

      case "error": {
        streamingBubble?.classList.remove("is-streaming");
        streamingBubble = null;
        finishActivityFailed();
        setSendMode("send");
        const detail = String(event["detail"] ?? "unknown");
        trace("Error", detail, "error");
        // Key, quota, and model failures are all fixed in the same place.
        if (/Connect a model|API key|custom endpoint|HTTP 40[1234]|credit|quota|not found/i.test(detail)) {
          connectNudge();
        }
        // A capped task pauses: offer the ways forward as buttons.
        if (/token budget|token-limit/i.test(detail)) {
          budgetNudge();
        }
        // Unsaved files block file tools: name the way out as buttons.
        if (/isolated task begins/i.test(detail)) {
          draftNudge();
        }
        // A step or output limit stops the turn, not the work: offer to continue.
        if (/step limit|response limit/i.test(detail)) {
          continueNudge();
        }
        break;
      }

      case "cancelled":
        streamingBubble = null;
        finishActivity();
        setSendMode("send");
        trace("Cancelled", "You stopped this turn.", "ok");
        break;

      case "turn-end": {
        const finished = streamingBubble;
        finished?.classList.remove("is-streaming");
        streamingBubble = null;
        // Collapse the block to "Worked for Ns" before the actions row lands.
        finishActivity();
        setSendMode("send");
        if (finished && !finished.nextElementSibling?.classList.contains("chat-message-actions")) {
          finished.after(messageActions(finished));
          scrollToEnd();
        }
        void refreshHistory();
        break;
      }
    }
  });

  window.adcode.ai.onProposedEdit((edit) => {
    flushStream();
    streamingBubble = null;
    inlineDiff(edit);
    proposalNotice(edit);
  });

  /* ── Sending ──────────────────────────────────────────────────────────── */

  function submit(): void {
    closeOpenMenu();
    // Cursor-style stop: while a turn is running the send key stops it.
    if (sendButton.dataset["mode"] === "stop") {
      window.adcode.ai.cancel();
      return;
    }
    const text = input.value;
    if (text.trim().length === 0 && pending.length === 0) return;

    // Explicitly not connected: printing the message into a turn that cannot
    // run answers nothing. Say the true thing instead — how to start — with a
    // button that does it. (Unknown status proceeds; the backend reports back.)
    if (modelLabel.dataset["ready"] === "false") {
      connectNudge();
      input.focus();
      return;
    }

    if (activeSuggestion !== null) {
      activeSuggestion = null;
      teamPanel.hidden = true;
    }

    const payload: AiAttachmentView[] = pending.map((item) => ({
      name: item.name,
      kind: item.kind,
      mediaType: item.mediaType,
      data: item.data,
    }));
    const editor = currentEditorContext();
    composerMenu.hide();

    if (
      !dispatchChatSend(
        text,
        {
          showUser: (message, attachments) => bubble("user", message, attachments),
          aiSend: (message, attachments) => window.adcode.ai.send(message, attachments, editor),
          onFailure: () => {
            finishActivity();
            setSendMode("send");
          },
        },
        payload,
      )
    ) {
      return;
    }

    rememberSent(text);
    input.value = "";
    autogrowComposer();
    clearAttachments();
    setSendMode("stop");
    streamingBubble = null;
    // Default "Thinking" state before the first backend event arrives.
    resetActivity();
    ensureActivity();
  }

  /* Drag-drop and paste share the strip: whatever brought the file, it lands pending. */

  function hasFiles(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes("Files") === true;
  }

  card.addEventListener("dragenter", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    card.dataset["drop"] = "true";
  });
  card.addEventListener("dragover", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  card.addEventListener("dragleave", (event) => {
    if (event.relatedTarget !== null && card.contains(event.relatedTarget as Node)) return;
    delete card.dataset["drop"];
  });
  card.addEventListener("drop", (event) => {
    delete card.dataset["drop"];
    if (!hasFiles(event) || event.dataTransfer === null) return;
    event.preventDefault();
    void addFiles([...event.dataTransfer.files]);
  });

  input.addEventListener("paste", (event) => {
    const files = event.clipboardData === null ? [] : [...event.clipboardData.files];
    if (files.length === 0) return;
    // Pasting a screenshot must attach it, not dump binary into the prompt.
    event.preventDefault();
    void addFiles(files);
  });

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });

  input.addEventListener("keydown", (event) => {
    // A key that finishes an IME composition belongs to the IME, not to send.
    if (event.isComposing) return;
    // An open `/` or `@` menu owns arrows, Enter, Tab and Escape.
    if (composerMenu.handleKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const singleLine = !input.value.includes("\n");
    if (event.key === "ArrowUp" && !event.shiftKey && singleLine && (input.value.length === 0 || historyIndex !== null)) {
      if (recallPrompt(-1)) event.preventDefault();
      return;
    }
    if (event.key === "ArrowDown" && !event.shiftKey && historyIndex !== null) {
      if (recallPrompt(1)) event.preventDefault();
      return;
    }
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

  /* ── Coordinator lifecycle ────────────────────────────────────────────── */

  const visibilityListeners: ((open: boolean) => void)[] = [];
  const announce = (): void => {
    for (const listener of visibilityListeners) listener(open);
  };

  const api: ChatWidget = {
    element: card,
    connectButton,
    draft(question): void {
      api.open();
      input.value = [input.value.trim(), question.trim()].filter(Boolean).join("\n\n");
      autogrowComposer();
      input.focus();
    },
    reviewTask(task): void {
      api.open();
      paintWorkspaceTask(task);
      inspectorOpen = false;
      applyDisclosures();
      void renderPersistedReview(task).catch(() => { taskNotice.textContent = "Could not load task changes. Try Review again."; });
    },

    setDocked(next, historyHost): void {
      docked = next;
      externalHistory = next && !!historyHost;
      card.dataset["docked"] = String(next);
      presentationButton.textContent = next ? "↗" : "Dock";
      presentationButton.title = next ? "Expand assistant workspace" : "Dock assistant beside editor";
      presentationButton.setAttribute("aria-label", presentationButton.title);
      resetButton.textContent = next ? "+" : "+ New";
      if (next) closeButton.replaceChildren(createIcon(ICON.close));
      else closeButton.textContent = "Close";
      moreActions.hidden = !next;
      moreActions.open = false;
      for (const action of secondaryActions) {
        if (next) moreMenu.append(action);
        else headerActions.insertBefore(action, resetButton);
      }
      historyHeading.textContent = next ? "Sessions" : "Chats and tasks";
      if (next && historyHost) historyHost.append(history);
      else body.prepend(history);
      applyDisclosures();
      void refreshHistory();
    },

    open(): void {
      deps.requestOpen();
    },

    shown(focus = true): void {
      if (open) return;
      open = true;
      if (dirtyMessages.size) streamPaint.schedule();
      announce();

      if (focus) requestAnimationFrame(() => {
        input.focus();
      });

      void refreshModelStatus();
      statusTimer = window.setInterval(() => { if (!document.hidden) void refreshModelStatus(); }, 5_000);
      void refreshWorkspaceTask();
      void refreshTeam();
      void agentLibrary.refresh();
      if (!controls.element.hidden) controls.show(false);
      if (!automationPanel.hidden) void refreshAutomations();

    },

    hidden(): void {
      if (!open) return;
      open = false;
      controls.hide();
      if (statusTimer !== null) window.clearInterval(statusTimer);
      statusTimer = null;
      announce();
    },

    openTeamSetup(): void {
      runChatWidgetIntent("team", {
        open: () => api.open(),
        showTeam: () => {
          revealInspector();
          void agentLibrary.refresh();
          void suggestForComposer(true);
        },
        showSchedule: showScheduleComposer,
      });
    },

    openScheduleComposer(): void {
      runChatWidgetIntent("schedule", {
        open: () => api.open(),
        showTeam: () => {
          revealInspector();
          void suggestForComposer(true);
        },
        showSchedule: showScheduleComposer,
      });
    },

    close(): void {
      deps.requestClose();
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

    addContext(name: string, text: string): void {
      if (text.trim().length === 0) return;
      api.open();
      addTextContext(name, text);
      requestAnimationFrame(() => requestAnimationFrame(() => input.focus()));
    },

    openComposerMenu(trigger): void {
      api.open();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        input.focus();
        if (trigger === "/") {
          // A command reads the rest of the composer as its detail, so `/` goes first.
          if (!input.value.startsWith("/")) input.value = `/${input.value}`;
          input.setSelectionRange(1, 1);
        } else {
          attachContext.click();
          return;
        }
        refreshComposerMenu();
      }));
    },

    setWorkspace(root: string | null): void {
      chatPreview.clear();
      previewCalls.clear();
      void refreshHistory();
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

  return api;
}
