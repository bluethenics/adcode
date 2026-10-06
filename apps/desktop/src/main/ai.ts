/**
 * The built-in agent, wired to the IDE.
 *
 * Brief §5.2: "an in-process agent loop with BYO API keys for Anthropic, OpenAI, Google,
 * and a local endpoint... The provider is a runtime choice, not a build-time one." The
 * provider is rebuilt on every send from the current setting and the stored key, so
 * switching models mid-conversation works without a restart.
 *
 * §9 governs failure here as it does for ads: "AI provider down or rate-limited - Chat
 * and completion degrade silently. Editing, terminal, and memory reads are unaffected."
 * Nothing in this file throws into the window.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { app, BrowserWindow } from "electron";
import {
  parseConnections,
  RequestScheduler,
  BUILT_IN_TOOLS,
  BUNDLED_CATALOGUE,
  DEFAULT_ANTHROPIC_MODEL,
  SNAPSHOT_TAKEN_ON,
  TOOLS_WITHOUT_MEMORY,
  AGENT_RUN_TOOLS,
  baseUrlFor,
  buildInlineEditRequest,
  cleanInlineEditAnswer,
  computeHunks,
  createAgent,
  createAnthropicProvider,
  createFileChange,
  createGoogleProvider,
  createOpenAiCompatibleProvider,
  createTeamHandoff,
  filterToolsByAccess,
  mergeCatalogue,
  normalizeInlineCompletion,
  parseCatalogue,
  providerIn,
  recommendedModel,
  suggestTeam,
  traitsOf,
  transportFor,
  usableCatalogue,
  type Agent,
  type AiFileChange,
  type AiWorkspaceTask,
  titleFor,
  withMessage,
  withSummary,
  summaryCoverage,
  restoreHistory,
  estimateTokens,
  type AgentCompaction,
  type CatalogueProvider,
  type ChatSession,
  type ImageBlock,
  type ImageMediaType,
  type Provider,
} from "@adcode/ai";
import {
  CHANNELS,
  type AiAttachmentView,
  type AiCompactResultView,
  type AiContextUsageView,
  type AiKeyCheck,
  type AiQuickConnectResult,
  type AiWorkspaceActionView,
  type AiWorkspaceApplySelectionView,
  type AiWorkspaceChangeView,
  type AiModelInfo as AiModelInfoView,
  type AiProviderInfo,
  type AiStatus,
  type AiWorkspaceTaskView,
  type AiWorkspaceTraceView,
  type AiTeamSuggestionInputView,
  type AiTeamSuggestionView,
  type AiTeamTraceView,
  type AiTeamView,
  type AiAutomationCreateInputView,
  type AiAutomationView,
  type AiCompletionInputView,
  type AiInlineEditInputView,
  type AiInlineEditResultView,
  type AiEditorContextView,
  type ProposedEditView,
} from "../shared/api.ts";
import { recordAgentEdit } from "./activity.ts";
import { recordMilestone } from "./milestones.ts";
import { createKeychainStore } from "./keychain.ts";
import { createAiToolRunner } from "./aiTools.ts";
import { resolveSandboxPath } from "./aiSandbox.ts";
import { createCheckpointStore, type UndoResult } from "./aiCheckpoints.ts";
import { ASSISTANT_EXTENSION_TOOLS, withAssistantExtensions } from "./assistantControls.ts";
import { memoryForWorkspace } from "./memory.ts";
import { currentSettings, writeSetting } from "./settings.ts";
import { describeDebugContext, recordDebug } from "./debugLog.ts";
import { currentWorkspace } from "./workspace.ts";
import { aiWorkspaceContext } from "./aiWorkspaceContext.ts";
import { aiPreviewUrl, describePreviewForAi, openAiPreview } from "./aiPreview.ts";
import { createCommandRunner } from "./aiCommands.ts";
import { closeAgentBrowser, viewPage } from "./agentBrowser.ts";
import { clearSessions, deleteSession, readSessions, writeSession } from "./aiSessions.ts";
import { createAiWorkspaceService, type AiWorkspaceService } from "./aiWorkspaceService.ts";
import { agentEventTrace, describeActivity } from "./aiEventTrace.ts";
import { createSlotPool } from "./slotPool.ts";
import { createStuckDetector } from "./stuckDetector.ts";
import { compactThreshold, contextWindowFor, keptUserTurns, parseCompactFocus } from "./chatCompaction.ts";
import { checksFromTraces, holdReason, riskFlags } from "../shared/runEvidence.ts";
import { normalizeForCompare } from "./pathSafety.ts";
import { recoverableDrafts } from "./history.ts";
import { workspaceHasUnsavedDraft, summarizeUnsavedDrafts } from "./aiWorkspaceDrafts.ts";
import {
  toAiWorkspaceActionView,
  toAiWorkspaceChangeViews,
  toAiWorkspaceTaskView,
  toAiWorkspaceTraceView,
} from "./aiWorkspaceViews.ts";
import {
  createAiTeamCoordinator,
  createBudgetedTeamProvider,
  roleHandoffChangedPaths,
  type AiTeamCoordinator,
  type AiTeamNodeRunner,
} from "./aiTeamCoordinator.ts";
import { createAiTeamService, type AiTeamService } from "./aiTeamService.ts";
import type { AiTeamRecord } from "./aiTeamStore.ts";
import type { ParsedAiTeamConfigure } from "./aiTeamIpcValidation.ts";
import { toAiTeamActivityView, toAiTeamTraceView, toAiTeamView } from "./aiTeamViews.ts";
import { createAiAutomationService, type AiAutomationService } from "./aiAutomationService.ts";
import { toAiAutomationView } from "./aiAutomationViews.ts";
import { askOllama, localModels, startOllama } from "./localModels.ts";
import { preferredOllamaModel } from "../shared/quickConnect.ts";

const keys = createKeychainStore();
const requestScheduler = new RequestScheduler();
function connections() { try { return parseConnections(currentSettings()["adcode.ai.connections"] ?? "[]"); } catch { return []; } }

/**
 * The providers that need no key.
 *
 * Only the local one: it talks to a model on the user's own machine, and asking for a
 * credential to reach `127.0.0.1` would be theatre.
 */
const KEYLESS = new Set(["ollama"]);

/**
 * The catalogue, live where a fetch has succeeded and bundled otherwise.
 *
 * Fetched once per run, in the background, and never waited on: the connection screen is
 * fully usable from the snapshot, and a network that is down should cost freshness rather
 * than the feature.
 */
let catalogue: readonly CatalogueProvider[] = BUNDLED_CATALOGUE;
let catalogueIsLive = false;

