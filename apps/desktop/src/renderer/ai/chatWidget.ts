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
import { describeAiFailure, OUTPUT_LIMIT_AGAIN } from "./aiFailure.ts";
import { createChatQueue, type QueuedMessage } from "./chatQueue.ts";
import { chipLabel, modelChoices, rememberModel, type ModelChoice } from "./modelSwitch.ts";
import { askThemed } from "../dialogs/confirmDialog.ts";
import { createChatPreview } from "./chatPreview.ts";
import { createAgentViewCard, createPlanCard, planStepsFrom, type AgentViewCard, type PlanCard } from "./chatAgentCards.ts";
import { createTaskDetailsDialog } from "./taskDetailsDialog.ts";
import { createTasksPopupDialog } from "./tasksPopupDialog.ts";
import type { PreviewStatus } from "../../shared/api.ts";
import type {
  AiAttachmentView,
  AiContextUsageView,
  AiEditorContextView,
  AiAutomationView,
  AiTeamSuggestionView,
  AiTeamView,
  AiWorkspaceChangeView,
  AiWorkspaceTaskView,
  ChatSessionView,
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
import { createContextMenu, attachContextMenuDismissal, type ContextMenuNode } from "../workbench/contextMenu.ts";
import { compactCommand, contextMeterModel, createContextMeter } from "./contextMeter.ts";
import { markFor } from "../motionFlip.ts";
import { button as dialogButton, el as dialogEl, openFormModal } from "../dialogs/formDialog.ts";
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
import { createFrameTask } from "../frameTask.ts";
import { attachChatLayout } from "./chatLayout.ts";
import {
  aiWorkspaceActions,
  groupWorkspaceTraces,
  summarizeAiWorkspaceTask,
  TRACE_PREVIEW_LIMIT,
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
import { createQuickConnect, type QuickConnect } from "./quickConnect.ts";
import { firstBuildPrompt, looksLikeBuildRequest } from "../../shared/firstBuild.ts";

export interface ChatWidget {
  readonly element: HTMLElement;
  readonly connectButton: HTMLButtonElement;
  /** Inspect any persisted task without replacing or resetting the active conversation. */
  reviewTask(task: AiWorkspaceTaskView): void;
  /** Open the folder's tasks as a centered popup instead of a sidebar. */
  openTasksPopup(): void;
  /** Prepare editable instructions; never sends or interrupts a running turn. */
  draft(question: string): void;
  setDocked(docked: boolean, historyHost?: HTMLElement): void;
  shown(focus?: boolean): void;
  hidden(): void;
  toggle(): void;
  open(): void;
  /** Start a fresh conversation - the current one stays in History - and focus the composer. */
  newConversation(): void;
  /** Bring chat forward and open the existing, confirmed Team setup flow. */
  openTeamSetup(): void;
  /** Bring chat forward and open the existing local schedule composer. */
  openScheduleComposer(): void;
  /** Summarise the older part of the conversation now, optionally paying attention to `focus`. */
  compactConversation(focus?: string): void;
  /** Show what the last compaction wrote. */
  viewConversationSummary(): void;
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
  /** Whether a turn is running, and the conversation's title: the Agents board's Main chat box. */
  busy(): { readonly busy: boolean; readonly title: string };
  onBusyChange(listener: (busy: boolean) => void): void;
  /**
   * Team setup, schedules and live agent activity. The widget owns its state; the host shows
   * it in a floating panel, because a drawer inside the chat was a sidebar on the right.
   */
  readonly inspector: {
    readonly element: HTMLElement;
    onToggle(listener: (open: boolean) => void): void;
    /** The host closed the panel itself (its own close button or Escape). */
    close(): void;
  };
}

export interface ChatWidgetDeps {
  readonly openPreview?: () => void;
  /** Point the floating preview at a page, when it is open: the assistant opened that page. */
  readonly showPreviewPage?: (url: string) => void;
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
  /** Generic text prompt (custom token budget, folder names). Null when dismissed. */
  readonly promptText?: (title: string, body: string, value: string) => Promise<string | null>;
  /** Switch the open project folder. Wired to workspace.open in main. */
  readonly switchFolder?: () => void;
  /** Current open folder root, for the per-folder banner. Updated via setWorkspace. */
  readonly currentFolder?: () => string | null;
  /** What the user is looking at; rides with each send so "this file" means something. */
  readonly editorContext?: () => AiEditorContextView | null;
  /** Workspace files matching an `@` query, as workspace-relative paths. */
  readonly mentionFiles?: (query: string) => Promise<readonly string[]>;
  /** A mentioned file's text: the open buffer when there is one, so unsaved edits count. */
  readonly readMention?: (relativePath: string) => Promise<string | null>;
  /** Uncommitted changes as a unified diff for /review and /commit, "" when clean. */
  readonly uncommittedDiff?: () => Promise<string>;
  /** Open the report form, prefilled, with the debug log ticked. */
  readonly reportProblem?: (prefill: { readonly title: string; readonly body: string }) => void;
  /** Open the Tools page: MCP servers, skills, built-in tools and project memory. */
  readonly openTools?: () => void;
  /** Open Settings at one setting - the meter's "Auto-compact settings". */
  readonly openSettings?: (settingId: string) => void;
  /**
   * Make a project folder for an idea and open it. Used when somebody asks for something
   * to be built with no folder open: they have an idea, not a folder, and should not be
   * sent to find one. Resolves true once the new folder is the open one.
   */
  readonly createProjectFor?: (idea: string) => Promise<boolean>;
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
    if (element.classList.contains("is-streaming")) markFreshBlocks(element);
  }

  /** When each block of a streaming answer first appeared, so it can fade in across re-renders. */
  const blockBirths = new WeakMap<HTMLElement, number[]>();

  /**
   * Fade in the paragraphs, lists and code blocks an answer is still growing.
   *
   * A streaming answer is re-rendered on every frame, so each block is a fresh element every
   * time; a plain entrance would restart each frame and never finish. Each block keeps the
   * time it first appeared, and its copy resumes the fade from there with a negative delay.
   */
  function markFreshBlocks(element: HTMLElement): void {
    const births = blockBirths.get(element) ?? [];
    const now = performance.now();
    [...element.children].forEach((block, index) => {
      births[index] ??= now;
      const age = now - births[index]!;
      if (age < 240 && block instanceof HTMLElement) {
        block.dataset["fresh"] = "true";
        block.style.animationDelay = `-${String(Math.round(age))}ms`;
      }
    });
    blockBirths.set(element, births);
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
  modelLabel.setAttribute("aria-haspopup", "menu");
  modelLabel.setAttribute("aria-expanded", "false");

  /*
   * The chip switches model from a small menu, as Claude, Codex and Cursor do: what can
   * answer now - the model in use, each connected provider's recommended model, the ones
   * used recently - with everything else under "More models and providers".
   */
  const modelMenu = createContextMenu(document.body);
  attachContextMenuDismissal(modelMenu, () => modelLabel.focus(), false);
  const RECENT_MODELS = "adcode.chat.recentModels";
  const readRecentModels = (): string[] => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_MODELS) ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((one): one is string => typeof one === "string") : [];
    } catch {
      return [];
    }
  };
  const writeRecentModels = (list: readonly string[]): void => {
    try {
      localStorage.setItem(RECENT_MODELS, JSON.stringify(list));
    } catch {
      // Storage off: the menu still offers recommended models.
    }
  };
  async function switchModel(choice: ModelChoice): Promise<void> {
    if (choice.current) return;
    await window.adcode.settings.write("adcode.ai.provider", choice.provider);
    await window.adcode.settings.write("adcode.ai.model", choice.model);
    writeRecentModels(rememberModel(readRecentModels(), choice.provider, choice.model));
    await refreshModelStatus();
    modeNote(`Now using ${choice.modelName} on ${choice.providerName}. The conversation carries on.`);
  }
  async function openModelMenu(): Promise<void> {
    const status = await window.adcode.ai.status().catch(() => null);
    const choices = status === null ? [] : modelChoices(status, readRecentModels());
    if (choices.length === 0) {
      deps.openConnect();
      return;
    }
    const nodes: ContextMenuNode[] = [];
    let lastProvider = "";
    for (const choice of choices) {
      if (choice.provider !== lastProvider) {
        nodes.push({ kind: "heading", label: choice.providerName });
        lastProvider = choice.provider;
      }
      nodes.push({
        label: choice.modelName,
        accelerator: choice.current ? "✓" : choice.recommended ? "Recommended" : choice.free ? "Free" : "",
        run: () => void switchModel(choice).catch(() => deps.openConnect()),
      });
    }
    nodes.push({ kind: "separator" }, { label: "More models and providers…", run: () => deps.openConnect() });
    const rect = modelLabel.getBoundingClientRect();
    modelLabel.setAttribute("aria-expanded", "true");
    modelMenu.open(rect.left, rect.top - 4, nodes, () => modelLabel.setAttribute("aria-expanded", "false"));
  }
  let modelMenuWasOpen = false;
  modelLabel.addEventListener("pointerdown", () => { modelMenuWasOpen = modelMenu.isOpen(); });
  modelLabel.addEventListener("click", () => {
    if (modelMenuWasOpen) { modelMenuWasOpen = false; return; }
    // Not connected yet: the chip is the way to connect, so it opens Connect itself.
    if (modelLabel.dataset["ready"] !== "true") {
      deps.openConnect();
      return;
    }
    void openModelMenu();
  });
  const queueLabel = document.createElement("span");
  queueLabel.className = "chat-queue-status";
  queueLabel.setAttribute("role", "status");
  queueLabel.hidden = true;
  let statusTimer: number | null = null;
  let statusRefreshInFlight = false;
  let statusRefreshing: Promise<void> | null = null;
  /**
   * Guard overlapping 2s polls: a slow status read must never stack up and flicker the
   * pill. A caller that arrives mid-read gets that read, not an early return - a send
   * deciding whether a model is ready needs the answer, not the last good guess.
   */
  function refreshModelStatus(): Promise<void> {
    statusRefreshing ??= readModelStatus().finally(() => { statusRefreshing = null; });
    return statusRefreshing;
  }
  async function readModelStatus(): Promise<void> {
    if (statusRefreshInFlight) return;
    statusRefreshInFlight = true;
    try {
      const status = await window.adcode.ai.status();
      const active = status.providers.find((provider) => provider.id === status.activeProvider);
      const saved = status.providers.some((provider) => provider.hasKey && provider.needsKey);
      const label = status.ready
        ? chipLabel(status)
        : saved ? "Select a saved connection" : "Connect a model to begin";
      // No flicker: only touch the DOM when the label actually changed.
      if (modelLabel.textContent !== label) modelLabel.textContent = label;
      connectButton.textContent = status.ready || saved ? "Models" : "Connect";
      modelLabel.dataset["ready"] = String(status.ready);
      modelLabel.title = status.ready
        ? `${active?.displayName ?? status.activeProvider} / ${status.activeModel} — switch model`
        : "Choose a provider and model (Connect)";
      modelLabel.setAttribute("aria-label", status.ready
        ? `Model: ${status.activeModel}. Change provider or model`
        : "Choose a provider and model");
      setupStatus.dataset["state"] = status.ready ? "ready" : "idle";
      modelReady = status.ready;
      paintSetup();
      // A message that waited for a model goes as soon as one is ready, wherever it was
      // connected from - the card in the chat, the Connect screen, or the welcome.
      if (status.ready && waitingForModel !== null) {
        const waiting = waitingForModel;
        waitingForModel = null;
        if (input.value.trim() === waiting.trim()) queueMicrotask(() => submit());
      }
      const setupLabel = status.ready
        ? `Connected: ${active?.displayName ?? status.activeProvider} — you're set.`
        : "Not connected yet - the free option takes about a minute, no card.";
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
    planCard = null;
    viewCard = null;
    transcript.replaceChildren();
    streamingBubble = null;
    activeSessionId = null;
    conversationTitle.textContent = "New conversation";
    renderMemory(null);
    currentSummary = null;
    void refreshHistory();
    queueMicrotask(() => refreshContextMeter());
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
  controlsButton.title = "Open Tools: MCP servers, skills, built-in tools and project memory";
  controlsButton.addEventListener("click", () => deps.openTools?.());
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

  /* Per-folder scope: chats and tasks belong to the open folder, never merged. */
  let currentFolderRoot: string | null = deps.currentFolder?.() ?? null;
  const folderBanner = document.createElement("div");
  folderBanner.className = "chat-folder-banner";
  folderBanner.setAttribute("aria-label", "Current project folder");
  const folderName = document.createElement("button");
  folderName.type = "button";
  folderName.className = "chat-folder-name";
  folderName.title = "Change the project folder";
  const folderMeta = document.createElement("span");
  folderMeta.className = "chat-folder-meta";
  folderMeta.setAttribute("role", "status");
  const folderTasksButton = document.createElement("button");
  folderTasksButton.type = "button";
  folderTasksButton.className = "ghost-button";
  folderTasksButton.textContent = "Tasks";
  folderTasksButton.title = "Show tasks for this folder";
  const folderSwitchButton = document.createElement("button");
  folderSwitchButton.type = "button";
  folderSwitchButton.className = "ghost-button";
  folderSwitchButton.textContent = "Switch…";
  folderSwitchButton.title = "Open another folder or see all tasks";
  folderBanner.append(folderName, folderMeta, folderTasksButton, folderSwitchButton);

  const folderDialog = document.createElement("dialog");
  folderDialog.className = "result-dialog folder-dialog";
  const folderCard = document.createElement("div");
  folderCard.className = "result-card";
  const folderDialogTitle = document.createElement("h2");
  folderDialogTitle.className = "result-title";
  folderDialogTitle.textContent = "Project folder";
  const folderDialogBody = document.createElement("p");
  folderDialogBody.className = "result-summary";
  const folderDialogButtons = document.createElement("div");
  folderDialogButtons.className = "confirm-buttons";
  const folderOpen = document.createElement("button");
  folderOpen.type = "button";
  folderOpen.className = "result-close";
  folderOpen.textContent = "Open folder…";
  const folderViewTasks = document.createElement("button");
  folderViewTasks.type = "button";
  folderViewTasks.className = "confirm-cancel";
  folderViewTasks.textContent = "View tasks";
  const folderNewChat = document.createElement("button");
  folderNewChat.type = "button";
  folderNewChat.className = "confirm-cancel";
  folderNewChat.textContent = "New conversation";
  const folderClose = document.createElement("button");
  folderClose.type = "button";
  folderClose.className = "confirm-cancel";
  folderClose.textContent = "Close";
  folderDialogButtons.append(folderOpen, folderViewTasks, folderNewChat, folderClose);
  folderCard.append(folderDialogTitle, folderDialogBody, folderDialogButtons);
  folderDialog.append(folderCard);
  document.body.append(folderDialog);
  const closeFolderDialog = (): void => {
    if (folderDialog.open) folderDialog.close();
  };
  folderOpen.addEventListener("click", () => {
    closeFolderDialog();
    deps.switchFolder?.();
  });
  folderViewTasks.addEventListener("click", () => {
    closeFolderDialog();
    openTasksPopup();
  });
  folderNewChat.addEventListener("click", () => {
    closeFolderDialog();
    resetButton.click();
  });
  folderClose.addEventListener("click", closeFolderDialog);
  folderDialog.addEventListener("click", (event) => {
    if (event.target === folderDialog) closeFolderDialog();
  });
  const openFolderDialog = (): void => {
    const name = currentFolderRoot?.split(/[\\/]/).pop() || "No folder";
    folderDialogBody.textContent = currentFolderRoot === null
      ? "No folder is open. Chats and tasks stay with the folder where they were created."
      : `${name} — ${currentFolderRoot}. Chats and tasks shown here belong only to this folder.`;
    if (!folderDialog.open) folderDialog.showModal();
    folderClose.focus();
  };
  folderName.addEventListener("click", openFolderDialog);
  folderSwitchButton.addEventListener("click", openFolderDialog);
  folderTasksButton.addEventListener("click", () => openTasksPopup());

  async function paintFolderBanner(): Promise<void> {
    const short = currentFolderRoot?.split(/[\\/]/).pop() || "No folder";
    folderName.textContent = `📁 ${short}`;
    folderName.title = currentFolderRoot ?? "No folder is open — click to open one";
    try {
      const [tasks, sessions] = await Promise.all([
        window.adcode.aiWorkspace.list().catch(() => []),
        window.adcode.chat.sessions().catch(() => []),
      ]);
      folderMeta.textContent = currentFolderRoot === null
        ? "open a folder to scope chats and tasks"
        : `${tasks.length} task${tasks.length === 1 ? "" : "s"} · ${sessions.length} chat${sessions.length === 1 ? "" : "s"} · this folder only`;
    } catch {
      folderMeta.textContent = currentFolderRoot === null ? "" : "tasks and chats are per-folder";
    }
  }

  /* ── Transcript ───────────────────────────────────────────────────────── */

  const transcript = document.createElement("div");
  const chatPreview = createChatPreview(transcript);
  const previewCalls = new Set<string>();
  /*
   * One plan card and one "what the assistant saw" card per turn, updated in place: a plan is
   * re-sent after every step and a page may be checked five times, and five cards each would
   * bury the answer.
   */
  let planCard: PlanCard | null = null;
  let viewCard: AgentViewCard | null = null;
  function openPageInChat(url: string): void {
    void window.adcode.preview.status().then((status) => chatPreview.show(status, url), () => undefined);
    deps.showPreviewPage?.(url);
  }
  transcript.className = "chat-transcript";
  transcript.setAttribute("aria-live", "polite");
  transcript.setAttribute("role", "log");
  transcript.setAttribute("aria-label", "Conversation");

  // Stick-to-bottom: the transcript follows the tail only while the user is
  // already near the bottom. Scrolling up pins the view and reveals the
  // floating "Jump to latest" button instead of yanking the user back down
  // on every streamed token.
  let stickToBottom = true;
  let pendingUnread = 0;
  let scrollButton: HTMLButtonElement | null = null;
  let scrollButtonLabel: HTMLElement | null = null;

  function isNearBottom(): boolean {
    try {
      const distance = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
      return distance < 80;
    } catch {
      return true;
    }
  }

  function updateScrollButton(): void {
    if (scrollButton === null) return;
    const near = isNearBottom();
    stickToBottom = near;
    if (near) pendingUnread = 0;
    const hasContent = transcript.childElementCount > 0;
    scrollButton.hidden = near || !hasContent;
    // A fixed offset put the pill on top of the composer's text whenever the composer was
    // taller than 86px - which, with its toolbar and hint row, it always is. Sit it 12px
    // above whatever height the composer has right now.
    const composerBox = scrollButton.parentElement?.querySelector<HTMLElement>(":scope > .chat-composer");
    if (!scrollButton.hidden && composerBox) {
      const below = Number.parseFloat(getComputedStyle(composerBox).marginBottom) || 0;
      scrollButton.style.bottom = `${String(Math.round(composerBox.offsetHeight + below + 12))}px`;
    }
    if (scrollButtonLabel !== null) {
      scrollButtonLabel.textContent = pendingUnread > 0 ? `Jump to latest · ${String(pendingUnread)} new` : "Jump to latest";
    }
    scrollButton.setAttribute(
      "aria-label",
      pendingUnread > 0
        ? `Scroll to latest messages, ${String(pendingUnread)} new messages`
        : "Scroll to latest messages",
    );
  }

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
  const historyMenu = createContextMenu(document.body);
  let historyMenuTrigger: HTMLButtonElement | null = null;
  attachContextMenuDismissal(historyMenu, () => historyMenuTrigger?.focus());

  async function refreshHistory(): Promise<void> {
    saved = await window.adcode.chat.sessions();
    const current = await window.adcode.chat.current().catch(() => null);
    activeSessionId = current?.id ?? null;
    conversationTitle.textContent = current === null || current.messages.length === 0
      ? "New conversation"
      : current.title;
    renderHistory();
    void paintFolderBanner();
  }

  function toggleHistory(): void {
    if (externalHistory) { deps.revealHistory?.(); historySearch.focus(); return; }
    historyOpen = !historyOpen;
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
    openIt.title = session.title;
    openIt.setAttribute("aria-current", session.id === activeSessionId ? "true" : "false");
    openIt.addEventListener("click", () => void resume(session.id));

    const options = document.createElement("button");
    options.type = "button";
    options.className = "chat-history-options";
    options.append(createIcon(ICON.more));
    options.title = `Options for ${session.title}`;
    options.setAttribute("aria-label", options.title);
    options.setAttribute("aria-haspopup", "menu");
    options.setAttribute("aria-expanded", "false");
    options.addEventListener("click", () => {
      historyMenuTrigger = options;
      options.setAttribute("aria-expanded", "true");
      const rect = options.getBoundingClientRect();
      historyMenu.open(rect.right, rect.bottom + 4, [
        { label: "Rename conversation", run: async () => {
          const name = await deps.askForName(session.title);
          if (name === null) return;
          saved = await window.adcode.chat.rename(session.id, name);
          if (session.id === activeSessionId) conversationTitle.textContent = name;
          renderHistory();
        } },
        { label: "Delete conversation", danger: true, run: async () => {
          saved = await window.adcode.chat.remove(session.id);
          if (session.id === activeSessionId) {
            activeSessionId = null;
            conversationTitle.textContent = "New conversation";
          }
          renderHistory();
        } },
      ], () => options.setAttribute("aria-expanded", "false"));
    });

    row.append(openIt, options);
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

  /** True while a reopened conversation is drawn, which should appear at once. */
  let restoring = false;

  /** Draw a past conversation back into the transcript. */
  async function resume(id: string): Promise<void> {
    if (docked) api.open();
    const session = await window.adcode.chat.resume(id);
    if (session === null) return;

    resetActivity();
    chatPreview.clear();
    previewCalls.clear();
    planCard = null;
    viewCard = null;
    transcript.replaceChildren();
    streamingBubble = null;
    activeSessionId = session.id;
    conversationTitle.textContent = session.title;

    restoring = true;
    try {
      for (const message of session.messages) {
        bubble(message.role === "user" ? "user" : "assistant", message.text, [], message.at);
      }
    } finally {
      restoring = false;
    }
    // Everything above the line is what the summary stands for; the model reads the
    // summary and the messages below it.
    currentSummary = session.summary?.text ?? null;
    const summary = session.summary ?? null;
    if (summary !== null && summary.coversUntil > 0) {
      transcript.insertBefore(compactionDivider(), transcript.children[summary.coversUntil] ?? null);
    }
    refreshContextMeter();

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

  /* -- Compaction: the summary that stands for the older conversation ---- */

  /** What the last compaction wrote; null until this conversation has been compacted. */
  let currentSummary: string | null = null;
  let compacting = false;

  function compactionDivider(): HTMLElement {
    const divider = document.createElement("div");
    divider.className = "chat-compaction-divider";
    divider.setAttribute("role", "note");
    const label = document.createElement("span");
    label.className = "chat-compaction-label";
    label.textContent = "Earlier conversation compacted";
    const view = document.createElement("button");
    view.type = "button";
    view.className = "chat-compaction-view";
    view.textContent = "View summary";
    view.addEventListener("click", () => viewSummary());
    divider.append(label, view);
    return divider;
  }

  function viewSummary(): void {
    const text = currentSummary;
    if (text === null) {
      complain("This conversation has not been compacted yet.");
      return;
    }
    const modal = openFormModal("chat-summary-dialog", "Conversation summary", () => input.focus());
    const buttons = dialogEl("div", "confirm-buttons");
    buttons.append(
      dialogButton("Copy", "confirm-cancel", () => void copyText(text)),
      dialogButton("Close", "result-close", () => modal.finish()),
    );
    modal.card.append(
      dialogEl("p", "form-hint", "What the assistant carries forward in place of the earlier messages."),
      dialogEl("pre", "chat-summary-text", text),
      buttons,
    );
    modal.dialog.showModal();
  }

  async function compactNow(focus?: string): Promise<void> {
    if (compacting) return;
    if (turnActive) {
      complain("Wait for the current answer to finish, then compact.");
      return;
    }
    compacting = true;
    contextMeter.element.dataset["busy"] = "true";
    composerNotice.textContent = "Compacting the conversation…";
    composerNotice.hidden = false;
    try {
      const result = await window.adcode.ai.compact(focus);
      if (result.ok) composerNotice.hidden = true;
      else complain(result.message);
    } catch (error) {
      complain(error instanceof Error ? error.message : "Could not compact the conversation.");
    } finally {
      compacting = false;
      delete contextMeter.element.dataset["busy"];
      refreshContextMeter();
    }
  }

  /* -- Isolated task status -------------------------------------------- */

  /*
   * Staged AI work - Review mode's turns and a Team's combined result - is reviewed in one
   * place: the card the conversation shows when that work is ready, with Apply all, Discard
   * and each file's diff. There is no strip, pop-up or per-edit notice beside it; what a
   * task action has to say lands in the conversation as a one-line note.
   */
  let activeWorkspaceTask: AiWorkspaceTaskView | null = null;
  let taskRefreshGeneration = 0;
  /** Tasks whose ready changes the conversation has already offered, so each is offered once. */
  const reviewShownFor = new Set<string>();
  /** A turn is under way (seen from its events), and when it started. */
  let turnActive = false;
  let turnStartedAt = 0;
  const taskStatus = (text: string): void => modeNote(text);

  /* Task popup: the task as a box inside the chat, with Cancel and Delete. */
  const detailsDialog = createTaskDetailsDialog(document.body, {
    onCancel: (task) => {
      window.adcode.ai.cancel();
      taskStatus(`Cancelling "${task.prompt}" — the turn stops safely and the task is kept.`);
    },
    onDelete: async (task) => {
      try {
        const removed = await window.adcode.aiWorkspace.remove(task.id);
        if (removed) {
          if (activeWorkspaceTask?.id === task.id) paintWorkspaceTask(null);
          taskStatus(`Deleted "${task.prompt}".`);
          void refreshWorkspaceTask();
          void paintFolderBanner();
        } else {
          taskStatus("That task is already gone.");
          void refreshWorkspaceTask();
        }
      } catch (error) {
        taskStatus(error instanceof Error ? error.message : "Could not delete this task.");
      }
    },
    onRollback: async (task) => {
      try {
        const result = await window.adcode.aiWorkspace.rollback(task.id);
        paintWorkspaceTask(result.task);
        taskStatus(result.message);
      } catch {
        taskStatus("Could not roll back this task. Try again.");
      }
    },
    onShowInChat: async (task) => {
      paintWorkspaceTask(task);
      try {
        await renderPersistedReview(task);
        await renderPersistedTrace(task);
      } catch {
        taskStatus("Could not load task details. Try again.");
      }
      scrollToEnd(true);
    },
  });

  /* Tasks popup: the folder's tasks as a centered list instead of a sidebar. */
  const tasksPopup = createTasksPopupDialog(document.body, {
    onOpenTask: (task) => {
      paintWorkspaceTask(task);
      detailsDialog.open(task);
    },
  });
  function openTasksPopup(): void {
    api.open();
    tasksPopup.open();
  }

  /**
   * Main refuses to apply a task that is not this folder's to apply - a finished Team role,
   * another project's task, or one already removed. That is not "retry": say what it is.
   */
  function isUnavailableTask(error: unknown): boolean {
    return String(error instanceof Error ? error.message : error).includes("not in the open workspace");
  }
  function applyFailureMessage(error: unknown, fallback: string): string {
    return isUnavailableTask(error)
      ? "This task can't be applied here - it belongs to a project that isn't open, or it has already finished. Nothing in your project changed."
      : fallback;
  }

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
  input.placeholder = "Plan, Build, / for skills, @ for context…";
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

  /* ── Follow-ups typed while the assistant works ───────────────────── */

  // Enter while a turn runs queues the message instead of stopping the work it is about.
  // Each one goes, in order, when the turn before it finishes; Send now and × act on one.
  const followUps = createChatQueue<PendingAttachment>();
  /** A follow-up waiting for the turn it interrupted to finish cancelling. */
  let sendAfterCancel: QueuedMessage<PendingAttachment> | null = null;
  const queueStrip = document.createElement("div");
  queueStrip.className = "chat-queued";
  queueStrip.hidden = true;
  queueStrip.setAttribute("aria-label", "Queued messages");
  followUps.onChange((items) => {
    queueStrip.replaceChildren();
    queueStrip.hidden = items.length === 0;
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "chat-queued-item";
      const label = document.createElement("span");
      label.className = "chat-queued-label";
      label.textContent = "Queued";
      const text = document.createElement("span");
      text.className = "chat-queued-text";
      text.textContent = item.text.trim() || `${String(item.attachments.length)} attachment${item.attachments.length === 1 ? "" : "s"}`;
      text.title = item.text;
      const now = document.createElement("button");
      now.type = "button";
      now.className = "chat-queued-now";
      now.textContent = "Send now";
      now.title = "Stop the current step and send this now";
      now.addEventListener("click", () => sendFollowUpNow(item.id));
      const drop = document.createElement("button");
      drop.type = "button";
      drop.className = "chat-queued-remove";
      drop.textContent = "×";
      drop.setAttribute("aria-label", "Remove this queued message");
      drop.addEventListener("click", () => followUps.remove(item.id));
      row.append(label, text, now, drop);
      queueStrip.append(row);
    }
  });

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

  /*
   * The approval control: how the assistant's edits reach the project, and how much it
   * may do on its own. It used to be a decorative "Agent" pill; "Review every change"
   * existed only as a Settings row nobody would think to open mid-conversation. Here it
   * is where the conversation is - Review or Auto - with the automation switches beside.
   */
  const modePill = document.createElement("button");
  modePill.type = "button";
  modePill.className = "chat-mode-pill chat-approval";
  modePill.setAttribute("aria-haspopup", "menu");
  modePill.setAttribute("aria-expanded", "false");
  // The defaults, until the saved settings arrive: edits land, and it keeps going.
  let editPolicy: "review" | "trusted" = "trusted";
  let keepGoing = true;
  const paintApproval = (): void => {
    const auto = editPolicy === "trusted";
    modePill.textContent = auto ? "Auto" : "Review";
    modePill.dataset["mode"] = auto ? "auto" : "review";
    modePill.title = auto
      ? "Edits apply as the assistant works; undo any turn from the chat. Click to change."
      : "Each turn's edits wait for you to apply them. Click to change.";
    modePill.setAttribute("aria-label", `AI edit approval: ${auto ? "Apply automatically" : "Review every change"}${keepGoing ? ", keep going until done" : ""}. Change`);
  };
  const adoptApproval = (values: Record<string, unknown>): void => {
    editPolicy = values["adcode.ai.editPolicy"] === "review" ? "review" : "trusted";
    keepGoing = values["adcode.ai.keepGoing"] !== false;
    paintApproval();
  };
  void window.adcode.settings.read().then(adoptApproval, () => paintApproval());
  window.adcode.settings.onChanged((values) => adoptApproval(values));
  const approvalMenu = createContextMenu(document.body);
  attachContextMenuDismissal(approvalMenu, () => modePill.focus(), false);
  function setEditPolicy(next: "review" | "trusted", announce = true): void {
    if (next === editPolicy) return;
    // The pill follows the setting as saved, never the click, so a failed write shows the truth.
    void window.adcode.settings.write("adcode.ai.editPolicy", next).then((values) => {
      adoptApproval(values);
      if (!announce || editPolicy !== next) return;
      modeNote(next === "trusted"
        ? "Edits now apply as the assistant works. Each turn that changes files gets an Undo button here."
        : "Edits now wait for you: when a turn ends, its changes appear here with Apply all. Nothing reaches your files until then.");
    }, () => undefined);
  }
  let approvalWasOpen = false;
  modePill.addEventListener("pointerdown", () => { approvalWasOpen = approvalMenu.isOpen(); });
  modePill.addEventListener("click", () => {
    if (approvalWasOpen) { approvalWasOpen = false; return; }
    const rect = modePill.getBoundingClientRect();
    modePill.setAttribute("aria-expanded", "true");
    approvalMenu.open(rect.left, rect.top - 4, [
      { kind: "heading", label: "When the assistant edits files" },
      { label: "Apply automatically · undo any turn", accelerator: editPolicy === "trusted" ? "✓" : "", run: () => setEditPolicy("trusted") },
      { label: "Review every change", accelerator: editPolicy === "review" ? "✓" : "", run: () => setEditPolicy("review") },
      { kind: "heading", label: "Automation" },
      {
        label: "Keep going until done",
        accelerator: keepGoing ? "✓" : "",
        run: () => {
          keepGoing = !keepGoing;
          paintApproval();
          void window.adcode.settings.write("adcode.ai.keepGoing", keepGoing);
          modeNote(keepGoing
            ? "The assistant will carry on by itself at its step limit, up to five times in a row."
            : "The assistant will stop at its step limit and wait for you.");
        },
      },
      { label: "Schedule a message…", run: () => api.openScheduleComposer() },
      { label: "Split the job across an AI team…", run: () => api.openTeamSetup() },
    ], () => modePill.setAttribute("aria-expanded", "false"));
  });
  /** A one-line note in the conversation: what just changed about how the assistant works. */
  function modeNote(text: string): void {
    const note = document.createElement("p");
    note.className = "chat-mode-note";
    note.setAttribute("role", "status");
    note.textContent = text;
    transcript.append(note);
    scrollToEnd(true);
  }
  paintApproval();

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
  disclaimer.textContent = "Enter to send · Shift+Enter new line · @ file · / command · ↑ last prompt";
  // How full the model's context is, and the way to make room on purpose.
  const meterMenu = createContextMenu(document.body);
  attachContextMenuDismissal(meterMenu, () => contextMeter.element.focus());
  let lastUsage: AiContextUsageView | null = null;
  const contextMeter = createContextMeter((trigger) => {
    trigger.setAttribute("aria-expanded", "true");
    const rect = trigger.getBoundingClientRect();
    meterMenu.open(rect.left, rect.top - 4, [
      ...(lastUsage === null ? [] : [{ kind: "heading" as const, label: contextMeterModel(lastUsage).amount }]),
      { label: "Compact now", run: () => void compactNow() },
      { label: "View summary", disabled: currentSummary === null, run: () => viewSummary() },
      { kind: "separator" as const },
      { label: "Auto-compact settings", run: () => deps.openSettings?.("adcode.ai.autoCompact") },
    ], () => trigger.setAttribute("aria-expanded", "false"));
  });
  function refreshContextMeter(): void {
    void window.adcode.ai.contextUsage().then((usage) => {
      lastUsage = usage;
      contextMeter.update(usage);
    }, () => undefined);
  }
  composerFooter.append(disclaimer, contextMeter.element);
  refreshContextMeter();
  window.adcode.chat.onChanged((session) => {
    // Whichever conversation is current now - possibly a new one started in the other window.
    currentSummary = session?.summary?.text ?? null;
    refreshContextMeter();
  });
  void window.adcode.chat.current().then((session) => {
    currentSummary = session?.summary?.text ?? null;
  }, () => undefined);
  composer.append(queueStrip, input, attachmentStrip, composerNotice, toolbar, composerFooter, filePicker);

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
      case "compact": void compactNow(); return;
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
  // Re-read on every empty conversation: the window may have been open since morning.
  const paintGreeting = (): void => {
    const hour = new Date().getHours();
    welcomeGreeting.textContent = hour < 5
      ? "Working late"
      : hour < 12
        ? "Good morning"
        : hour < 18
          ? "Good afternoon"
          : "Good evening";
  };
  paintGreeting();
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
  setupConnectItem.style.setProperty("--i", "1");
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
  setupAskItem.style.setProperty("--i", "2");
  const setupAsk = document.createElement("button");
  setupAsk.type = "button";
  setupAsk.className = "ghost-button chat-setup-action";
  setupAsk.textContent = "2 · Describe what to build";
  setupAsk.addEventListener("click", () => {
    input.focus();
    autogrowComposer();
  });
  const setupHint = document.createElement("span");
  setupHint.className = "chat-setup-status";
  setupHint.textContent = "Write below, Enter sends";
  setupAskItem.append(setupAsk, setupHint);

  /*
   * Opening a folder is a side door, not step one.
   *
   * It used to lead the list - "1 · Open a project folder" - which asked people who arrived
   * with an idea to go and find a folder first. With no folder open, a request to build
   * something now makes its own project; this is for people who already have one.
   */
  const setupFolderItem = document.createElement("li");
  setupFolderItem.className = "chat-setup-step chat-setup-folder";
  const setupFolder = document.createElement("button");
  setupFolder.type = "button";
  setupFolder.className = "ghost-button chat-setup-action";
  setupFolder.textContent = "Open an existing folder";
  setupFolder.addEventListener("click", () => deps.switchFolder?.());
  const setupFolderHint = document.createElement("span");
  setupFolderHint.className = "chat-setup-status";
  setupFolderHint.textContent = "Optional - with none open, ADCode makes a project for what you describe.";
  setupFolderItem.append(setupFolder, setupFolderHint);

  setupSteps.append(setupConnectItem, setupAskItem, setupFolderItem);
  /*
   * Which steps are still to do. Vibe shows the list only while something is missing -
   * a returning user with a folder and a model should see the prompt, not a checklist.
   * Connecting comes first because it is the one thing that blocks everything else.
   */
  let modelReady: boolean | null = null;
  function paintSetup(): void {
    const hasFolder = currentFolderRoot !== null;
    setupFolderItem.hidden = hasFolder;
    setupConnectItem.hidden = modelReady === true && !hasFolder;
    setupConnectItem.dataset["done"] = String(modelReady === true);
    setupSteps.dataset["needed"] = String(!hasFolder || modelReady === false);
    setupConnect.textContent = modelReady === true ? "1 · AI connected" : "1 · Connect your AI - free";
    setupConnect.className = `${modelReady === true ? "ghost-button" : "chat-send"} chat-setup-action`;
    // Numbered only while there is a step 1 above it.
    setupAsk.textContent = `${setupConnectItem.hidden ? "" : "2 · "}${hasFolder ? "Ask for a change" : "Describe what to build"}`;
    setupAsk.className = `${modelReady === true ? "chat-send" : "ghost-button"} chat-setup-action`;
    welcomeText.textContent = hasFolder
      ? "What can I help you build or change in this project?"
      : "What do you want to build? Describe it below - ADCode makes the project, writes the code and shows it running.";
    paintStarters(hasFolder);
  }
  const quickActions = document.createElement("div");
  quickActions.className = "chat-quick-actions";
  // A starter that ends in ": " waits for the user's words; a complete one sends at once.
  // Each one heads for a result - none of them is a review step.
  type Starter = { label: string; hint: string; prompt?: string; run?: () => void };
  const projectStarters: readonly Starter[] = [
    { label: "Explain this project", hint: "A tour of the codebase", prompt: "Give me a short tour of this project: what it does, how the code is organised, how to run it, and where a newcomer should start reading." },
    { label: "Build something", hint: "Describe it - ADCode builds it", prompt: "Build this in my project, then run it and check that it works: " },
    { label: "Fix an error", hint: "Paste it or name the file", prompt: "Find the root cause of this error and fix it, then verify the fix: " },
    { label: "Plan new idea", hint: "Scope it before building", prompt: "Plan this idea for my project. Identify the files, risks, and a way to verify the result: " },
    { label: "Multitask", hint: "Set up an AI team", run: () => api.openTeamSetup() },
  ];
  // With no folder open, the starters are things to build: each one makes its own project.
  const ideaStarters: readonly Starter[] = [
    { label: "Landing page", hint: "For a business or an idea", prompt: "Build a landing page for my small business, with a hero section, services, testimonials and a contact form." },
    { label: "Snake game", hint: "Plays in the browser", prompt: "Build a snake game in the browser with a score, a high score and a restart button." },
    { label: "To-do app", hint: "Saved in the browser", prompt: "Build a to-do app where I can add, tick off and delete tasks, saved in the browser." },
    { label: "Portfolio", hint: "About, projects, contact", prompt: "Build a personal portfolio site with an about section, my projects and a way to contact me." },
    { label: "Something else", hint: "Describe it - ADCode builds it", prompt: "Build this, then open it in the preview: " },
  ];
  /*
   * "Continue" - the conversation this project was left on, first among the starters.
   *
   * Five of the first 419 installs ever came back, and the ones that did reopened to a
   * greeting and four generic starters, with the work they had been doing one click away
   * in a sidebar list. Picking up where you left off is the reason to come back, so it is
   * the first thing offered.
   */
  const continueAction = document.createElement("button");
  continueAction.type = "button";
  continueAction.className = "chat-quick-action chat-quick-continue";
  continueAction.hidden = true;
  let continueId: string | null = null;
  continueAction.addEventListener("click", () => {
    if (continueId !== null) void resume(continueId);
  });
  async function paintContinue(): Promise<void> {
    if (currentFolderRoot === null) {
      continueAction.hidden = true;
      return;
    }
    try {
      const sessions = await window.adcode.chat.sessions();
      const latest = sessions.find((one) => one.messages.length > 0 && one.id !== activeSessionId) ?? null;
      continueId = latest?.id ?? null;
      continueAction.hidden = latest === null;
      if (latest !== null) {
        const title = latest.title.length > 42 ? `${latest.title.slice(0, 41)}…` : latest.title;
        const hint = document.createElement("small");
        hint.textContent = "Pick up where you left off";
        continueAction.replaceChildren(`Continue “${title}”`, hint);
      }
    } catch {
      continueAction.hidden = true;
    }
  }

  let startersFor: boolean | null = null;
  function paintStarters(hasFolder: boolean): void {
    void paintContinue();
    if (startersFor === hasFolder) return;
    startersFor = hasFolder;
    quickActions.replaceChildren(continueAction);
    for (const [index, starter] of (hasFolder ? projectStarters : ideaStarters).entries()) {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "chat-quick-action";
      // Their place in the row, for the arrival stagger in motion.css.
      action.style.setProperty("--i", String(index + 1));
      action.textContent = starter.label;
      const hint = document.createElement("small");
      hint.textContent = starter.hint;
      action.append(hint);
      action.addEventListener("click", () => {
        if (starter.run) { starter.run(); return; }
        input.value = starter.prompt ?? "";
        autogrowComposer();
        input.focus();
        if (!input.value.endsWith(": ")) submit();
      });
      quickActions.append(action);
    }
  }
  paintSetup();
  welcome.append(welcomeTitle, welcomeText, setupSteps);
  const refreshWelcome = (): void => {
    const empty = transcript.childElementCount === 0;
    if (empty) {
      paintGreeting();
      void paintContinue();
    }
    welcome.hidden = !empty;
    quickActions.hidden = !empty;
    conversation.dataset["empty"] = String(empty);
    // A cleared transcript has nothing below to jump to. Without this the pill kept its
    // "Jump to latest · 7 new" from the last conversation over a brand-new, empty one.
    if (empty) {
      pendingUnread = 0;
      stickToBottom = true;
    }
    updateScrollButton();
  };
  new MutationObserver(refreshWelcome).observe(transcript, { childList: true });
  // Floating "go to bottom" pill, anchored to the conversation above the
  // composer. Hidden while the user is already at the tail; appears with an
  // unread count when streamed content arrives while scrolled up.
  scrollButton = document.createElement("button");
  scrollButton.type = "button";
  scrollButton.className = "chat-scroll-bottom";
  scrollButton.hidden = true;
  scrollButton.setAttribute("aria-label", "Scroll to latest messages");
  const scrollArrow = document.createElement("span");
  scrollArrow.className = "chat-scroll-bottom-arrow";
  scrollArrow.textContent = "↓";
  scrollArrow.setAttribute("aria-hidden", "true");
  scrollButtonLabel = document.createElement("span");
  scrollButtonLabel.className = "chat-scroll-bottom-label";
  scrollButtonLabel.textContent = "Jump to latest";
  const scrollDot = document.createElement("span");
  scrollDot.className = "chat-scroll-bottom-mascot";
  scrollDot.setAttribute("aria-hidden", "true");
  scrollButton.append(scrollDot, scrollButtonLabel, scrollArrow);
  scrollButton.addEventListener("click", () => {
    scrollToEnd(true);
    input.focus({ preventScroll: true });
  });
  transcript.addEventListener("scroll", () => updateScrollButton(), { passive: true });
  conversation.append(memory, connectBanner, folderBanner, welcome, transcript, scrollButton, composer, quickActions);
  refreshWelcome();
  const working = document.createElement("div");
  working.className = "chat-working";
  working.hidden = true;
  working.setAttribute("role", "status");
  const workingText = document.createElement("span");
  workingText.className = "chat-working-text";
  workingText.textContent = "Thinking";
  working.append(workingText);

  const inspector = document.createElement("aside");
  inspector.className = "chat-inspector";
  inspector.id = "chat-inspector-panel";
  inspector.setAttribute("aria-label", "AI task inspector");
  const inspectorHeading = document.createElement("h2");
  inspectorHeading.className = "chat-section-heading";
  inspectorHeading.textContent = "Team, schedules and activity";
  inspector.append(inspectorHeading, teamPanel, automationPanel);
  const inspectorListeners: ((open: boolean) => void)[] = [];
  const busyListeners: ((busy: boolean) => void)[] = [];
  let announcedInspector = false;

  const body = document.createElement("div");
  body.className = "chat-body";
  // The inspector is not part of the chat's own layout: the host floats it (see `inspector`).
  body.append(history, conversation);
  card.append(header, body);

  // History floats over the conversation instead of squeezing it, so an open
  // list dims what is behind it. One click on the dimming returns to the
  // conversation - the same dismissal a popup offers.
  const scrim = document.createElement("div");
  scrim.className = "chat-scrim";
  scrim.hidden = true;
  scrim.setAttribute("aria-hidden", "true");
  scrim.addEventListener("click", () => {
    historyOpen = false;
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
    // Never true: the inspector lives in the host's floating panel, not the chat's grid.
    card.dataset["inspectorOpen"] = "false";
    history.hidden = !externalHistory && !historyOpen;
    inspector.hidden = false;
    scrim.hidden = !(historyOpen && !externalHistory);
    historyButton.setAttribute("aria-expanded", String(historyOpen));
    inspectorButton.setAttribute("aria-expanded", String(inspectorOpen));
    if (announcedInspector !== inspectorOpen) {
      announcedInspector = inspectorOpen;
      for (const listener of inspectorListeners) listener(inspectorOpen);
    }
    updateLayout();
  }

  function toggleInspector(): void {
    inspectorOpen = !inspectorOpen;
    applyDisclosures();
  }

  function revealInspector(): void {
    inspectorOpen = true;
    applyDisclosures();
  }

  applyDisclosures();

  window.adcode.chat.onChanged((session) => renderMemory(session));
  void window.adcode.chat.current().then((session) => renderMemory(session));

  /* ── Rendering ────────────────────────────────────────────────────────── */

  function scrollToEnd(force = false): void {
    if (!working.hidden && transcript.lastElementChild !== working) transcript.append(working);
    if (!force && !stickToBottom) {
      pendingUnread += 1;
      updateScrollButton();
      return;
    }
    pendingUnread = 0;
    stickToBottom = true;
    transcript.scrollTop = transcript.scrollHeight;
    updateScrollButton();
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

  /*
   * A turn reads in the order it happened, as in Claude: a block of work, the text it led
   * to, the next block of work, more text. A block is one unbroken run of tool calls. Text
   * closes it - collapsed to "Worked for Ns" - and the next tool call opens a new block
   * below that text. (One block per turn, kept above the newest text, used to pile every
   * step of a long turn at the top with the words stacked underneath.)
   */
  function ensureActivity(): ActivityBlockHandle {
    if (activeActivity !== null) return activeActivity;
    // The activity block is the turn's status line — the legacy dot-pulse
    // working row would read as a second, competing "Thinking" underneath it.
    working.hidden = true;
    working.remove();
    const block = createActivityBlock({ label: "Thinking" });
    transcript.append(block.element);
    activeActivity = block;
    scrollToEnd();
    return block;
  }

  /** Text is starting: the work before it is done. A "Thinking" placeholder with no steps just goes. */
  function closeActivitySegment(): void {
    if (activeActivity === null) return;
    if (activityToolRows.size === 0) {
      activeActivity.destroy();
      activeActivity = null;
      return;
    }
    finishActivity();
  }

  function finishActivity(label?: string): void {
    if (activeActivity === null) return;
    // A block with no steps in it has nothing to report: "Worked for 3s" over an empty box
    // is noise, and it used to leave a second mascot behind. A failure keeps its block.
    if (label === undefined && activityToolRows.size === 0) {
      activeActivity.destroy();
      activeActivity = null;
      return;
    }
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
  /*
   * What was typed before a model was connected. It is sent the moment one is, so
   * connecting is the last step rather than the start of a new one.
   */
  let waitingForModel: string | null = null;
  let nudgeConnect: QuickConnect | null = null;
  /** Set when making a project for a message failed, so the retry sends instead of looping. */
  let skipProjectOnce = false;
  /** Set while a send re-asks whether a model is ready, so it asks once and not forever. */
  let readyRechecked = false;

  /**
   * The answer to a prompt sent with no model: the ways to connect one, right here.
   *
   * It used to be a sentence and a button to the full Connect screen - fourteen providers,
   * every one marked "needs a key". This is the quick panel instead, led by a free key,
   * and the prompt goes as soon as something answers.
   */
  function connectNudge(pending: string | null = null): void {
    if (pending !== null) waitingForModel = pending;
    const last = transcript.lastElementChild;
    if (last instanceof HTMLElement && last.dataset["nudge"] === "connect") {
      nudgeConnect?.refresh();
      scrollToEnd();
      return;
    }
    nudgeConnect?.dispose();
    const element = bubble(
      "assistant",
      pending === null
        ? "I need an AI model to work with. The free option takes about a minute and needs no card:"
        : "Ready when you are - I just need an AI model first. The free option takes about a minute and needs no card. Your message is waiting below and sends itself once one is connected.",
    );
    element.dataset["nudge"] = "connect";
    nudgeConnect = createQuickConnect({
      compact: true,
      openAllProviders: () => deps.openConnect(),
      // The refresh sends a waiting message itself, if the person has not since changed it.
      onConnected: () => {
        void refreshModelStatus().then(() => input.focus());
      },
    });
    element.append(nudgeConnect.element);
    window.adcode.milestones.record("ai_needed");
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
    choice("Custom…", "Set any cap from 1,000 to 10,000,000 tokens", () => {
      const prompt = deps.promptText ?? deps.askForName;
      void prompt("Custom token budget", "Tokens per task, 1000 to 10000000. Empty clears the custom value.", "").then(
        (raw) => {
          if (raw === null) return;
          const cleaned = raw.trim().replace(/[,_\s]/g, "");
          if (cleaned.length === 0) {
            void window.adcode.settings.write("adcode.ai.taskTokenBudgetCustom", "").then(
              () => void window.adcode.ai.send("Continue where you left off."),
              () => undefined,
            );
            return;
          }
          if (!/^\d{4,8}$/.test(cleaned) || Number(cleaned) < 1000 || Number(cleaned) > 10_000_000) {
            bubble("assistant", "That custom budget needs to be a number from 1000 to 10000000.");
            return;
          }
          void window.adcode.settings.write("adcode.ai.taskTokenBudgetCustom", cleaned).then(
            () => void window.adcode.ai.send("Continue where you left off."),
            () => undefined,
          );
        },
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

  /** Relative time for a message ("just now", "3m ago"), full date on hover. */
  function formatMessageTime(at: number, now: number = Date.now()): { text: string; title: string } {
    const date = new Date(at);
    const title = date.toLocaleString([], {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      day: "numeric",
      month: "short",
    });
    const ageSeconds = Math.max(0, Math.floor((now - at) / 1000));
    if (ageSeconds < 45) return { text: "just now", title };
    if (ageSeconds < 90) return { text: "1m ago", title };
    const minutes = Math.floor(ageSeconds / 60);
    if (minutes < 60) return { text: `${String(minutes)}m ago`, title };
    const hours = Math.floor(minutes / 60);
    if (hours < 24 && date.toDateString() === new Date(now).toDateString()) {
      return { text: `${String(hours)}h ago`, title };
    }
    return {
      text: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      title,
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
    // New messages rise in; a reopened conversation's hundred messages do not.
    if (!restoring) markFor(element, "enter", "true", 700);
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
    scrollToEnd(role === "user");
    return element;
  }

  /** Copy the stored source so code blocks copy exactly, with timed feedback. */
  function wireCopyButton(copy: HTMLButtonElement, bubbleElement: HTMLElement, label: string): void {
    copy.addEventListener("click", () => {
      const source = messageSources.get(bubbleElement) ?? "";
      copy.disabled = true;
      const hasIcon = copy.querySelector("svg") !== null;
      const originalTitle = copy.title;
      const done = (ok: boolean): void => {
        if (hasIcon) {
          // Icon buttons keep their ink; feedback lives in the tooltip.
          copy.title = ok ? "Copied" : "Copy failed";
          copy.setAttribute("aria-label", ok ? "Copied" : "Copy failed");
          copy.dataset["copied"] = ok ? "true" : "false";
          window.setTimeout(() => {
            copy.title = originalTitle;
            copy.setAttribute("aria-label", originalTitle);
            delete copy.dataset["copied"];
            copy.disabled = false;
          }, 1400);
          return;
        }
        copy.textContent = ok ? "Copied" : "Failed";
        window.setTimeout(() => {
          copy.textContent = label;
          copy.disabled = false;
        }, 1400);
      };
      void copyText(source).then(done, () => done(false));
    });
  }

  /** Read a response aloud. A second press stops it. */
  function speakText(text: string, button: HTMLButtonElement): void {
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      if (synth.speaking) {
        synth.cancel();
        button.setAttribute("aria-pressed", "false");
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text.slice(0, 2000));
      utterance.onend = () => button.setAttribute("aria-pressed", "false");
      utterance.onerror = () => button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-pressed", "true");
      synth.speak(utterance);
    } catch {
      // Speech is a convenience; silence is acceptable.
    }
  }

  function iconActionButton(
    icon: string,
    label: string,
    title: string,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-message-action chat-message-icon";
    button.append(createIcon(icon));
    button.title = title;
    button.setAttribute("aria-label", label);
    return button;
  }

  /** Re-send a prompt, unless a turn is already running. */
  const KEEP_GOING_LIMIT = 5;
  let keptGoing = 0;
  /** Output-limit stops since a turn last finished: a second one means Continue is not helping. */
  let outputLimitStops = 0;
  /**
   * Send once the turn that just ended has fully returned. The step-limit error arrives
   * while main is still finishing that turn, and a send in that moment is refused.
   */
  function continueWhenIdle(prompt: string, attempts = 12): void {
    setSendMode("stop");
    streamingBubble = null;
    void window.adcode.ai.send(prompt, undefined, currentEditorContext()).then((ok) => {
      if (!ok) setSendMode("send");
    }, (error: unknown) => {
      if (attempts > 0 && /already handling/i.test(String(error))) {
        window.setTimeout(() => continueWhenIdle(prompt, attempts - 1), 400);
        return;
      }
      setSendMode("send");
    });
  }

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
   * A failed turn says why, where the user is looking.
   *
   * It used to collapse to "Failed after 34s" with the reason only in the inspector's
   * trace, so a rate limit, a rejected key and a broken tool call all looked the same:
   * like the assistant simply not working. The card names the problem, says what to do,
   * offers those actions as buttons, and keeps the provider's exact words one click away.
   */
  function failureCard(detail: string): void {
    const failure = describeAiFailure(detail);
    const last = transcript.lastElementChild;
    if (last instanceof HTMLElement && last.dataset["failureDetail"] === failure.detail) {
      scrollToEnd(true);
      return;
    }
    const card = document.createElement("section");
    card.className = "chat-failure";
    card.dataset["failure"] = failure.kind;
    card.dataset["failureDetail"] = failure.detail;
    card.setAttribute("role", "alert");

    const icon = document.createElement("span");
    icon.className = "chat-failure-icon";
    icon.textContent = "!";
    icon.setAttribute("aria-hidden", "true");

    const body = document.createElement("div");
    body.className = "chat-failure-body";
    const heading = document.createElement("h3");
    heading.className = "chat-failure-title";
    heading.textContent = failure.title;
    const text = document.createElement("p");
    text.className = "chat-failure-text";
    text.textContent = failure.explanation;

    const actions = document.createElement("div");
    actions.className = "chat-failure-actions";
    const action = (label: string, run: () => void, primary = false): HTMLButtonElement => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `chat-failure-button${primary ? " is-primary" : ""}`;
      button.textContent = label;
      button.addEventListener("click", run);
      actions.append(button);
      return button;
    };
    failure.actions.forEach((kind, index) => {
      const primary = index === 0;
      if (kind === "retry") {
        const retry = action("Try again", () => { if (resend(lastUserPrompt)) retry.disabled = true; }, primary);
        retry.disabled = lastUserPrompt.trim().length === 0;
      } else if (kind === "models") {
        action("Switch model", () => deps.openConnect(), primary);
      } else if (kind === "new-conversation") {
        // A fresh conversation carries no history, which is the fix; the request comes along.
        action("Start fresh with this request", () => {
          const request = lastUserPrompt;
          api.newConversation();
          input.value = request;
          autogrowComposer();
        }, primary);
      } else if (kind === "report") {
        action("Report problem", () => reportFailure(failure.title, failure.detail), primary);
      }
    });
    if (!failure.actions.includes("report") && deps.reportProblem !== undefined) {
      action("Report problem", () => reportFailure(failure.title, failure.detail));
    }

    const details = document.createElement("details");
    details.className = "chat-failure-detail";
    const summary = document.createElement("summary");
    summary.textContent = "Details";
    const code = document.createElement("code");
    code.textContent = failure.detail;
    details.append(summary, code);

    body.append(heading, text, actions, details);
    card.append(icon, body);
    transcript.append(card);
    scrollToEnd(true);
  }

  function reportFailure(title: string, detail: string): void {
    deps.reportProblem?.({
      title: `Assistant: ${title}`.slice(0, 120),
      body: `What I asked for:\n\nWhat happened: ${detail.slice(0, 600)}`,
    });
  }

  /*
   * A stopped turn ends with a way forward, not a bare trace line: the
   * Claude-style interrupted banner with Edit prompt and Try again. Deduped
   * so repeated stops cannot stack the same card.
   */
  function interruptedBanner(): void {
    const last = transcript.lastElementChild;
    if (last instanceof HTMLElement && last.dataset["interrupted"] === "true") {
      scrollToEnd(true);
      return;
    }
    const banner = document.createElement("div");
    banner.className = "chat-interrupted";
    banner.dataset["interrupted"] = "true";
    banner.setAttribute("role", "status");

    const info = document.createElement("span");
    info.className = "chat-interrupted-icon";
    info.textContent = "i";
    info.setAttribute("aria-hidden", "true");

    const text = document.createElement("span");
    text.className = "chat-interrupted-text";
    text.textContent = "Response was interrupted.";

    const editPrompt = document.createElement("button");
    editPrompt.type = "button";
    editPrompt.className = "chat-interrupted-button";
    editPrompt.textContent = "Edit prompt";
    editPrompt.title = "Edit your last message in the composer";
    editPrompt.addEventListener("click", () => {
      if (lastUserPrompt.trim().length > 0) {
        input.value = lastUserPrompt;
        autogrowComposer();
      }
      input.focus();
    });

    const tryAgain = document.createElement("button");
    tryAgain.type = "button";
    tryAgain.className = "chat-interrupted-button is-primary";
    tryAgain.textContent = "Try again";
    tryAgain.title = "Send the last message again";
    tryAgain.addEventListener("click", () => {
      if (resend(lastUserPrompt)) {
        banner.dataset["interrupted"] = "retried";
        tryAgain.disabled = true;
      }
    });

    banner.append(info, text, editPrompt, tryAgain);
    transcript.append(banner);
    scrollToEnd(true);
  }

  /*
   * Per-message action bar: Claude-style icon row under the message — copy,
   * read aloud, helpful / not helpful, retry — with relative time and a
   * single overflow menu kept for secondary acts. Hover-revealed on precise
   * pointers (CSS), always visible on touch.
   */
  function messageActions(bubbleElement: HTMLElement): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "chat-message-actions";
    bar.setAttribute("aria-label", "Response actions");
    bar.append(messageTime(Number(bubbleElement.dataset["at"] ?? Date.now())));

    const copy = iconActionButton(ICON.copy, "Copy response", "Copy response");
    wireCopyButton(copy, bubbleElement, "Copy response");

    const speaker = iconActionButton(ICON.speaker, "Read response aloud", "Read aloud");
    speaker.setAttribute("aria-pressed", "false");
    speaker.addEventListener("click", () => {
      speakText(messageSources.get(bubbleElement) ?? "", speaker);
    });

    const vote = (chosen: HTMLButtonElement, other: HTMLButtonElement): void => {
      const pressed = chosen.getAttribute("aria-pressed") === "true";
      chosen.setAttribute("aria-pressed", String(!pressed));
      other.setAttribute("aria-pressed", "false");
    };
    const good = iconActionButton(ICON.thumbUp, "Mark helpful", "Helpful (stored on this machine only)");
    good.setAttribute("aria-pressed", "false");
    const bad = iconActionButton(ICON.thumbDown, "Mark not helpful", "Not helpful (stored on this machine only)");
    bad.setAttribute("aria-pressed", "false");
    good.addEventListener("click", () => vote(good, bad));
    bad.addEventListener("click", () => vote(bad, good));

    const retry = iconActionButton(ICON.reload, "Retry last message", "Send the last message again");
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

    const menuItem = (label: string, pressed: boolean): HTMLButtonElement => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "chat-message-menu-item";
      item.textContent = label;
      item.setAttribute("role", "menuitem");
      item.setAttribute("aria-pressed", String(pressed));
      return item;
    };
    const goodMenu = menuItem("Mark helpful", false);
    goodMenu.title = "Helpful (stored on this machine only)";
    goodMenu.setAttribute("aria-label", "Mark helpful");
    const badMenu = menuItem("Mark not helpful", false);
    badMenu.title = "Not helpful (stored on this machine only)";
    badMenu.setAttribute("aria-label", "Mark not helpful");
    goodMenu.addEventListener("click", () => {
      vote(good, bad);
      vote(goodMenu, badMenu);
      closeOpenMenu();
    });
    badMenu.addEventListener("click", () => {
      vote(bad, good);
      vote(badMenu, goodMenu);
      closeOpenMenu();
    });
    menu.append(goodMenu, badMenu);
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

    bar.append(copy, speaker, good, bad, retry, wrap);
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

    const edit = iconActionButton(ICON.edit, "Edit message", "Edit this message in the composer");
    edit.addEventListener("click", () => {
      input.value = messageSources.get(bubbleElement) ?? text;
      input.focus();
      autogrowComposer();
    });

    const copy = iconActionButton(ICON.copy, "Copy message", "Copy message");
    wireCopyButton(copy, bubbleElement, "Copy message");

    const retry = iconActionButton(ICON.reload, "Resend message", "Send this message again");
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
  teamCancel.addEventListener("click", async () => {
    const team = activeTeam;
    if (team === null || !await askThemed({ title: "Cancel this Team?", body: "The Team stops, and its isolated proposals will not reach your project.", confirmLabel: "Cancel Team", cancelLabel: "Keep going", danger: true })) {
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
        run.addEventListener("click", async () => {
          if (!await askThemed({ title: "Run this missed message now?", body: "It was scheduled while ADCode was closed. Sending it now starts the assistant on it.", confirmLabel: "Run now" })) return;
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
    // Mid-turn a Review task is already "ready" after its first edit; offering it then
    // would show a card missing the rest of the turn. The turn's end offers it instead
    // (`offerStagedChanges`), and work that arrives outside a turn - a Team's combined
    // result - is offered here, once.
    if (task === null || turnActive) return;
    if (aiWorkspaceActions(task).review && !reviewShownFor.has(task.id)) {
      reviewShownFor.add(task.id);
      void renderPersistedReview(task).catch(() => undefined);
    }
  }

  /** When a turn ends: if it staged changes (Review mode), offer them - one card, with everything the turn did. */
  async function offerStagedChanges(since: number): Promise<void> {
    const task = await window.adcode.aiWorkspace.current().catch(() => null);
    if (task === null || !aiWorkspaceActions(task).review || task.updatedAt < since) return;
    activeWorkspaceTask = task;
    reviewShownFor.add(task.id);
    await renderPersistedReview(task).catch(() => undefined);
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
    // A new file is not in the project yet; opening it could only fail.
    if (!change.isNew) panel.append(openFile);
    else heading.textContent = `New file — ${change.path}`;

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
        .catch((error: unknown) => {
          heading.textContent = applyFailureMessage(error, `Could not apply ${change.path}`);
          // A task that is not applicable here stays that way; a live button would only
          // invite the same refusal again.
          if (isUnavailableTask(error)) actions.remove();
          else apply.disabled = false;
        });
    });
    actions.append(apply);
    panel.append(actions);
    return panel;
  }

  /**
   * The one place staged work is reviewed: what the task asked for, its line counts, the
   * ways forward, and each file's diff below. Rendering again replaces the card, so it
   * always shows the task as it is now.
   */
  async function renderPersistedReview(task: AiWorkspaceTaskView): Promise<void> {
    const changes = await window.adcode.aiWorkspace.changes(task.id);
    transcript.querySelectorAll(`[data-task-review="${task.id}"]`).forEach((node) => node.remove());
    const summary = document.createElement("section");
    summary.className = "task-review-summary";
    summary.dataset["taskReview"] = task.id;
    const title = document.createElement("h3");
    title.textContent = task.prompt;
    const state = document.createElement("p");
    state.setAttribute("role", "status");
    const hunks = changes.flatMap(change => change.hunks);
    state.textContent = `${summarizeAiWorkspaceTask(task)} · +${hunks.reduce((n, h) => n + h.replacement.length, 0)} −${hunks.reduce((n, h) => n + h.original.length, 0)}`;
    const actions = document.createElement("div");
    actions.className = "task-review-actions";
    const action = (label: string, run: () => void, primary = false): HTMLButtonElement => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = primary ? "chat-send" : "ghost-button";
      button.textContent = label;
      button.addEventListener("click", run);
      actions.append(button);
      return button;
    };
    const settle = (): void => {
      for (const button of transcript.querySelectorAll<HTMLButtonElement>(`[data-task-review="${task.id}"] .diff-actions button`)) button.disabled = true;
    };
    const applyAll = action("Apply all changes", () => {
      applyAll.disabled = true;
      // All means all: whatever the task holds now, not only what was listed when drawn.
      void window.adcode.aiWorkspace.changes(task.id).then(current =>
        window.adcode.aiWorkspace.apply(task.id, current.map(change => ({ path: change.path, acceptedHunkIds: change.hunks.map(h => h.id) })))
      ).then(result => {
        paintWorkspaceTask(result.task);
        state.textContent = result.message;
        paintActions(result.task);
        if (result.ok) settle();
        else applyAll.disabled = false;
      }).catch((error: unknown) => {
        state.textContent = applyFailureMessage(error, "Could not apply changes. Your project may have changed; review and retry.");
        applyAll.disabled = isUnavailableTask(error);
      });
    }, true);
    const discard = action("Discard", () => {
      void (async () => {
        if (!await askThemed({ title: "Discard these changes?", body: "The staged changes are thrown away. Your project files are not touched.", confirmLabel: "Discard", danger: true })) return;
        discard.disabled = true;
        try {
          const discarded = await window.adcode.aiWorkspace.discard(task.id);
          paintWorkspaceTask(discarded);
          state.textContent = discarded === null ? "This task is already gone." : "Discarded - your project files were not touched.";
          if (discarded !== null) paintActions(discarded);
          settle();
        } catch {
          state.textContent = "Could not discard these changes. Try again.";
        } finally {
          discard.disabled = false;
        }
      })();
    });
    const rollback = action("Roll back", () => {
      rollback.disabled = true;
      void window.adcode.aiWorkspace.rollback(task.id).then((result) => {
        paintWorkspaceTask(result.task);
        state.textContent = result.message;
        paintActions(result.task);
      }, () => {
        state.textContent = "Could not roll back this task. Try again.";
      }).finally(() => { rollback.disabled = false; });
    });
    if (deps.openPreview) action("Open preview", deps.openPreview);
    action("Work history", () => { void renderPersistedTrace(task).catch(() => { state.textContent = "Could not load work history. Try again."; }); });
    function paintActions(current: AiWorkspaceTaskView): void {
      const allowed = aiWorkspaceActions(current);
      applyAll.hidden = !allowed.review || changes.length === 0;
      discard.hidden = !allowed.discard;
      rollback.hidden = !allowed.rollback;
    }
    paintActions(task);
    summary.append(title, state, actions);
    transcript.append(summary);
    if (changes.length === 0) {
      state.textContent = `${summarizeAiWorkspaceTask(task)} · No pending file changes. Open work history for recorded commands and results.`;
      scrollToEnd();
      return;
    }
    for (const change of changes) transcript.append(persistedDiff(task, change));
    scrollToEnd();
  }

  async function renderPersistedTrace(task: AiWorkspaceTaskView): Promise<void> {
    const events = await window.adcode.aiWorkspace.traces(task.id);
    if (events.length === 0) {
      taskStatus("No operational trace events yet.");
      return;
    }
    // Long tool runs record a start and a finish per call. Pairing them keeps
    // the history readable, and the cap keeps a 40-step task to one screen.
    const grouped = groupWorkspaceTraces(events);
    const visible = grouped.slice(0, TRACE_PREVIEW_LIMIT);
    for (const row of visible) {
      trace(
        row.count > 1 ? `${row.summary} · ${traceTone(row.outcome) === "ok" ? "done" : row.outcome}` : row.summary,
        row.detail,
        traceTone(row.outcome),
      );
    }
    if (grouped.length > visible.length) {
      const remaining = grouped.length - visible.length;
      const more = bubble(
        "assistant",
        `${remaining} more step${remaining === 1 ? "" : "s"} recorded for this task.`,
      );
      const show = document.createElement("button");
      show.type = "button";
      show.className = "chat-send chat-nudge-action";
      show.textContent = `Show all ${grouped.length} steps`;
      show.addEventListener("click", () => {
        show.disabled = true;
        for (const row of grouped.slice(visible.length)) {
          trace(
            row.count > 1 ? `${row.summary} · ${traceTone(row.outcome) === "ok" ? "done" : row.outcome}` : row.summary,
            row.detail,
            traceTone(row.outcome),
          );
        }
        more.dataset["nudge"] = "trace-expanded";
      });
      more.append(show);
      scrollToEnd();
    }
  }

  window.adcode.aiWorkspace.onChanged((task) => {
    paintWorkspaceTask(task);
    void paintFolderBanner();
  });
  void refreshWorkspaceTask();
  void paintFolderBanner();

  /* ── Events from the agent ────────────────────────────────────────────── */

  function setSendMode(mode: "send" | "stop"): void {
    working.hidden = mode !== "stop";
    if (mode === "stop") {
      transcript.append(working);
      scrollToEnd();
    } else {
      working.remove();
    }
    const wasWorking = card.dataset["working"] === "true";
    card.dataset["working"] = String(mode === "stop");
    if (wasWorking !== (mode === "stop")) for (const listener of busyListeners) listener(mode === "stop");
    if (mode === "stop") workingText.textContent = "Thinking";
    sendButton.dataset["mode"] = mode;
    // Cursor-style stop: while a turn runs the button stops it, so it stays
    // enabled and wears a spinner ring (CSS) rather than going dead. Enter with
    // something typed queues it for when the turn finishes; with nothing, it stops.
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
    refreshStopTitle();
    paintWorkingStatus();
  }

  window.adcode.ai.onEvent((raw) => {
    const event = raw as { kind: string; [key: string]: unknown };
    // Flush before tool boundaries, cancellation, and completion so no final text
    // is stranded in a scheduled frame or attached to the next message.
    if (event.kind !== "text") flushStream();
    if (event.kind === "context") {
      const tokens = Number(event["tokens"]);
      const contextWindow = Number(event["contextWindow"]);
      if (lastUsage !== null && Number.isFinite(tokens) && Number.isFinite(contextWindow)) {
        lastUsage = { ...lastUsage, tokens, contextWindow };
        contextMeter.update(lastUsage);
      } else refreshContextMeter();
      return;
    }
    if (event.kind === "compacted") {
      const summary = String(event["summary"] ?? "");
      if (summary.trim().length > 0) currentSummary = summary;
      transcript.append(compactionDivider());
      scrollToEnd();
      // Compact now between turns is not a turn; one that happened mid-turn is part of it.
      if (!turnActive) return;
    }
    // Turns are followed from the events, which every window receives - a turn may have
    // started in the other window's chat, or from an automation, not from this composer.
    const ending = event.kind === "turn-end" || event.kind === "error" || event.kind === "cancelled" || event.kind === "refusal";
    if (!ending && !turnActive) {
      turnActive = true;
      turnStartedAt = Date.now();
      // A new turn gets its own plan and its own view, below its own question.
      planCard = null;
      viewCard = null;
    } else if (ending && turnActive) {
      turnActive = false;
      void offerStagedChanges(turnStartedAt);
    }

    switch (event.kind) {
      case "text": {
        workingText.textContent = "Writing response";
        // New text after work: that work is finished, and the text goes below it.
        if (streamingBubble === null) closeActivitySegment();
        // Append to the live bubble rather than creating one per delta. The
        // bubble streams with a blinking orange caret (CSS) until turn-end.
        streamingBubble ??= bubble("assistant", "");
        messageSources.set(streamingBubble, `${messageSources.get(streamingBubble) ?? ""}${String(event["text"])}`);
        dirtyMessages.add(streamingBubble);
        if (open && !document.hidden) streamPaint.schedule();
        break;
      }

      case "status": {
        // Host progress, not model reasoning: "Waiting 21s for Groq's rate limit" is
        // shown live, so a wait never reads as a hang.
        const text = String(event["text"] ?? "");
        workingText.textContent = text;
        ensureActivity().setLabel(text);
        break;
      }

      case "compacting": {
        workingText.textContent = "Compacting the conversation";
        ensureActivity().setLabel("Compacting the conversation");
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
        if (call.name === "update_plan") {
          const steps = planStepsFrom(call.input);
          if (steps.length > 0) {
            if (planCard === null) {
              planCard = createPlanCard();
              transcript.append(planCard.element);
            }
            planCard.update(steps);
          }
        }
        const label = toolHeaderLabel(call.name);
        workingText.textContent = label;
        const block = ensureActivity();
        block.setLabel(label);
        const detail = summarizeToolInput(call.input);
        const rowId = typeof call.id === "string" && call.id.length > 0 ? call.id : `${call.name}-${String(Date.now())}`;
        block.addRow({ kind: "tool", text: detail.length > 0 ? `${call.name} · ${detail}` : call.name, status: "running", id: rowId, detail });
        activityToolRows.set(rowId, true);
        // That bubble is finished: without this its streaming caret blinked forever.
        streamingBubble?.classList.remove("is-streaming");
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
            const result = JSON.parse(String(event["content"])) as { type?: string; status?: PreviewStatus; page?: string | null };
            if (result.type === "live-preview" && result.status) {
              const page = typeof result.page === "string" ? result.page : null;
              chatPreview.show(result.status, page);
              if (page !== null) deps.showPreviewPage?.(page);
            }
          } catch { /* A failed tool's text stays in the activity trace. */ }
        }
        // The page the assistant looked at, as it saw it.
        const pictures = Array.isArray(event["images"]) ? (event["images"] as { mediaType?: unknown; data?: unknown }[]) : [];
        const picture = pictures[0];
        if (event["name"] === "view_page" && picture !== undefined && typeof picture.data === "string" && (picture.mediaType === "image/jpeg" || picture.mediaType === "image/png")) {
          if (viewCard === null) {
            viewCard = createAgentViewCard(openPageInChat);
            transcript.append(viewCard.element);
          }
          viewCard.update({ image: `data:${picture.mediaType};base64,${picture.data}`, report: String(event["content"] ?? "") });
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
        // A capped task pauses: offer the ways forward as buttons.
        if (/token budget|token-limit/i.test(detail)) {
          trace("Error", detail, "error");
          budgetNudge();
          break;
        }
        // Unsaved files block file tools: name the way out as buttons.
        if (/isolated task begins/i.test(detail)) {
          trace("Error", detail, "error");
          draftNudge();
          break;
        }
        // A step or output limit stops the turn, not the work: offer to continue -
        // or, with Keep going until done on, continue without asking (five times at most).
        if (/step limit|response limit/i.test(detail)) {
          trace("Error", detail, "error");
          // A follow-up the person queued steers better than "continue": send it instead.
          if (/step limit/i.test(detail) && drainFollowUps()) break;
          if (keepGoing && /step limit/i.test(detail) && keptGoing < KEEP_GOING_LIMIT) {
            keptGoing += 1;
            modeNote(`Reached the step limit - keeping going (${keptGoing} of ${KEEP_GOING_LIMIT}).`);
            continueWhenIdle("Continue from where you stopped and finish the remaining steps.");
            break;
          }
          // The agent already continued a cut-off reply by itself, with more room each time.
          // Reaching the output limit again after a Continue means one more will not help:
          // say what will, instead of offering the same button again.
          if (/response limit/i.test(detail)) {
            outputLimitStops += 1;
            if (outputLimitStops >= 2) {
              failureCard(OUTPUT_LIMIT_AGAIN);
              break;
            }
          }
          continueNudge();
          break;
        }
        // Everything else says what went wrong, in the conversation, with the way out.
        failureCard(detail);
        break;
      }

      case "cancelled":
        streamingBubble = null;
        finishActivity();
        setSendMode("send");
        // Stopped to send a queued follow-up now: the follow-up is the way forward.
        if (sendAfterCancel !== null) {
          const item = sendAfterCancel;
          sendAfterCancel = null;
          window.setTimeout(() => sendQueued(item), 250);
          break;
        }
        interruptedBanner();
        break;

      case "turn-end": {
        outputLimitStops = 0;
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
        // A follow-up typed while this turn ran goes now.
        drainFollowUps();
        break;
      }
    }
  });

  /*
   * What an automatic-mode turn changed, with Undo.
   *
   * The safety net for "Apply automatically": the files the turn touched, each one a way
   * into the editor, and one button that puts them all back. Undo refuses to overwrite
   * edits the user made afterwards until they say so.
   */
  window.adcode.ai.onCheckpoint((checkpoint) => {
    const card = document.createElement("section");
    card.className = "chat-checkpoint";
    card.dataset["checkpointId"] = checkpoint.id;
    const icon = document.createElement("span");
    icon.className = "chat-checkpoint-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "✓";
    const body = document.createElement("div");
    body.className = "chat-checkpoint-body";
    const heading = document.createElement("strong");
    heading.className = "chat-checkpoint-title";
    const count = checkpoint.files.length;
    heading.textContent = count === 1 ? `Changed ${checkpoint.files[0]?.path ?? "1 file"}` : `Changed ${count} files`;
    const list = document.createElement("div");
    list.className = "chat-checkpoint-files";
    for (const file of checkpoint.files.slice(0, 8)) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "chat-checkpoint-file";
      if (file.deleted === true) {
        // Gone, so there is nothing to open - but Undo brings it back.
        open.textContent = `− ${file.path}`;
        open.title = `Deleted ${file.path} - Undo puts it back`;
        open.disabled = true;
        open.dataset["deleted"] = "true";
      } else {
        open.textContent = `${file.created ? "+ " : ""}${file.path}`;
        open.title = `${file.created ? "Created" : "Changed"} ${file.path} - open it`;
        open.addEventListener("click", () => deps.openExternalPath(file.path));
      }
      list.append(open);
    }
    if (count > 8) {
      const more = document.createElement("span");
      more.className = "chat-checkpoint-more";
      more.textContent = `+${count - 8} more`;
      list.append(more);
    }
    const status = document.createElement("p");
    status.className = "chat-checkpoint-status";
    status.setAttribute("role", "status");
    status.hidden = true;
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "chat-checkpoint-undo";
    undo.textContent = "Undo";
    undo.title = "Put these files back as they were before this turn";
    let force = false;
    undo.addEventListener("click", () => {
      undo.disabled = true;
      void window.adcode.ai.undoCheckpoint(checkpoint.id, force).then((result) => {
        status.hidden = false;
        status.textContent = result.message;
        if (result.ok) {
          card.dataset["state"] = "undone";
          undo.hidden = true;
          heading.textContent = count === 1 ? `Undid the change to ${checkpoint.files[0]?.path ?? "1 file"}` : `Undid changes to ${count} files`;
          return;
        }
        if (result.conflicts.length > 0) {
          force = true;
          undo.textContent = "Undo anyway";
          undo.title = `Overwrite your later edits to ${result.conflicts.join(", ")}`;
        }
        undo.disabled = false;
      }, () => {
        status.hidden = false;
        status.textContent = "Could not undo this turn. Try again.";
        undo.disabled = false;
      });
    });
    body.append(heading, list, status);
    card.append(icon, body, undo);
    transcript.append(card);
    scrollToEnd();
  });

  /* ── Sending ──────────────────────────────────────────────────────────── */

  /**
   * Send what the composer holds. `fromKey` is Enter: while a turn runs, Enter with something
   * typed queues it for when the turn finishes, and the button - a stop square - still stops.
   */
  function submit(fromKey = false): void {
    closeOpenMenu();
    // A person stepping in resets Keep going's count, whether to stop or to redirect.
    keptGoing = 0;
    if (sendButton.dataset["mode"] === "stop") {
      if (fromKey && (input.value.trim().length > 0 || pending.length > 0)) {
        if (followUps.add(input.value, pending) !== null) {
          input.value = "";
          autogrowComposer();
          pending = [];
          renderAttachments();
          refreshStopTitle();
        }
        return;
      }
      // Cursor-style stop: with nothing typed, the send key stops the running turn.
      window.adcode.ai.cancel();
      return;
    }
    const text = input.value;
    if (text.trim().length === 0 && pending.length === 0) return;

    // `/compact` and `/compact <what matters>` make room rather than asking anything.
    const compact = pending.length === 0 ? compactCommand(text) : null;
    if (compact !== null) {
      input.value = "";
      autogrowComposer();
      void compactNow(compact.focus);
      return;
    }

    // Explicitly not connected: printing the message into a turn that cannot
    // run answers nothing. Say the true thing instead — how to start — with a
    // button that does it. (Unknown status proceeds; the backend reports back.)
    if (modelLabel.dataset["ready"] === "false") {
      // The pill refreshes on a timer, so "not connected" can be a few seconds stale - the
      // welcome connects a model and sends the idea straight after. Ask once more first.
      if (!readyRechecked) {
        readyRechecked = true;
        void refreshModelStatus().finally(() => submit());
        return;
      }
      readyRechecked = false;
      // The message stays in the composer and goes by itself once a model answers.
      connectNudge(text.trim().length > 0 ? text : null);
      input.focus();
      return;
    }
    readyRechecked = false;

    /*
     * A build request with no folder open: make the project, then send. The person has an
     * idea, not a folder, and "open a project folder" was the step that stopped them.
     */
    if (!skipProjectOnce && currentFolderRoot === null && deps.createProjectFor !== undefined && pending.length === 0 && looksLikeBuildRequest(text)) {
      const idea = text;
      input.value = "";
      autogrowComposer();
      taskStatus("Making a project folder for this…");
      void deps.createProjectFor(idea).then(
        (created) => {
          input.value = created ? firstBuildPrompt(idea, true) : idea;
          autogrowComposer();
          // `created` false means no folder; send anyway, as a general question.
          if (!created) skipProjectOnce = true;
          submit();
        },
        () => {
          input.value = idea;
          skipProjectOnce = true;
          submit();
        },
      );
      return;
    }
    skipProjectOnce = false;

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
            // A send that returned false failed, whichever of this and the error event
            // arrives first - the block must never read "Worked for" after a failure.
            finishActivityFailed();
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
    // While the assistant works, Enter queues what was typed for when it finishes.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit(true);
    }
  });
  input.addEventListener("input", () => refreshStopTitle());

  /** The stop button says what Enter would do while a turn runs. */
  function refreshStopTitle(): void {
    if (sendButton.dataset["mode"] !== "stop") return;
    const typed = input.value.trim().length > 0 || pending.length > 0;
    sendButton.title = typed ? "Stop this turn - Enter queues your message for when it finishes" : "Stop this turn";
  }

  /** Send a queued follow-up as its own turn, retrying while the last turn finishes returning. */
  function sendQueued(item: QueuedMessage<PendingAttachment>, attempts = 12): void {
    const payload: AiAttachmentView[] = item.attachments.map((one) => ({ name: one.name, kind: one.kind, mediaType: one.mediaType, data: one.data }));
    const text = item.text.trim();
    if (attempts === 12) {
      bubble("user", text, payload);
      rememberSent(item.text);
      setSendMode("stop");
      streamingBubble = null;
      resetActivity();
      ensureActivity();
    }
    void window.adcode.ai.send(text, payload.length === 0 ? undefined : payload, currentEditorContext()).then(
      (ok) => {
        if (!ok) {
          finishActivityFailed();
          setSendMode("send");
        }
      },
      (error: unknown) => {
        if (attempts > 0 && /already handling/i.test(String(error))) {
          window.setTimeout(() => sendQueued(item, attempts - 1), 400);
          return;
        }
        finishActivityFailed();
        setSendMode("send");
      },
    );
  }

  /** The next queued follow-up, once the turn before it has finished well. */
  function drainFollowUps(): boolean {
    const next = followUps.next();
    if (next === undefined) return false;
    window.setTimeout(() => sendQueued(next), 250);
    return true;
  }

  /** Send now: stop the running turn, then send this one. */
  function sendFollowUpNow(id: number): void {
    const item = followUps.take(id);
    if (item === undefined) return;
    if (sendButton.dataset["mode"] === "stop") {
      sendAfterCancel = item;
      window.adcode.ai.cancel();
      return;
    }
    sendQueued(item);
  }

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
    busy: () => ({ busy: card.dataset["working"] === "true", title: conversationTitle.textContent ?? "" }),
    onBusyChange(listener): void {
      busyListeners.push(listener);
    },
    inspector: {
      element: inspector,
      onToggle(listener): void {
        inspectorListeners.push(listener);
      },
      close(): void {
        if (!inspectorOpen) return;
        inspectorOpen = false;
        applyDisclosures();
      },
    },
    draft(question): void {
      api.open();
      input.value = [input.value.trim(), question.trim()].filter(Boolean).join("\n\n");
      autogrowComposer();
      input.focus();
    },
    reviewTask(task): void {
      api.open();
      // Changes waiting to apply go straight to their card; anything else opens its details.
      const waiting = aiWorkspaceActions(task).review;
      if (waiting) reviewShownFor.add(task.id);
      paintWorkspaceTask(task);
      if (waiting) {
        void renderPersistedReview(task).then(() => scrollToEnd(true), () => taskStatus("Could not load these changes. Try again."));
        return;
      }
      detailsDialog.open(task);
    },
    openTasksPopup(): void {
      openTasksPopup();
    },

    setDocked(next, historyHost): void {
      docked = next;
      externalHistory = next && !!historyHost;
      card.dataset["docked"] = String(next);
      presentationButton.textContent = next ? "↗" : "Float";
      presentationButton.title = next ? "Expand assistant workspace" : "Return the assistant to its floating panel";
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
      void paintFolderBanner();
      void refreshTeam();
      if (!automationPanel.hidden) void refreshAutomations();

    },

    hidden(): void {
      if (!open) return;
      open = false;
      if (statusTimer !== null) window.clearInterval(statusTimer);
      statusTimer = null;
      announce();
    },

    newConversation(): void {
      api.open();
      resetButton.click();
      requestAnimationFrame(() => requestAnimationFrame(() => input.focus()));
    },

    openTeamSetup(): void {
      runChatWidgetIntent("team", {
        open: () => api.open(),
        showTeam: () => {
          revealInspector();
          void suggestForComposer(true);
        },
        showSchedule: showScheduleComposer,
      });
    },

    compactConversation(focus?: string): void {
      api.open();
      void compactNow(focus);
    },

    viewConversationSummary(): void {
      api.open();
      viewSummary();
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
      detailsDialog.close();
      tasksPopup.close();
      reviewShownFor.clear();
      currentFolderRoot = root;
      paintFolderBanner();
      paintSetup();
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