export async function refreshCatalogue(): Promise<void> {
  try {
    const response = await fetch("https://models.dev/api.json", {
      // Five megabytes: eight seconds was not enough on an ordinary connection, so most
      // launches silently kept the bundled list. It runs in the background either way.
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) return;

    // Cut by the same rules as the bundled snapshot: reachable providers, models that can
    // hold a conversation with tools. The raw list held Azure, Bedrock and every embedding
    // model upstream sells, and each failed the moment it was picked.
    const live = usableCatalogue(parseCatalogue(await response.json()));
    if (live.length === 0) return;

    catalogue = mergeCatalogue(BUNDLED_CATALOGUE, live);
    catalogueIsLive = true;
  } catch {
    // The snapshot is already loaded. Nothing to say.
  }
}

/** Where a provider's API lives: the catalogue's address, or the user's own. */
function baseUrlOf(providerId: string): string | null {
  const connection = connections().find(item => item.id === providerId);
  if (connection) return connection.baseUrl;
  if (providerId === "custom") {
    const custom = currentSettings()["adcode.ai.customBaseUrl"];
    const trimmed = typeof custom === "string" ? custom.trim().replace(/\/+$/, "") : "";
    return trimmed.length === 0 ? null : trimmed;
  }

  return baseUrlFor(providerId);
}

let activeTaskId: string | null = null;
/** The request that started the current review task, used as its title. */
let currentTaskPrompt: string | null = null;
/** Task states a review-mode turn keeps adding to rather than starting afresh. */
const REUSABLE_TASK_STATES: ReadonlySet<string> = new Set(["ready", "running", "paused", "review", "conflict"]);
/** Undo for "Apply automatically": one checkpoint per turn that wrote files. */
const checkpoints = createCheckpointStore({
  directory: () => join(app.getPath("userData"), "ai-checkpoints"),
  resolve: resolveSandboxPath,
});
let taskService: AiWorkspaceService | null = null;
let taskRecovery: Promise<void> | null = null;
let taskWorkspaceUnavailableReason: string | null = null;
let teamService: AiTeamService | null = null;
let teamCoordinator: AiTeamCoordinator | null = null;
let teamRecovery: Promise<void> | null = null;
let automationService: AiAutomationService | null = null;
let automationRecovery: Promise<void> | null = null;
let sendInFlight = false;
let completionInFlight: { readonly id: number; readonly controller: AbortController } | null = null;
/**
 * One-shot escape hatch from the chat's "Answer anyway": the user accepted a
 * possibly stale file snapshot for the next provider round-trip rather than
 * saving first. Consumed by beforeRequest, never persisted.
 */
let bypassWorkspaceBlockOnce = false;

function aiWorkspaceService(): AiWorkspaceService {
  if (taskService === null) {
    taskService = createAiWorkspaceService({
      userDataDirectory: app.getPath("userData"),
      storagePolicy: configuredStoragePolicy,
    });
    // Recovery changes state only. It never resumes a model, command, or terminal action.
    taskRecovery = taskService.recoverActive().then(() => undefined);
  }
  return taskService;
}

async function readyAiWorkspaceService(): Promise<AiWorkspaceService> {
  const service = aiWorkspaceService();
  await taskRecovery;
  return service;
}

/**
 * What each running agent is doing right now, per run: the Agents board's status lines.
 * In memory only - it is a live readout, not history, and the traces already keep history.
 */
const teamActivity = new Map<string, Record<string, { text: string; at: number }>>();
const activityTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Enough to feel live without a broadcast per tool call. */
const ACTIVITY_BROADCAST_MS = 250;

/** Paths each live run has edited, for collision warnings between parallel agents. */
const teamTouched = new Map<string, Set<string>>();
/** Why a finished run was held for review instead of applied automatically. */
const teamHolds = new Map<string, string>();

function noteTeamTouched(teamId: string, path: string): void {
  const paths = teamTouched.get(teamId) ?? new Set<string>();
  if (paths.has(path) || paths.size >= 200) return;
  paths.add(path);
  teamTouched.set(teamId, paths);
}

function teamView(team: AiTeamRecord): AiTeamView {
  return toAiTeamView(team, {
    activity: teamActivity.get(team.id) ?? {},
    hold: teamHolds.get(team.id) ?? null,
    touchedPaths: [...(teamTouched.get(team.id) ?? [])],
  });
}

function noteTeamActivity(teamId: string, nodeId: string, text: string): void {
  teamActivity.set(teamId, { ...(teamActivity.get(teamId) ?? {}), [nodeId]: { text, at: Date.now() } });
  if (activityTimers.has(teamId)) return;
  activityTimers.set(teamId, setTimeout(() => {
    activityTimers.delete(teamId);
    void readyAiTeamService()
      .then((service) => service.read(teamId))
      .then((team) => { if (team !== null) broadcast(CHANNELS.aiTeamChanged, teamView(team)); })
      .catch(() => undefined);
  }, ACTIVITY_BROADCAST_MS));
}

function aiTeamService(): AiTeamService {
  if (teamService === null) {
    teamService = createAiTeamService({
      userDataDirectory: app.getPath("userData"),
      workspaceService: aiWorkspaceService(),
      onChanged: (team) => broadcast(CHANNELS.aiTeamChanged, teamView(team)),
    });
    teamRecovery = teamService.recoverActive().then(() => undefined);
  }
  return teamService;
}

async function readyAiTeamService(): Promise<AiTeamService> {
  const service = aiTeamService();
  await teamRecovery;
  return service;
}

function aiAutomationService(): AiAutomationService {
  if (automationService === null) {
    automationService = createAiAutomationService({ userDataDirectory: app.getPath("userData") });
    automationRecovery = automationService.recover();
  }
  return automationService;
}

async function readyAiAutomationService(): Promise<AiAutomationService> {
  const service = aiAutomationService();
  await automationRecovery;
  return service;
}

function announceAutomation(item: Parameters<typeof toAiAutomationView>[0]): AiAutomationView {
  const view = toAiAutomationView(item);
  broadcast(CHANNELS.aiAutomationChanged, view);
  return view;
}

function automationWorkspaceRoot(): string {
  const root = currentWorkspace()?.root;
  if (root === undefined) throw new Error("Open a folder before scheduling an AI message");
  return root;
}

export async function aiAutomationCreate(input: AiAutomationCreateInputView): Promise<AiAutomationView> {
  const item = await (await readyAiAutomationService()).create(automationWorkspaceRoot(), input);
  return announceAutomation(item);
}

export async function aiAutomationList(): Promise<AiAutomationView[]> {
  const root = currentWorkspace()?.root;
  if (root === undefined) return [];
  return (await (await readyAiAutomationService()).list(root)).map(toAiAutomationView);
}

export async function aiAutomationClaimDue(): Promise<AiAutomationView | null> {
  const root = currentWorkspace()?.root;
  const service = await readyAiAutomationService();
  if (root === undefined) {
    await service.missInactive(null);
    return null;
  }
  const item = await service.claimDue(root);
  return item === null ? null : announceAutomation(item);
}

export async function aiAutomationComplete(id: string): Promise<AiAutomationView> {
  return announceAutomation(
    await (await readyAiAutomationService()).complete(automationWorkspaceRoot(), id),
  );
}

export async function aiAutomationMiss(id: string, reason: string): Promise<AiAutomationView> {
  return announceAutomation(
    await (await readyAiAutomationService()).miss(automationWorkspaceRoot(), id, reason),
  );
}

export async function aiAutomationRetry(
  id: string,
  reason: string,
  dueAt: number,
): Promise<AiAutomationView> {
  return announceAutomation(
    await (await readyAiAutomationService()).retry(automationWorkspaceRoot(), id, reason, dueAt),
  );
}

export async function aiAutomationCancel(id: string): Promise<AiAutomationView> {
  return announceAutomation(
    await (await readyAiAutomationService()).cancel(automationWorkspaceRoot(), id),
  );
}

export async function aiAutomationConfirmMissed(id: string): Promise<AiAutomationView> {
  return announceAutomation(
    await (await readyAiAutomationService()).confirmMissed(automationWorkspaceRoot(), id),
  );
}

export async function aiAutomationMarkDueMissed(): Promise<void> {
  await (await readyAiAutomationService()).missInactive(
    null,
    "Scheduled messages were disabled at delivery time",
  );
}

/**
 * Tell the windows a task changed - but only hand them a task they can act on.
 *
 * Every window treats a broadcast task as the one to show, and one in review opens a
 * Review dialog with Apply. A Team role task (never reviewable on its own) or a task
 * from a folder that is not open would offer an Apply that `aiWorkspaceApply` must
 * refuse, and did: "Task is not in the open workspace", once per click. For those the
 * windows still hear that something changed, with the task they can act on instead.
 */
function announceWorkspaceTask(task: Parameters<typeof toAiWorkspaceTaskView>[0]): void {
  if (task.reviewable && belongsToCurrentWorkspace(task)) {
    broadcast(CHANNELS.aiWorkspaceChanged, toAiWorkspaceTaskView(task));
    return;
  }
  void aiCurrentWorkspaceTask()
    .then((current) => broadcast(CHANNELS.aiWorkspaceChanged, current))
    .catch(() => undefined);
}

function belongsToCurrentWorkspace(task: AiWorkspaceTask): boolean {
  const root = currentWorkspace()?.root;
  return root !== undefined && normalizeForCompare(root) === normalizeForCompare(task.workspaceRoot);
}

async function currentWorkspaceTask(taskId: string): Promise<AiWorkspaceTask | null> {
  const task = await (await readyAiWorkspaceService()).read(taskId);
  return task !== null && task.reviewable && belongsToCurrentWorkspace(task) ? task : null;
}

function announceProjectFiles(paths: readonly string[]): void {
  broadcast(CHANNELS.workspaceFilesChanged, [...paths]);
}

/**
 * File tools work directly on the open project — no sandbox, no task, no
 * review queue. Reads and writes resolve to the live folder; the only gates
 * are an open folder, enabled file tools, and (for writes) no unsaved drafts
 * that a write could clobber.
 */
async function resolveToolWorkspace() {
  const human = currentWorkspace()?.root ?? null;
  taskWorkspaceUnavailableReason = null;
  if (human === null) {
    taskWorkspaceUnavailableReason = "Open a folder before using AI file tools.";
    return null;
  }
  if (currentSettings()["adcode.ai.isolatedWorkspaces"] === false) {
    taskWorkspaceUnavailableReason = "AI file tools are off. Turn on AI file tools in Settings to let the assistant edit this project.";
    return null;
  }
  // Review mode with a task under way: read the staged copy, so the model sees its own
  // edits. Reading never starts a task - a plain question stays a plain question.
  if (configuredEditPolicy() === "review" && activeTaskId !== null) {
    const task = await (await readyAiWorkspaceService()).read(activeTaskId);
    if (task !== null && REUSABLE_TASK_STATES.has(task.state) && normalizeForCompare(task.workspaceRoot) === normalizeForCompare(human)) {
      return { taskId: task.id, sandboxRoot: taskSandboxRoot(task.id), humanRoot: human };
    }
  }
  return { taskId: "", sandboxRoot: human, humanRoot: human };
}

const taskSandboxRoot = (taskId: string): string => join(app.getPath("userData"), "ai-workspaces", "sandboxes", taskId);

/**
 * The review task this turn's edits are staged in: the one under way, or a new one.
 *
 * "Review every change" had lost its plumbing when direct writes arrived - the setting
 * existed and did nothing. This is that plumbing back: edits land in an isolated copy,
 * the chat shows them as proposals, and nothing reaches the project until Apply.
 */
async function reviewWorkspace(human: string) {
  const service = await readyAiWorkspaceService();
  let task = activeTaskId === null ? null : await service.read(activeTaskId);
  if (
    task === null ||
    normalizeForCompare(task.workspaceRoot) !== normalizeForCompare(human) ||
    task.reviewPolicy !== "review" ||
    !REUSABLE_TASK_STATES.has(task.state)
  ) {
    task = await service.start({
      workspaceRoot: human,
      prompt: currentTaskPrompt ?? "Continue the assistant task",
      reviewPolicy: "review",
      tokenLimit: null,
    });
    activeTaskId = task.id;
    announceWorkspaceTask(task);
  }
  return { taskId: task.id, sandboxRoot: taskSandboxRoot(task.id), humanRoot: human };
}

async function ensureToolWorkspace() {
  const human = currentWorkspace()?.root ?? null;
  taskWorkspaceUnavailableReason = null;
  if (human === null) {
    taskWorkspaceUnavailableReason = "Open a folder before using AI file tools.";
    return null;
  }
  if (currentSettings()["adcode.ai.isolatedWorkspaces"] === false) {
    taskWorkspaceUnavailableReason = "AI file tools are off. Turn on AI file tools in Settings to let the assistant edit this project.";
    return null;
  }
  // The chat's "Answer anyway" one-shot: the user accepted the risk of
  // writing over unsaved work rather than saving first.
  if (!bypassWorkspaceBlockOnce) {
    const drafts = await recoverableDrafts();
    if (workspaceHasUnsavedDraft(human, drafts)) {
      const names = summarizeUnsavedDrafts(human, drafts);
      taskWorkspaceUnavailableReason =
        `Save ${names} before AI file edits, so nothing you have not saved gets overwritten.`;
      return null;
    }
  } else {
    bypassWorkspaceBlockOnce = false;
  }

  if (configuredEditPolicy() === "review") return reviewWorkspace(human);
  return { taskId: "", sandboxRoot: human, humanRoot: human };
}

/** Automatic unless the user chose Review: edits land as the assistant works, undoable per turn. */
function configuredEditPolicy(): "review" | "trusted" {
  return currentSettings()["adcode.ai.editPolicy"] === "review" ? "review" : "trusted";
}

// The debug log names the selected provider and model - ids only, never keys.
describeDebugContext({
  aiSelection: () => {
    const provider = activeProvider();
    return {
      provider,
      model: activeModel(provider),
      effort: configuredEffort() ?? "auto",
      fileTools: currentSettings()["adcode.ai.isolatedWorkspaces"] !== false,
    };
  },
});

function configuredEffort(): "low" | "medium" | "high" | "max" | undefined {
  const value = currentSettings()["adcode.ai.effort"];
  return value === "low" || value === "medium" || value === "high" || value === "max" ? value : undefined;
}

function configuredStoragePolicy() {
  const values = currentSettings();
  const quota = values["adcode.ai.sandboxQuota"];
  const sandboxRetention = values["adcode.ai.sandboxRetention"];
  const checkpointRetention = values["adcode.ai.checkpointRetention"];
  const day = 86_400_000;
  return {
    quotaBytes: quota === "1gb" ? 1_000_000_000 : quota === "10gb" ? 10_000_000_000 : 5_000_000_000,
    sandboxRetentionMs: sandboxRetention === "1d" ? day : sandboxRetention === "30d" ? 30 * day : 7 * day,
    checkpointRetentionMs:
      checkpointRetention === "7d" ? 7 * day : checkpointRetention === "90d" ? 90 * day : 30 * day,
  };
}

/**
 * The conversation being written to.
 *
 * Held here rather than in the renderer because it is the main process that knows when a
 * turn has finished - and a turn is the unit worth saving. Saving per streamed token would
 * be thousands of writes for one answer.
 */
let session: ChatSession | null = null;

function startSession(): ChatSession {
  return {
    id: `s${String(Date.now())}${Math.random().toString(36).slice(2, 8)}`,
    title: titleFor([]),
    renamed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
}

/** The conversations for the open project, newest first. */
export function aiSessions(): Promise<ChatSession[]> {
  return readSessions(currentWorkspace()?.root ?? null);
}

export async function aiDeleteSession(id: string): Promise<ChatSession[]> {
  await deleteSession(currentWorkspace()?.root ?? null, id);
  if (session?.id === id) session = null;
  return aiSessions();
}

export async function aiClearSessions(): Promise<ChatSession[]> {
  await clearSessions(currentWorkspace()?.root ?? null);
  session = null;
  return aiSessions();
}

export async function aiRenameSession(id: string, title: string): Promise<ChatSession[]> {
  const trimmed = title.trim().slice(0, 120);
  if (trimmed.length === 0) return aiSessions();

  const all = await aiSessions();
  const found = all.find((one) => one.id === id);
  if (found === undefined) return all;

  // `renamed` is what stops auto-titling from overwriting the user's own words later.
  const renamed: ChatSession = { ...found, title: trimmed, renamed: true };
  await writeSession(currentWorkspace()?.root ?? null, renamed);
  if (session?.id === id) session = renamed;

  return aiSessions();
}

/** Reopen a past conversation. Returns it so the renderer can draw the transcript. */
export async function aiResumeSession(id: string): Promise<ChatSession | null> {
  const found = (await aiSessions()).find((one) => one.id === id) ?? null;
  if (found === null) return null;

  session = found;
  // The agent's own history belongs to the previous conversation.
  agent = null;
  activeTaskId = null;
  return found;
}

/** What the assistant is carrying into the next turn, for the memory strip. */
export function aiCurrentSession(): ChatSession | null {
  return session;
}

let agent: Agent | null = null;
let agentProvider: string | null = null;
let agentModel: string | null = null;
let agentEndpoint: string | null = null;

function broadcast(channel: string, ...args: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, ...args);
  }
}

function activeProvider(): string {
  const value = currentSettings()["adcode.ai.provider"];
  return typeof value === "string" && value.length > 0 ? value : "anthropic";
}

/**
 * The model id to send.
 *
 * Free text rather than a member of a fixed list, because the catalogue is the list and it
 * changes without this app shipping. An empty setting falls back to the provider's first
 * catalogue entry, which is the closest thing to "the obvious one".
 */
function activeModel(provider: string): string {
  const connection = connections().find(item => item.id === provider);
  if (connection) return connection.model;
  const value = currentSettings()["adcode.ai.model"];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();

  // The provider's recommended model, not whatever upstream happened to list first - for
  // OpenRouter that was a stealth preview that filled every reply with "I stopped at a limit".
  return recommendedModel(catalogue, provider) ?? DEFAULT_ANTHROPIC_MODEL;
}

/** What the catalogue knows about a model, for the adapters: its effort levels and output ceiling. */
const traitsFor = (providerId: string) => (model: string) => traitsOf(catalogue, providerId, model);

/**
 * The output allowance a chat request starts with, and the most it may grow to.
 *
 * Starting at 16K (or the model's own ceiling, when lower) leaves room for hidden reasoning
 * plus a real answer; a reply cut off part way doubles it, up to the model's ceiling. A model
 * the catalogue does not know grows to the agent's default instead.
 */
function outputBudget(providerId: string, model: string): { maxTokens: number; maxOutputTokens?: number } {
  const ceiling = traitsOf(catalogue, providerId, model)?.maxOutput ?? null;
  return ceiling === null ? { maxTokens: 16_384 } : { maxTokens: Math.min(16_384, ceiling), maxOutputTokens: Math.min(ceiling, 65_536) };
}

/**
 * A client for whichever provider is selected.
 *
 * Two first-class clients - Anthropic and Google, which do not speak the OpenAI wire format
 * - and everything else through one OpenAI-compatible client pointed at a different address.
 * That is what makes hundreds of providers reachable without hundreds of adapters, and it
 * is the same mechanism the custom endpoint uses.
 */
export async function buildProvider(id: string, offeredKey?: string): Promise<Provider | null> {
  const key = offeredKey ?? (KEYLESS.has(id) ? "" : ((await keys.get(id)) ?? ""));
  const paced = (provider: Provider) => requestScheduler.wrap(provider, id, () => connections().find(item => item.id === id)?.rpm ?? 6000);
  if (!KEYLESS.has(id) && key.length === 0 && id !== "custom") return null;

  if (id === "anthropic") return paced(createAnthropicProvider({ apiKey: key, traits: traitsFor(id) }));
  if (id === "google") return paced(createGoogleProvider({ apiKey: key, traits: traitsFor(id) }));

  const baseUrl = baseUrlOf(id);
  if (baseUrl === null) return null;

  const known = providerIn(catalogue, id);

  return paced(createOpenAiCompatibleProvider({
    id,
    displayName: known?.name ?? id,
    baseUrl,
    apiKey: key,
    models: (known?.models ?? []).map((model) => model.id),
    traits: traitsFor(id),
  }));
}

/**
 * The chat's background commands - a dev server, a watcher. One registry for the app, so a
 * server started in one turn can be read and stopped in the next.
 */
const chatCommands = createCommandRunner();

/** Stop what the assistant left running: the folder changed, or the app is quitting. */
export function aiStopToolProcesses(): void {
  chatCommands.stopAll();
  closeAgentBrowser();
}

/** The background commands, in a line for the host context, so a later turn knows they exist. */
function describeBackgroundCommands(): string | null {
  const running = chatCommands.list().filter((item) => item.running);
  if (running.length === 0) return null;
  return `Background commands still running: ${running.map((item) => `${item.id} (${item.command}${item.url === null ? "" : ` at ${item.url}`})`).join(", ")}. command_output reads them; stop_command ends one.`;
}

function toolRunner() {
  return createAiToolRunner({
    openPreview: (path) => openAiPreview(broadcast, path),
    viewPage: (request, signal) => viewPage(request, { previewUrl: () => aiPreviewUrl(broadcast) }, signal),
    backgroundCommands: chatCommands,
    recordUndo: (path, before, after, encoding) => checkpoints.record(path, before, after, encoding),
    onFilesChanged: (paths) => announceProjectFiles(paths),
    workspace: resolveToolWorkspace,
    writeWorkspace: ensureToolWorkspace,
    workspaceUnavailableMessage: () =>
      taskWorkspaceUnavailableReason ?? "No folder is open, so there is nothing to work on yet.",
    reviewPolicy: configuredEditPolicy,
    directWrites: () => configuredEditPolicy() === "trusted",
    memory: () => memoryForWorkspace(),
    writeSandboxFile: async (path, contents) => {
      if (configuredEditPolicy() === "review") {
        if (activeTaskId === null) throw new Error("The review task is unavailable. Try again.");
        const task = await (await readyAiWorkspaceService()).write(activeTaskId, path, contents);
        announceWorkspaceTask(task);
        const change = task.changes.find((item) => item.path === path);
        if (change === undefined) throw new Error("The staged change was not recorded");
        return change;
      }
      const human = currentWorkspace()?.root ?? null;
      if (human === null) throw new Error("No folder is open, so there is nothing to work on yet.");
      const absolute = await resolveSandboxPath(human, path);
      let original: string | null = null;
      try {
        original = await readFile(absolute, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException | null)?.code !== "ENOENT") throw error;
      }
      await mkdir(dirname(absolute), { recursive: true });
      const temporary = `${absolute}.adcode-${randomUUID()}.tmp`;
      await writeFile(temporary, contents, "utf8");
      try {
        await rename(temporary, absolute);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
      checkpoints.record(path, original, contents);
      return createFileChange(path, original, contents);
    },
    onProposedEdit: (edit) => {
      if (configuredEditPolicy() !== "review") {
        announceProjectFiles([edit.relativePath]);
        return;
      }
      // Staged, not applied: nothing on disk moved. The turn's changes are offered for
      // Apply once, when it ends; this only tells the windows that some are waiting.
      const root = currentWorkspace()?.root;
      const view: ProposedEditView = {
        taskId: edit.taskId,
        relativePath: edit.relativePath,
        path: edit.path,
        displayPath: root === undefined ? edit.path : relative(root, edit.path),
        summary: edit.summary,
        hunks: edit.hunks.map((hunk) => ({ id: hunk.id, startLine: hunk.startLine, original: hunk.original, replacement: hunk.replacement })),
      };
      broadcast(CHANNELS.aiProposedEdit, view);
    },
    onCommandFinished: () => {
      announceProjectFiles([]);
    },
  });
}

export async function aiStatus(): Promise<AiStatus> {
  const provider = activeProvider();

  const providers: AiProviderInfo[] = [];

  for (const known of catalogue) {
    const needsKey = !KEYLESS.has(known.id);
    const recommended = recommendedModel(catalogue, known.id);

    providers.push({
      id: known.id,
      displayName: known.name,
      // The recommended model first - it is what "Use this model" picks - then newest first.
      models: [...known.models]
        .sort((a, b) => Number(b.id === recommended) - Number(a.id === recommended))
        .map((model) => modelInfo(known.id, model, recommended)),
      hasKey: needsKey ? await keys.has(known.id) : true,
      needsKey,
      transport: transportFor(known.id),
      doc: known.doc,
    });
  }

  /*
   * Ollama, as it is on this computer - asked, never assumed.
   *
   * It used to be listed as connected on every machine ("no key needed", in green), installed
   * or not. Its models are the ones this machine has pulled; it counts as ready only while it
   * is running and has the selected model.
   */
  const local = await localModels();
  const preferredLocal = preferredOllamaModel(local.models);
  providers.push({
    id: "ollama",
    displayName: "Ollama (on this computer)",
    models: [...local.models]
      .sort((a, b) => Number(b === preferredLocal) - Number(a === preferredLocal))
      .map((name) => ({ id: name, name, toolCall: true, reasoning: false, recommended: name === preferredLocal, free: true })),
    hasKey: local.running && local.models.length > 0,
    needsKey: false,
    local,
    transport: "openai-compatible",
    doc: "https://ollama.com/download",
  });

  /*
   * The custom endpoint is always offered, and is not in the catalogue.
   *
   * It is the escape hatch that makes "any provider" true rather than aspirational: a
   * gateway, a new service, or a model on this machine, reached by an address the user
   * supplies.
   */
  const customUrl = baseUrlOf("custom");
  providers.push({
    id: "custom",
    displayName: "Custom endpoint",
    models: [],
    hasKey: await keys.has("custom"),
    needsKey: true,
    transport: customUrl === null ? "unsupported" : "openai-compatible",
    doc: null,
  });

  for (const item of connections()) {
    providers.unshift({id:item.id,displayName:item.name,models:[{id:item.model,name:item.model,toolCall:true,reasoning:false}],hasKey:await keys.has(item.id),needsKey:true,transport:"openai-compatible",doc:null});
  }
  const active = providers.find((one) => one.id === provider);

  return {
    providers,
    connections: connections().map(item => ({...item,...requestScheduler.status(item.id)})),
    activeProvider: provider,
    activeModel: activeModel(provider),
    // Ready means a turn would actually reach something: a key where one is needed, and an
    // address where the provider is the custom one.
    ready:
      (active?.hasKey ?? false) &&
      (provider !== "custom" || customUrl !== null) &&
      // A local model is ready only while Ollama runs and has it.
      (provider !== "ollama" || local.models.includes(activeModel("ollama"))),
    customBaseUrl: customUrl ?? "",
    catalogueTakenOn: SNAPSHOT_TAKEN_ON,
    catalogueIsLive,
    effort: configuredEffort() ?? "auto",
  };
}

export async function setProviderKey(provider: string, key: string): Promise<AiStatus> {
  if (provider.length > 0 && key.trim().length > 0) {
    await keys.set(provider, key.trim());
    agent = null;
  }
  return aiStatus();
}

export async function clearProviderKey(provider: string): Promise<AiStatus> {
  if (provider.length > 0) {
    await keys.clear(provider);
    agent = null;
  }
  return aiStatus();
}

/**
 * Check a key by using it.
 *
 * One real request, for one token, against the model that would actually be used. Anything
 * less is a guess: a key can be well-formed, correctly stored, and still rejected because
 * it was revoked, is for the wrong account, or has no credit - and finding that out at the
 * moment it is pasted is the entire point of this screen.
 */
export async function checkProviderKey(providerId: string, key: string): Promise<AiKeyCheck> {
  const trimmed = key.trim();

  if (trimmed.length === 0 && !KEYLESS.has(providerId)) {
    return { ok: false, message: "Paste a key first." };
  }

  // Checked against the key being offered rather than the one already stored, so this
  // answers about what the user just typed.


  try {
    const provider = await buildProvider(providerId, trimmed);
    if (provider === null) {
      return { ok: false, message: "ADCode has no address for that provider yet." };
    }

    const model = activeModel(providerId);
    const agentForCheck = createAgent({ provider, model, tools: [], runner: toolRunner() });

    for await (const event of agentForCheck.send("Reply with the single word: ok")) {
      if (event.kind === "error") return { ok: false, message: event.detail };
    }

    return { ok: true, detail: `${providerId} answered as ${model}.` };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "that key was not accepted",
    };
  } finally {

    agent = null;
  }
}

/** The providers quick connect may select. Each has a built-in address and a model with tools. */
const QUICK_PROVIDERS = new Set(["google", "anthropic", "openai", "openrouter", "groq", "xai", "cerebras", "deepseek", "ollama"]);

/** The model quick connect picks when the caller does not name one: the provider's recommended one. */
function quickModelFor(providerId: string): string | null {
  return recommendedModel(catalogue, providerId);
}

/**
 * Check a key against a named model, then save it and switch to it - one step.
 *
 * The Connect screen checks against "the model in settings", which on a first run is
 * whatever the default provider uses: checking a Gemini key would ask Google for a Claude
 * model and fail with a perfectly good key. Quick connect names the model it will use, and
 * only once that model has answered does anything get saved or selected, so a failure
 * leaves the person exactly where they were.
 */
export async function aiQuickConnect(providerId: string, key: string, model: string | null): Promise<AiQuickConnectResult> {
  if (!QUICK_PROVIDERS.has(providerId)) return { ok: false, message: "ADCode cannot connect that provider in one step yet." };
  const trimmed = key.trim();
  if (trimmed.length === 0 && !KEYLESS.has(providerId)) return { ok: false, message: "Paste a key first." };

  const chosen = model?.trim() || quickModelFor(providerId);
  if (chosen === null || chosen.length === 0) return { ok: false, message: "ADCode does not know a model for that provider yet." };

  try {
    const provider = await buildProvider(providerId, trimmed);
    if (provider === null) return { ok: false, message: "ADCode has no address for that provider yet." };

    const check = createAgent({ provider, model: chosen, tools: [], runner: toolRunner() });
    for await (const event of check.send("Reply with the single word: ok")) {
      if (event.kind === "error") return { ok: false, message: event.detail };
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "that key was not accepted" };
  } finally {
    agent = null;
  }

  if (!KEYLESS.has(providerId)) await keys.set(providerId, trimmed);
  await writeSetting("adcode.ai.provider", providerId);
  await writeSetting("adcode.ai.model", chosen);
  agent = null;
  return { ok: true, provider: providerId, model: chosen, status: await aiStatus() };
}

/**
 * Whether Ollama is running on this machine, and which models it has.
 *
 * Asked of its own API on loopback with a short timeout, so a machine without it answers
 * "not running" in a second and a half rather than holding up the screen.
 */
export function aiDetectOllama(): Promise<{ running: boolean; models: string[] }> {
  return askOllama();
}

/** Start Ollama on the person's click, and say how it is afterwards. */
export async function aiStartOllama(): Promise<AiStatus> {
  await startOllama();
  return aiStatus();
}

/** Days a model counts as new after its release. */
const NEW_FOR_DAYS = 45;

/** What the model list shows about a model: real numbers from the catalogue, never invented ones. */
function modelInfo(providerId: string, model: CatalogueProvider["models"][number], recommended: string | null): AiModelInfoView {
  const dollars = (micros: number | null | undefined): number | null =>
    micros === null || micros === undefined ? null : micros / 1_000_000;
  const released = model.releaseDate === undefined ? Number.NaN : Date.parse(`${model.releaseDate}T00:00:00Z`);
  return {
    id: model.id,
    name: model.name,
    toolCall: model.toolCall,
    reasoning: model.reasoning,
    recommended: model.id === recommended,
    contextWindow: model.contextWindow ?? null,
    inputPrice: dollars(model.inputCostMicrosPerMillion),
    outputPrice: dollars(model.outputCostMicrosPerMillion),
    free: model.inputCostMicrosPerMillion === 0 && model.outputCostMicrosPerMillion === 0,
    // Google's free tier covers the Flash models: the route quick connect offers first.
    freeTier: providerId === "google" && /flash/i.test(model.id),
    isNew: Number.isFinite(released) && Date.now() - released < NEW_FOR_DAYS * 86_400_000,
    releaseDate: model.releaseDate ?? null,
  };
}

/**
 * Send a turn, streaming every event to the renderer as it happens.
 *
 * The events are what §5.3's trace widget renders: "which tool it called, which file it
 * read, which command it ran, what it decided. This is what makes the AI legible instead
 * of magical."
 */
const IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/**
 * Split validated attachments into provider image parts and inlined document text.
 *
 * Images become multimodal parts on the outgoing turn only. Text documents are
 * fenced into the message itself, so they survive in history, replays and every
 * provider - including ones with no image support - exactly like pasted text.
 */
function splitAttachments(attachments: readonly AiAttachmentView[]): {
  images: ImageBlock[];
  documentText: string;
  names: string[];
} {
  const images: ImageBlock[] = [];
  const documents: string[] = [];
  const names: string[] = [];
  for (const attachment of attachments) {
    names.push(attachment.name);
    if (attachment.kind === "image" && IMAGE_MEDIA_TYPES.has(attachment.mediaType)) {
      images.push({
        type: "image",
        mediaType: attachment.mediaType as ImageMediaType,
        data: attachment.data,
      });
    } else if (attachment.kind === "text") {
      documents.push(`--- ${attachment.name} ---\n${attachment.data}`);
    }
  }
  return {
    images,
    documentText: documents.length === 0 ? "" : `\n\n${documents.join("\n\n")}`,
    names,
  };
}

/** The chat's tools: everything built in, minus memory when memory capture is off. */
function chatTools() {
  const memoryEnabled = currentSettings()["adcode.ai.memoryCapture"] !== false;
  return [...(memoryEnabled ? BUILT_IN_TOOLS : TOOLS_WITHOUT_MEMORY), ...ASSISTANT_EXTENSION_TOOLS];
}

/** When and how far a conversation with this model compacts - read fresh, so a settings change applies at once. */
function compactionFor(providerId: string, model: string): AgentCompaction {
  return {
    contextWindow: () => contextWindowFor(catalogue, providerId, model),
    thresholdPercent: () => compactThreshold(currentSettings()),
  };
}

/**
 * The chat's agent: the one it has, or a new one when there is none or the model changed.
 *
 * A new agent is never a blank one. A different model on the same provider takes the
 * history exactly as it stands, tool steps included. Anything else - a reopened
 * conversation, a restart, a changed key, another provider - is given the saved
 * conversation: its summary and the messages after it, which every provider can read.
 * Returns what to tell the user when no agent can be built.
 */
async function ensureChatAgent(providerId: string, model: string): Promise<Agent | string> {
  if (agent !== null && agentProvider === providerId && agentModel === model && agentEndpoint === baseUrlOf(providerId)) {
    return agent;
  }
  const provider = await buildProvider(providerId);

  if (provider === null) {
    const name = providerIn(catalogue, providerId)?.name ?? providerId;
    // Two different failures, and the fix is different for each.
    return providerId === "custom" && baseUrlOf("custom") === null
      ? "No address for the custom endpoint. Set one in Connect a model."
      : `No API key for ${name}. Add one in Connect a model.`;
  }

  const carried = agent !== null && agentProvider === providerId ? [...agent.history()] : null;
  const built = createAgent({
    provider,
    model,
    tools: chatTools(),
    effort: configuredEffort(),
    ...outputBudget(providerId, model),
    compaction: compactionFor(providerId, model),
    initialMessages: carried ?? (session === null ? [] : restoreHistory(session)),
    context: async () => {
      const root = currentWorkspace()?.root ?? null;
      let blocker: string | null = null;
      if (currentSettings()["adcode.ai.isolatedWorkspaces"] === false) {
        blocker = "Turn on AI file tools in Settings to use file tools.";
      } else if (root !== null) {
        const drafts = await recoverableDrafts();
        if (workspaceHasUnsavedDraft(root, drafts)) {
          blocker = `Save ${summarizeUnsavedDrafts(root, drafts)} before AI file edits, so nothing unsaved gets overwritten. Reading and answering work meanwhile.`;
        }
      }
      return [
        aiWorkspaceContext(root, blocker, editorContext, configuredEditPolicy() === "review" ? "review" : "direct"),
        ...(root === null ? [] : [describePreviewForAi()]),
        describeBackgroundCommands(),
      ].filter((line): line is string => line !== null).join("\n");
    },
    runner: withAssistantExtensions(toolRunner()),
    beforeRequest: async () => {
      // Direct edits apply immediately, so there is no task to create and
      // no budget to reserve. The turn step limit remains the backstop
      // against runaway tool loops.
      return null;
    },
  });
  agent = built;
  agentProvider = providerId;
  agentModel = model;
  agentEndpoint = baseUrlOf(providerId);
  return built;
}

/**
 * Save a compaction with the conversation, so a reopened chat starts from the summary.
 *
 * The summary covers the transcript up to the oldest user turn the model kept - never the
 * newest one, so the request in flight always stays in the transcript itself.
 */
async function recordCompaction(from: Agent, event: { readonly summary: string; readonly keptMessages: number }): Promise<void> {
  if (session === null) return;
  const turns = Math.max(1, keptUserTurns(from.history(), event.keptMessages));
  session = withSummary(session, { text: event.summary, coversUntil: summaryCoverage(session.messages, turns), at: Date.now() });
  await writeSession(currentWorkspace()?.root ?? null, session);
  broadcast(CHANNELS.aiSessionChanged, session);
}

/** Summarise the older part of the conversation now: `/compact`, or Compact now on the meter. */
export async function aiCompact(rawFocus: unknown): Promise<AiCompactResultView> {
  const focus = parseCompactFocus(rawFocus);
  if (focus === null) return { ok: false, message: "Keep the focus under 500 characters." };
  if (sendInFlight) return { ok: false, message: "Wait for the current answer to finish, then compact." };
  if (session === null || session.messages.length === 0) return { ok: false, message: "There is nothing to compact yet." };

  const providerId = activeProvider();
  const ready = await ensureChatAgent(providerId, activeModel(providerId));
  if (typeof ready === "string") return { ok: false, message: ready };

  sendInFlight = true;
  try {
    const outcome = await ready.compact(focus);
    if (!outcome.ok) return { ok: false, message: outcome.reason };
    await recordCompaction(ready, outcome);
    broadcast(CHANNELS.aiEvent, { kind: "compacted", summary: outcome.summary, before: outcome.before, after: outcome.after, keptMessages: outcome.keptMessages });
    const usage = ready.contextUsage();
    if (usage !== null) broadcast(CHANNELS.aiEvent, { kind: "context", ...usage });
    recordDebug("info", "ai", `Compacted the conversation: about ${String(outcome.before)} to ${String(outcome.after)} tokens`);
    return { ok: true, message: "Earlier conversation compacted.", summary: outcome.summary };
  } finally {
    sendInFlight = false;
  }
}

/** How full the chat's context is, for the composer's meter. */
export function aiContextUsage(): AiContextUsageView {
  const providerId = activeProvider();
  const model = activeModel(providerId);
  const settings = currentSettings();
  const live = agent !== null && agentProvider === providerId && agentModel === model ? agent.contextUsage() : null;
  return {
    tokens: live?.tokens ?? (session === null ? 0 : estimateTokens("", restoreHistory(session), chatTools())),
    contextWindow: contextWindowFor(catalogue, providerId, model),
    thresholdPercent: compactThreshold({ ...settings, "adcode.ai.autoCompact": true }) ?? 80,
    autoCompact: settings["adcode.ai.autoCompact"] !== false,
  };
}

/** What the user was looking at when they last sent; folded into every round-trip of that turn. */
let editorContext: AiEditorContextView | null = null;

export async function aiSend(
  text: string,
  attachments: readonly AiAttachmentView[] = [],
  editor: AiEditorContextView | null = null,
): Promise<boolean> {
  if (sendInFlight) throw new Error("The built-in assistant is already handling a message");
  sendInFlight = true;
  editorContext = editor;
  currentTaskPrompt = text.slice(0, 200);
  try {
    const providerId = activeProvider();
    const model = activeModel(providerId);

    const ready = await ensureChatAgent(providerId, model);
    if (typeof ready === "string") {
      broadcast(CHANNELS.aiEvent, { kind: "error", detail: ready });
      recordDebug("error", "ai", ready);
      recordMilestone("turn_failed");
      return false;
    }
    recordMilestone("prompt_sent");

    // Attachments ride this turn only. The session keeps names, not bytes: image
    // base64 in a session file would bloat history on disk and re-send stale
    // pixels on every restore, while the names still tell the story.
    const { images, documentText, names } = splitAttachments(attachments);
    const turnText = `${text}${documentText}`;
    const recordedText =
      names.length === 0 ? text : `${text}\n[Attached: ${names.join(", ")}]`;

    session ??= startSession();
    session = withMessage(session, { role: "user", text: recordedText, at: Date.now() });

    let answer = "";
    let paragraphBreak = false;
    let turnSucceeded = true;
    let cancelled = false;
    let modelTraceRecorded = false;
    const turnStarted = Date.now();
    let toolCalls = 0;
    // Automatic mode writes as it goes; this turn's writes become one undoable checkpoint.
    const turnRoot = currentWorkspace()?.root ?? null;
    if (turnRoot !== null && configuredEditPolicy() === "trusted") checkpoints.begin(turnRoot);
    recordDebug("info", "ai", `Turn started: ${providerId} / ${model}`);

    for await (const event of ready.send(turnText, { images })) {
      broadcast(CHANNELS.aiEvent, event);
      if (event.kind === "compacted") await recordCompaction(ready, event);
      // What the debug log keeps of a turn: which tools failed and why, and how it ended.
      // Never the prompt, the answer, or a file's contents.
      if (event.kind === "tool-call") toolCalls += 1;
      if (event.kind === "tool-result" && event.isError) recordDebug("warn", "ai:tool", `${event.name} failed: ${event.content.slice(0, 200)}`);
      if (event.kind === "error") recordDebug("error", "ai", `${providerId} / ${model}: ${event.detail}`);
      if (activeTaskId !== null) {
        const workspaceService = await readyAiWorkspaceService();
        if (!modelTraceRecorded) {
          await workspaceService.recordTrace(activeTaskId, {
            kind: "state",
            summary: `Started ${providerId}/${model} assistant turn`,
            detail: "",
            outcome: "pending",
          });
          modelTraceRecorded = true;
        }
        const eventTrace = agentEventTrace(event);
        if (eventTrace !== null) await workspaceService.recordTrace(activeTaskId, eventTrace);
      }
      // Text on either side of tool work is two paragraphs, not one run-on sentence
      // ("…files first.Seven scripts…") when the conversation is reopened.
      if (event.kind === "tool-call" && answer.trim().length > 0) paragraphBreak = true;
      if (event.kind === "text") {
        if (paragraphBreak && !answer.endsWith("\n\n")) answer = `${answer.trimEnd()}\n\n`;
        paragraphBreak = false;
        answer += event.text;
      }
      if (event.kind === "error" || event.kind === "refusal" || event.kind === "cancelled") {
        turnSucceeded = false;
      }
      if (event.kind === "cancelled") cancelled = true;
    }

    let agentEditRecorded = false;
    if (turnSucceeded && activeTaskId !== null) {
      const service = await readyAiWorkspaceService();
      const task = await currentWorkspaceTask(activeTaskId);
      if (task?.reviewPolicy === "trusted" && task.state === "review" && task.changes.length > 0) {
        const changes = task.changes;
        const result = await service.applyTrusted(task.id);
        announceWorkspaceTask(result.task);
        if (result.ok) {
          recordAgentEdit({
            chars: changes.reduce(
              (total, change) => total + Math.max(0, change.proposed.length - (change.original?.length ?? 0)),
              0,
            ),
            acceptedEdits: changes.reduce(
              (total, change) => total + computeHunks(change.original ?? "", change.proposed).length,
              0,
            ),
            rejectedEdits: 0,
          });
          agentEditRecorded = true;
        } else if (result.conflicts.length > 0) {
          broadcast(CHANNELS.aiEvent, {
            kind: "error",
            detail: "Trusted apply stopped because your files changed during the task. Nothing was applied.",
          });
        }
      }
    }

    /*
     * Written once, when the turn is over.
     *
     * An empty answer is not saved: a cancelled turn or a provider error would otherwise
     * leave a conversation whose last line is blank, which reads as the assistant having
     * nothing to say rather than as something having gone wrong.
     */
    if (answer.length > 0) {
      session = withMessage(session, { role: "assistant", text: answer, at: Date.now() });
    }

    await writeSession(currentWorkspace()?.root ?? null, session);
    broadcast(CHANNELS.aiSessionChanged, session);
    const checkpoint = await checkpoints.finish().catch(() => null);
    if (checkpoint !== null) {
      broadcast(CHANNELS.aiCheckpoint, {
        id: checkpoint.id,
        createdAt: checkpoint.createdAt,
        files: checkpoint.files.map((file) => ({ path: file.path, created: file.before === null, deleted: file.after === null })),
      });
      recordDebug("info", "ai", `Turn changed ${checkpoint.files.length} file${checkpoint.files.length === 1 ? "" : "s"} (undo available)`);
      /*
       * Automatic mode - the default - writes through checkpoints, not through a review task,
       * and the agent's share of the writing was only ever counted on the task path. Every
       * account on the dashboard read "the agent wrote 0%", including ones that used nothing
       * else. Counted here from what the turn actually changed on disk.
       */
      if (!agentEditRecorded) {
        recordAgentEdit({
          chars: checkpoint.files.reduce(
            (total, file) => total + Math.max(0, (file.after?.length ?? 0) - (file.before?.length ?? 0)),
            0,
          ),
          acceptedEdits: checkpoint.files.reduce(
            (total, file) => total + Math.max(1, computeHunks(file.before ?? "", file.after ?? "").length),
            0,
          ),
          rejectedEdits: 0,
        });
      }
    }
    recordMilestone(turnSucceeded ? "turn_ok" : cancelled ? "prompt_sent" : "turn_failed");
    recordDebug("info", "ai", `Turn ${turnSucceeded ? "finished" : "ended early"} after ${((Date.now() - turnStarted) / 1000).toFixed(1)}s with ${toolCalls} tool call${toolCalls === 1 ? "" : "s"}`);
    return turnSucceeded;
  } catch (error) {
    // §9: a failure here costs an answer, never the editor.
    if (activeTaskId !== null) {
      await (await readyAiWorkspaceService()).recordTrace(activeTaskId, {
        kind: "error",
        summary: "Assistant turn failed before completion",
        detail: "",
        outcome: "failed",
      });
    }
    const detail = error instanceof Error ? error.message : "the assistant failed";
    recordDebug("error", "ai", `Turn failed: ${detail}`);
    // Whatever the turn wrote before failing is still undoable.
    const checkpoint = await checkpoints.finish().catch(() => null);
    if (checkpoint !== null) {
      broadcast(CHANNELS.aiCheckpoint, {
        id: checkpoint.id,
        createdAt: checkpoint.createdAt,
        files: checkpoint.files.map((file) => ({ path: file.path, created: file.before === null, deleted: file.after === null })),
      });
    }
    broadcast(CHANNELS.aiEvent, { kind: "error", detail });
    recordMilestone("turn_failed");
    return false;
  } finally {
    currentTaskPrompt = null;
    sendInFlight = false;
  }
}

/** Put back what an automatic-mode turn changed. `force` overrides the user's later edits. */
export async function aiUndoCheckpoint(id: string, force: boolean): Promise<UndoResult> {
  const root = currentWorkspace()?.root ?? null;
  if (root === null) return { ok: false, restored: [], conflicts: [], message: "Open the project this change was made in to undo it." };
  const result = await checkpoints.undo(id, root, force);
  if (result.ok) {
    announceProjectFiles(result.restored);
    recordDebug("info", "ai", `Undid a turn: ${result.restored.length} file(s) restored`);
  }
  return result;
}

/** A small, tool-free, cancellable request used only for Monaco ghost text. */
export async function aiCompletion(input: AiCompletionInputView): Promise<string | null> {
  if (currentSettings()["adcode.ai.inlineCompletion"] !== true) return null;
  if (sendInFlight || input.prefix.trim().length === 0) return null;

  completionInFlight?.controller.abort();
  const controller = new AbortController();
  completionInFlight = { id: input.requestId, controller };

  try {
    const providerId = activeProvider();
    const provider = await buildProvider(providerId);
    if (provider === null || controller.signal.aborted) return null;

    const request = {
      model: activeModel(providerId),
      system: [
        "Complete code at the cursor.",
        "Return only the exact text to insert: no markdown fences, explanation, or repeated prefix.",
        "Prefer the smallest useful continuation and preserve the surrounding style.",
      ].join(" "),
      messages: [
        {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: [
                `Language: ${input.languageId}`,
                "<before-cursor>",
                input.prefix,
                "</before-cursor>",
                "<after-cursor>",
                input.suffix,
                "</after-cursor>",
              ].join("\n"),
            },
          ],
        },
      ],
      tools: [],
      maxTokens: 128,
    };

    let answer = "";
    for await (const event of provider.stream(request, controller.signal)) {
      if (controller.signal.aborted) return null;
      if (event.kind === "text") answer += event.text;
      if (answer.length > 4_096) break;
      if (event.kind === "stop" && event.reason === "refusal") return null;
    }
    if (controller.signal.aborted) return null;
    return normalizeInlineCompletion(answer, input.prefix) || null;
  } catch {
    // Completion degrades silently. The editor, LSP, and local suggestions keep working.
    return null;
  } finally {
    if (completionInFlight?.id === input.requestId) completionInFlight = null;
  }
}

let inlineEditInFlight: AbortController | null = null;

/**
 * Ctrl+E: one tool-free rewrite of an editor selection.
 *
 * The answer goes back to the renderer, which puts it in the buffer as an undoable change
 * with the old text shown beside it. Nothing touches disk: the user accepts or rejects in
 * the editor and saves as they always would.
 */
export async function aiInlineEdit(input: AiInlineEditInputView): Promise<AiInlineEditResultView> {
  inlineEditInFlight?.abort();
  const controller = new AbortController();
  inlineEditInFlight = controller;
  try {
    const providerId = activeProvider();
    const provider = await buildProvider(providerId);
    if (provider === null) return { ok: false, error: "Connect a model first: AI, then Connect a Model." };
    const request = buildInlineEditRequest(activeModel(providerId), input, 8192);
    let answer = "";
    for await (const event of provider.stream(request, controller.signal)) {
      if (controller.signal.aborted) return { ok: false, error: "Cancelled." };
      if (event.kind === "text") answer += event.text;
      if (event.kind === "stop" && event.reason === "refusal") return { ok: false, error: "The model declined this edit." };
      if (event.kind === "stop" && event.reason === "max-tokens") {
        return { ok: false, error: "The rewrite was longer than the model could return. Select less and try again." };
      }
    }
    if (controller.signal.aborted) return { ok: false, error: "Cancelled." };
    const text = cleanInlineEditAnswer(answer, input.selection);
    if (text.trim().length === 0 && input.selection.trim().length === 0) {
      return { ok: false, error: "The model returned nothing to insert. Try a more specific instruction." };
    }
    return { ok: true, text };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, error: "Cancelled." };
    return { ok: false, error: error instanceof Error ? error.message : "The model could not make this edit." };
  } finally {
    if (inlineEditInFlight === controller) inlineEditInFlight = null;
  }
}

export function aiCancelInlineEdit(): void {
  inlineEditInFlight?.abort();
  inlineEditInFlight = null;
}

export function aiCancelCompletion(requestId: number): void {
  if (completionInFlight?.id !== requestId) return;
  completionInFlight.controller.abort();
  completionInFlight = null;
}

/**
 * Production Team-role runner. It is intentionally created on demand: suggestions and
 * configured plans cannot reach a provider merely by existing.
 */
export function createBuiltInAiTeamNodeRunner(): AiTeamNodeRunner {
  return async (input) => {
    const provider = await buildProvider(input.route.providerId);
    if (provider === null) throw new Error(`No connection for ${input.route.providerId}`);
    const service = await readyAiWorkspaceService();
    const task = await service.read(input.childTaskId);
    if (task === null || task.sandbox === null) throw new Error("Team role workspace is unavailable");
    const fixedWorkspace = {
      taskId: task.id,
      sandboxRoot: join(app.getPath("userData"), "ai-workspaces", "sandboxes", task.id),
      humanRoot: task.workspaceRoot,
    };
    const runner = createAiToolRunner({
      workspace: async () => fixedWorkspace,
      workspaceUnavailableMessage: () => "This Team role's isolated workspace is unavailable.",
      memory: () => null,
      writeSandboxFile: async (path, contents) => {
        const updated = await service.writeFromSandboxBase(task.id, path, contents);
        const change = updated.changes.find((candidate) => candidate.path === path);
        if (change === undefined) throw new Error("Team role change was not recorded");
        return change;
      },
      // Individual lanes remain in Team traces. Only the combined task becomes a human
      // review diff, so concurrent role proposals never appear as if they were ready to apply.
      onProposedEdit: () => undefined,
    });
    const roleProvider = createBudgetedTeamProvider(provider, input.route, input.reserveRequest);
    // A saved agent's tool access is enforced here, before the agent exists: a read-only
    // Reviewer is never handed a tool that writes, runs or fetches.
    const access = filterToolsByAccess(AGENT_RUN_TOOLS, input.context.role.toolAccess ?? "all");
    if (access.unknown.length > 0) {
      await service.recordTrace(task.id, {
        kind: "state",
        summary: "Skipped tools this agent named that do not exist",
        detail: access.unknown.join(", ").slice(0, 300),
        outcome: "blocked",
      });
    }
    const system = input.kind === "solo"
      ? [
        "You are an ADCode agent working on one task in an isolated copy of the project.",
        `Agent: ${input.context.role.label}`,
        `Your standing instructions: ${input.context.role.objective}`,
        "Do the task end to end with the file tools you have.",
        "Before you finish, prove it works: run the project's own checks that apply - its tests, type checker or linter (look in package.json or the equivalent) - with run_command, and fix any failure you caused. If there are none, say so.",
        "Finish with a concise summary of what you changed and anything the user should check. Your edits are applied or reviewed when you finish.",
      ]
      : [
        "You are one isolated role inside an explicitly confirmed ADCode Team.",
        `Role: ${input.context.role.label}`,
        `Role objective: ${input.context.role.objective}`,
        "Work only on this node. Use the isolated file tools; never assume another role's transcript.",
        "Finish with a concise outcome summary. All edits remain review-only until the Team merge.",
      ];
    const roleAgent = createAgent({
      provider: roleProvider,
      model: input.route.modelId,
      compaction: compactionFor(input.route.providerId, input.route.modelId),
      tools: access.tools,
      runner,
      effort: configuredEffort(),
      system: system.join("\n"),
    });
    const compactPrompt = JSON.stringify({
      task: input.context.taskPrompt,
      acceptanceCriteria: input.context.taskAcceptanceCriteria,
      node: input.context.node,
      dependencies: input.context.dependencies,
      claims: input.context.claims,
    });
    let answer = "";
    let failure: Error | null = null;
    // The stuck guard can stop this agent on its own; a Stop from the user still wins.
    const local = new AbortController();
    const forward = (): void => local.abort();
    input.signal.addEventListener("abort", forward, { once: true });
    const stuck = createStuckDetector();
    let stuckReason: string | null = null;
    try {
      for await (const event of roleAgent.send(compactPrompt, { signal: local.signal })) {
        const activity = agentEventTrace(event);
        if (activity !== null) {
          await service.recordTrace(task.id, activity);
          const line = describeActivity(activity);
          if (line !== null) noteTeamActivity(input.teamId, input.node.id, line);
          if (event.kind === "tool-call" && (event.call.name === "edit_file" || event.call.name === "propose_edit") && activity.detail) {
            noteTeamTouched(input.teamId, activity.detail);
          }
          const verdict = stuck.observe(activity);
          if (verdict !== null) {
            stuckReason = verdict;
            local.abort();
            break;
          }
        }
        if (event.kind === "text") answer += event.text;
        if (event.kind === "error") failure = new Error(event.detail);
        if (event.kind === "refusal") failure = new Error(event.detail);
        if (event.kind === "cancelled") failure = new DOMException("Team role cancelled", "AbortError");
      }
    } finally {
      input.signal.removeEventListener("abort", forward);
    }
    if (input.signal.aborted) throw new DOMException("Team role cancelled", "AbortError");
    if (stuckReason !== null) {
      await service.recordTrace(task.id, { kind: "error", summary: "Stopped: the agent looked stuck", detail: stuckReason, outcome: "blocked" });
      throw new Error(`Stuck: ${stuckReason}`);
    }
    if (failure !== null) throw failure;

    const after = await service.read(task.id);
    if (after === null) throw new Error("Team role workspace disappeared");
    const changedPaths = roleHandoffChangedPaths(after.changes);
    const summary = answer.trim().slice(0, 2_000) || `${input.node.title} completed.`;
    return createTeamHandoff({
      nodeId: input.node.id,
      summary,
      findings: [],
      decisions: [],
      changedPaths,
      tests: [],
      blockers: [],
      deadEnds: [],
      completedAt: Date.now(),
    });
  };
}

async function routeCurrentTeamModel(team: Parameters<import("./aiTeamCoordinator.ts").AiTeamCoordinatorOptions["resolveRoute"]>[0], node: Parameters<import("./aiTeamCoordinator.ts").AiTeamCoordinatorOptions["resolveRoute"]>[1]) {
  const route = team.plan.roles.find(role => role.id === node.roleId)?.route;
  const providerId = route?.provider ?? activeProvider();
  const modelId = route?.model ?? activeModel(providerId);
  if ((await buildProvider(providerId)) === null) {
    throw new Error(`Connect ${providerId} before starting this Team`);
  }
  const model = providerIn(catalogue, providerId)?.models.find((candidate) => candidate.id === modelId);
  const priceKnown =
    model?.inputCostMicrosPerMillion !== null &&
    model?.inputCostMicrosPerMillion !== undefined &&
    model.outputCostMicrosPerMillion !== null;
  return {
    providerId,
    modelId,
    reason: route ? "Used this named agent's saved model." : "Used the connected model selected in ADCode settings.",
    priceKnown,
    blendedCostMicrosPerMillion: priceKnown
      ? Math.round(
          model.inputCostMicrosPerMillion! * 0.75 + model.outputCostMicrosPerMillion! * 0.25,
        )
      : null,
  };
}

async function readyAiTeamCoordinator(): Promise<AiTeamCoordinator> {
  const service = await readyAiTeamService();
  teamCoordinator ??= createAiTeamCoordinator({
    teamService: service,
    resolveRoute: routeCurrentTeamModel,
    runNode: createBuiltInAiTeamNodeRunner(),
    // Two concurrent requests is fast enough to benefit Team mode without creating a
    // burst likely to trip a provider's default account limits.
    providerConcurrency: () => 2,
    // Every board run and Team role in this window shares one limit (Settings > AI).
    slots: agentSlots,
  });
  return teamCoordinator;
}

const agentSlots = createSlotPool(() => Number(currentSettings()["adcode.ai.parallelAgents"]) || 3);

/**
 * A finished board run follows the same edit setting as the chat: with Apply automatically it
 * lands in the project straight away, with a checkpoint for Undo; with Review every change it
 * waits on its box. A clash with the user's own edits stops it as a conflict, never an overwrite.
 */
async function settleSoloRun(id: string, coordinator: AiTeamCoordinator): Promise<void> {
  try {
    const finished = await coordinator.wait(id);
    if (finished.plan.kind !== "solo" || finished.state !== "review") return;
    // A race is decided by comparing its lanes; none of them lands on its own.
    if (finished.plan.group !== undefined) return;
    if (currentSettings()["adcode.ai.editPolicy"] === "review") return;
    const taskId = finished.merge.combinedTaskId;
    if (taskId === null) return;
    const changes = await aiWorkspaceChanges(taskId);
    if (changes.length === 0) return;
    // Proof of work: a failed check or a possible secret waits for a person.
    const hold = holdReason(checksFromTraces(await aiTeamTraces(id)), riskFlags(changes));
    if (hold !== null) {
      teamHolds.set(id, hold);
      broadcast(CHANNELS.aiTeamChanged, teamView(finished));
      return;
    }
    await aiWorkspaceApply(taskId, changes.map((change) => ({ path: change.path, acceptedHunkIds: change.hunks.map((hunk) => hunk.id) })));
  } catch (error) {
    // The run stays in Ready with Apply on its box; nothing is lost.
    recordDebug("error", "ai", `Could not apply a finished agent run automatically: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

async function currentTeam(id: string) {
  const root = currentWorkspace()?.root;
  if (root === undefined) return null;
  const team = await (await readyAiTeamService()).read(id);
  return team !== null && normalizeForCompare(team.workspaceRoot) === normalizeForCompare(root)
    ? team
    : null;
}

export function aiTeamSuggestion(input: AiTeamSuggestionInputView): AiTeamSuggestionView | null {
  const root = currentWorkspace()?.root;
  if (root === undefined) return null;
  return suggestTeam({ workspaceId: root, ...input });
}

export async function aiTeamConfigure(
  id: string,
  input: ParsedAiTeamConfigure,
): Promise<AiTeamView> {
  const root = currentWorkspace()?.root;
  if (root === undefined) throw new Error("Open a folder before configuring a Team");
  const team = await (await readyAiTeamService()).configure({
    id,
    workspaceRoot: root,
    plan: input.plan,
    claims: input.claims,
    budget: input.budget,
  });
  return teamView(team);
}

export async function aiTeamList(): Promise<AiTeamView[]> {
  const root = currentWorkspace()?.root;
  if (root === undefined) return [];
  return (await (await readyAiTeamService()).list(root)).map((team) => teamView(team));
}

export async function aiTeamRead(id: string): Promise<AiTeamView | null> {
  const team = await currentTeam(id);
  return team === null ? null : teamView(team);
}

export async function aiTeamStart(id: string): Promise<AiTeamView> {
  const team = await currentTeam(id);
  if (team === null) throw new Error("That Team does not belong to the open workspace");
  if (currentSettings()["adcode.ai.isolatedWorkspaces"] === false) {
    throw new Error("Enable Isolate AI edits before starting a Team");
  }
  if (workspaceHasUnsavedDraft(team.workspaceRoot, await recoverableDrafts())) {
    throw new Error("Save open file changes before starting the Team's immutable workspace");
  }
  const coordinator = await readyAiTeamCoordinator();
  const started =
    team.state === "paused" ? await coordinator.resume(id) : await coordinator.startConfirmed(id);
  if (started.plan.kind === "solo") void settleSoloRun(id, coordinator);
  return teamView(started);
}

export async function aiTeamCancel(id: string): Promise<AiTeamView> {
  if ((await currentTeam(id)) === null) {
    throw new Error("That Team does not belong to the open workspace");
  }
  return teamView(await (await readyAiTeamCoordinator()).cancel(id));
}

export async function aiTeamTraces(id: string): Promise<AiTeamTraceView[]> {
  const team = await currentTeam(id);
  if (team === null) return [];
  const userData = app.getPath("userData");
  const roots = [
    team.workspaceRoot,
    join(userData, "ai-teams", team.id),
    ...Object.values(team.childTaskIds).map((taskId) =>
      join(userData, "ai-workspaces", "sandboxes", taskId),
    ),
  ];
  const parentEvents = (await (await readyAiTeamService()).traces(id)).map((trace) =>
    toAiTeamTraceView(trace, roots),
  );
  const workspaceService = await readyAiWorkspaceService();
  const childEvents = await Promise.all(Object.entries(team.childTaskIds).map(async ([roleId, taskId]) =>
    (await workspaceService.traces(taskId)).map(trace => toAiTeamActivityView(trace, roleId, roots)),
  ));
  return [...parentEvents, ...childEvents.flat()].sort((a, b) => a.at - b.at);
}

export function createAiTeamId(): string {
  return `team-${randomUUID()}`;
}

/**
 * Answer the next turn without file tools, once.
 *
 * The chat offers this when unsaved files block a turn: the user would rather
 * have an answer from the conversation than save first. Tool calls stay
 * guarded individually, so nothing writes from a stale snapshot.
 */
export function aiAnswerAnyway(): void {
  bypassWorkspaceBlockOnce = true;
}

export function aiCancel(): void {  completionInFlight?.controller.abort();
  completionInFlight = null;
  agent?.cancel();
  if (activeTaskId !== null) {
    const taskId = activeTaskId;
    void readyAiWorkspaceService()
      .then((service) => service.pause(taskId))
      .then((task) => {
        if (task !== null) announceWorkspaceTask(task);
      });
  }
}

/**
 * Start a new conversation.
 *
 * The previous one is already on disk, so this forgets it rather than deleting it - "New"
 * next to a history list has to mean "put that one away", not "throw it away".
 */
export function aiReset(): void {
  completionInFlight?.controller.abort();
  completionInFlight = null;
  agent?.reset();
  if (activeTaskId !== null) {
    const taskId = activeTaskId;
    void readyAiWorkspaceService()
      .then((service) => service.pause(taskId))
      .then((task) => {
        if (task !== null) announceWorkspaceTask(task);
      });
  }
  activeTaskId = null;
  session = null;
}

export async function aiWorkspaceTasks(): Promise<AiWorkspaceTaskView[]> {
  const root = currentWorkspace()?.root;
  if (root === undefined) return [];
  return (await (await readyAiWorkspaceService()).list(root)).map(toAiWorkspaceTaskView);
}

export async function aiCurrentWorkspaceTask(): Promise<AiWorkspaceTaskView | null> {
  if (activeTaskId !== null) {
    const active = await currentWorkspaceTask(activeTaskId);
    if (active !== null) return toAiWorkspaceTaskView(active);
  }
  return (await aiWorkspaceTasks())[0] ?? null;
}

export async function aiWorkspaceChanges(taskId: string): Promise<AiWorkspaceChangeView[]> {
  const task = await currentWorkspaceTask(taskId);
  return task === null ? [] : toAiWorkspaceChangeViews(task);
}

export async function aiWorkspaceTraces(taskId: string): Promise<AiWorkspaceTraceView[]> {
  const task = await currentWorkspaceTask(taskId);
  if (task === null) return [];
  const roots = {
    workspaceRoot: task.workspaceRoot,
    sandboxRoot: join(app.getPath("userData"), "ai-workspaces", "sandboxes", task.id),
  };
  return (await (await readyAiWorkspaceService()).traces(taskId)).map((trace) =>
    toAiWorkspaceTraceView(trace, roots),
  );
}

export async function aiWorkspaceApply(
  taskId: string,
  selections: readonly AiWorkspaceApplySelectionView[],
): Promise<AiWorkspaceActionView> {
  const current = await currentWorkspaceTask(taskId);
  if (current === null) throw new Error("Task is not in the open workspace");
  if (current.parentTeamId !== null) {
    const team = await (await readyAiTeamService()).read(current.parentTeamId);
    if (team?.state !== "review") {
      throw new Error("This Team review is no longer accepting additional changes");
    }
  }
  const result = await (await readyAiWorkspaceService()).apply(taskId, selections);
  announceWorkspaceTask(result.task);
  if (result.ok && result.task.state === "applied" && current.parentTeamId !== null) {
    // The human files and their rollback checkpoint are already authoritative. A transient
    // Team-record cleanup failure must not turn that successful apply into a renderer error;
    // startup recovery finalizes an applied combined review idempotently.
    await (await readyAiTeamService())
      .completeReview(current.parentTeamId, taskId)
      .catch(() => undefined);
  }
  return toAiWorkspaceActionView(result);
}

export async function aiWorkspaceDiscard(taskId: string): Promise<AiWorkspaceTaskView | null> {
  if ((await currentWorkspaceTask(taskId)) === null) return null;
  const task = await (await readyAiWorkspaceService()).discard(taskId);
  if (task === null) return null;
  if (activeTaskId === taskId) activeTaskId = null;
  announceWorkspaceTask(task);
  return toAiWorkspaceTaskView(task);
}

export async function aiWorkspaceRemove(taskId: string): Promise<boolean> {
  if ((await currentWorkspaceTask(taskId)) === null) return false;
  const removed = await (await readyAiWorkspaceService()).remove(taskId);
  if (!removed) return false;
  if (activeTaskId === taskId) activeTaskId = null;
  const current = await aiCurrentWorkspaceTask();
  broadcast(CHANNELS.aiWorkspaceChanged, current);
  return true;
}

export async function aiWorkspaceRollback(taskId: string): Promise<AiWorkspaceActionView> {
  if ((await currentWorkspaceTask(taskId)) === null) throw new Error("Task is not in the open workspace");
  const result = await (await readyAiWorkspaceService()).rollback(taskId);
  announceWorkspaceTask(result.task);
  return toAiWorkspaceActionView(result);
}
