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
import { homedir } from "node:os";
import { app, BrowserWindow } from "electron";
import {
  parseConnections,
  RequestScheduler,
  BUILT_IN_TOOLS,
  DELEGATE_TASK,
  withSubagents,
  BUNDLED_CATALOGUE,
  DEFAULT_ANTHROPIC_MODEL,
  SNAPSHOT_TAKEN_ON,
  TOOLS_WITHOUT_MEMORY,
  AGENT_RUN_TOOLS,
  MEMORY_TOOLS,
  TEAM_TOOLS,
  UPDATE_PLAN,
  createOverlapTracker,
  createTeamMailbox,
  type AgentEvent,
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
  applyOverrides,
  parseOverrides,
  preferencesWith,
  EMPTY_OVERRIDES,
  type CatalogueOverrides,
  suggestTeam,
  traitsOf,
  transportFor,
  usableCatalogue,
  type Agent,
  type ToolDefinition,
  type AiFileChange,
  type AiWorkspaceTask,
  titleFor,
  withMessage,
  withSummary,
  summaryCoverage,
  restoreHistory,
  historyForModelSwitch,
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
  type AiCheckpointView,
  type AiRunView,
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
import { askQuestionInWindows } from "./aiQuestion.ts";
import { resolveSandboxPath } from "./aiSandbox.ts";
import { createCheckpointStore, type CheckpointTurn, type UndoResult } from "./aiCheckpoints.ts";
import { announceFinishedUnseen, keepAwakeWhileWorking } from "./backgroundWork.ts";
import { createChatRuns, KEEP_GOING_LIMIT, MAX_PARALLEL_CHATS, shouldKeepGoing } from "./chatRuns.ts";
import { CONTINUE_PROMPT } from "../shared/continuePrompt.ts";
import { checkpointView, checkpointsForSession } from "./aiCheckpointView.ts";
import { ADCODE_APP_TOOLS, ASSISTANT_EXTENSION_TOOLS, withAssistantExtensions } from "./assistantControls.ts";
import { memoryForWorkspace } from "./memory.ts";
import { currentSettings, writeSetting } from "./settings.ts";
import { describeDebugContext, recordDebug } from "./debugLog.ts";
import { agentRulesContext, agentSessionStart, agentStopHooks, withAgentRules } from "./agentRules.ts";
import { currentWorkspace } from "./workspace.ts";
import { projectInstructions } from "./projectInstructions.ts";
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
import { createLiveBatcher, liveEventFrom, type LiveEventView, type LiveSourceView } from "../shared/liveAgents.ts";
import { createTeamRoleRunner } from "./teamRoleRunner.ts";
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
import { apiBaseUrl } from "./backend.ts";
import { buildTagflowProvider, refreshTagflowModels, tagflowCatalogue, tagflowDefaultModel } from "./tagflowAi.ts";
import { recordModelOutcome } from "./modelOutcomes.ts";
import { expandSlashCommand } from "../shared/slashCommands.ts";
import { outcomeOfError } from "../shared/modelOutcomes.ts";
import { preferredOllamaModel } from "../shared/quickConnect.ts";
import { recordAiUsage } from "./aiUsage.ts";
import type { UsagePrice, UsageSource } from "../shared/aiUsage.ts";
import { BUILTIN_SKILL_TOOL, builtinSkillGuidance, DESIGN_TASTE_SETTING, withBuiltinSkills } from "./builtinSkills.ts";

const keys = createKeychainStore();
const requestScheduler = new RequestScheduler();
function connections() { try { return parseConnections(currentSettings()["adcode.ai.connections"] ?? "[]"); } catch { return []; } }

/**
 * The providers that need no key.
 *
 * Ollama runs locally. Included Tagflow uses the signed-in account through our relay;
 * its provider credential is held only by the server.
 */
const KEYLESS = new Set(["ollama", "tagflow"]);

/**
 * The catalogue, live where a fetch has succeeded and bundled otherwise.
 *
 * Fetched once per run, in the background, and never waited on: the connection screen is
 * fully usable from the snapshot, and a network that is down should cost freshness rather
 * than the feature.
 */
/** The bundled or live list, before the admin panel's word on it. */
let baseCatalogue: readonly CatalogueProvider[] = BUNDLED_CATALOGUE;
/** What every surface reads: the list with the admin panel's overrides applied. */
let catalogue: readonly CatalogueProvider[] = BUNDLED_CATALOGUE;
let catalogueIsLive = false;

/**
 * The admin panel's curation of the model list (GET /v1/models/overrides): which model each
 * provider starts on, which to feature, which to hide, models to add before models.dev lists
 * them. The last good copy is kept on disk, so an offline launch still has it.
 */
let overrides: CatalogueOverrides = EMPTY_OVERRIDES;
let preferences = preferencesWith(EMPTY_OVERRIDES);
const overridesFile = (): string => join(app.getPath("userData"), "model-overrides.json");

function adoptCatalogue(): void {
  const included = tagflowCatalogue();
  const direct = applyOverrides(baseCatalogue.filter((provider) => provider.id !== "tagflow"), overrides);
  catalogue = included === null ? direct : [included, ...direct];
  preferences = preferencesWith(overrides);
}

async function refreshModelOverrides(): Promise<void> {
  try {
    overrides = parseOverrides(JSON.parse(await readFile(overridesFile(), "utf8")));
    adoptCatalogue();
  } catch {
    // Nothing saved yet.
  }
  try {
    const response = await fetch(`${apiBaseUrl()}/models/overrides`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return;
    const body = (await response.json()) as { overrides?: unknown };
    overrides = parseOverrides(body.overrides);
    adoptCatalogue();
    await writeFile(overridesFile(), JSON.stringify(overrides), "utf8");
  } catch {
    // Offline, or the server is down: the saved copy (or none) stands.
  }
}

/**
 * Both lists, on launch, in the background: models.dev for what exists, the admin panel for
 * what to recommend and hide. Neither is waited on; the bundled snapshot is usable at once.
 */
let refreshingIncludedAi: Promise<void> | null = null;

/** Publish included AI as soon as it arrives, independently of the larger model catalogue. */
function refreshIncludedAi(force = false): Promise<void> {
  if (refreshingIncludedAi !== null) return refreshingIncludedAi;
  refreshingIncludedAi = (async () => {
    const before = tagflowCatalogue();
    await refreshTagflowModels(force);
    adoptCatalogue();
    let selectedIncluded = false;
    // Older settings contain the old model default even when no AI was ever connected.
    const model = currentSettings()["adcode.ai.model"];
    if (tagflowCatalogue() !== null && activeProvider() === "anthropic" &&
        (!model || model === DEFAULT_ANTHROPIC_MODEL) && !await keys.has("anthropic")) {
      // Recheck after the keychain read so a concurrent user selection wins.
      if (activeProvider() === "anthropic" && currentSettings()["adcode.ai.model"] === model) {
        await writeSetting("adcode.ai.provider", "tagflow");
        await writeSetting("adcode.ai.model", "");
        invalidateChatAgents();
        selectedIncluded = true;
      }
    }
    if (before !== tagflowCatalogue() || selectedIncluded) broadcast(CHANNELS.aiProvidersChanged, null);
  })().finally(() => { refreshingIncludedAi = null; });
  return refreshingIncludedAi;
}

export async function refreshModelLists(): Promise<void> {
  await Promise.all([refreshCatalogue(), refreshModelOverrides(), refreshIncludedAi(true)]);
  adoptCatalogue();
  broadcast(CHANNELS.aiProvidersChanged, null);
}

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

    baseCatalogue = mergeCatalogue(BUNDLED_CATALOGUE, live);
    adoptCatalogue();
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
      onChanged: (team) => {
        const view = teamView(team);
        broadcast(CHANNELS.aiTeamChanged, view);
        // A finished team has nobody left to read its messages.
        if (view.state === "completed" || view.state === "failed" || view.state === "cancelled") {
          teamMailbox.clear(team.id);
          teamOverlaps.clear(team.id);
        }
      },
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
 * The conversation on screen.
 *
 * Held here rather than in the renderer because it is the main process that knows when a
 * turn has finished - and a turn is the unit worth saving. Saving per streamed token would
 * be thousands of writes for one answer.
 *
 * It is only the one being looked at. Each conversation that has talked to a model has its
 * own thread below, with its own agent, and a turn runs in its thread: opening another chat
 * moves this pointer and nothing else, so the turn carries on (see `chatRuns.ts`).
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

/** One conversation's working state: its agent and the turn it may be running. */
interface ChatThread {
  session: ChatSession;
  /** The project it belongs to, fixed when it starts: its saves never land in another one. */
  readonly root: string | null;
  agent: Agent | null;
  agentProvider: string | null;
  agentModel: string | null;
  agentEndpoint: string | null;
  rebuild: boolean;
  /** What the person was looking at when they last sent here; folded into every round-trip. */
  editorContext: AiEditorContextView | null;
  /** The included-AI request behind the reply being written, for its feedback buttons. */
  includedRequestId: string | undefined;
  /** This turn's undo recording, when it writes files directly. */
  checkpoint: CheckpointTurn | null;
  /** Set by Stop: a turn that would keep going by itself does not. */
  stopRequested: boolean;
  lastUsed: number;
  /** The running turn's live status line, so a sub-agent's progress shows in its chat. */
  status: ((text: string) => void) | null;
  /** What this conversation's sessionStart hooks printed; undefined until they have run. */
  startContext: string | null | undefined;
  /** Stops a running hook command when the person presses Stop. */
  hookAbort: AbortController | null;
}

const threads = new Map<string, ChatThread>();
/** Idle threads kept with their agents, so going back to a recent chat does not rebuild one. */
const IDLE_THREADS_KEPT = 8;

const runs = createChatRuns({
  // Review mode stages a turn's edits in one task for Apply: one chat at a time there.
  maxParallel: () => (configuredEditPolicy() === "review" ? 1 : MAX_PARALLEL_CHATS),
});

function threadFor(chat: ChatSession): ChatThread {
  const existing = threads.get(chat.id);
  if (existing !== undefined) {
    existing.lastUsed = Date.now();
    return existing;
  }
  const created: ChatThread = {
    session: chat,
    root: currentWorkspace()?.root ?? null,
    agent: null,
    agentProvider: null,
    agentModel: null,
    agentEndpoint: null,
    rebuild: false,
    editorContext: null,
    includedRequestId: undefined,
    checkpoint: null,
    stopRequested: false,
    lastUsed: Date.now(),
    status: null,
    startContext: undefined,
    hookAbort: null,
  };
  threads.set(chat.id, created);
  const idle = [...threads.values()].filter((thread) => !runs.isRunning(thread.session.id) && thread.session.id !== session?.id);
  if (idle.length > IDLE_THREADS_KEPT) {
    idle.sort((a, b) => a.lastUsed - b.lastUsed);
    for (const thread of idle.slice(0, idle.length - IDLE_THREADS_KEPT)) threads.delete(thread.session.id);
  }
  return created;
}

/** A thread's conversation moved on; the screen follows if it is the one shown. */
function adoptSession(thread: ChatThread, next: ChatSession): void {
  thread.session = next;
  if (session?.id === next.id) session = next;
}

/** The thread of the conversation on screen, if it has one. */
function shownThread(): ChatThread | null {
  return session === null ? null : threads.get(session.id) ?? null;
}

function dropThread(id: string): void {
  const thread = threads.get(id);
  if (thread === undefined) return;
  thread.stopRequested = true;
  thread.agent?.cancel();
  thread.hookAbort?.abort();
  threads.delete(id);
}

/** The chats working, each marked if it is the one on screen. */
function runViews(): AiRunView[] {
  return runs.list().map((run) => ({ ...run, shown: run.sessionId === session?.id }));
}

/** Tell every window which chats are working, and keep the app awake while any is. */
function announceRuns(): void {
  const list = runViews();
  keepAwakeWhileWorking(list.length > 0);
  broadcast(CHANNELS.aiRunsChanged, list);
}

/** The conversations for the open project, newest first. */
export function aiSessions(): Promise<ChatSession[]> {
  return readSessions(currentWorkspace()?.root ?? null);
}

export async function aiDeleteSession(id: string): Promise<ChatSession[]> {
  dropThread(id);
  await deleteSession(currentWorkspace()?.root ?? null, id);
  if (session?.id === id) session = null;
  return aiSessions();
}

export async function aiClearSessions(): Promise<ChatSession[]> {
  for (const id of [...threads.keys()]) dropThread(id);
  await clearSessions(currentWorkspace()?.root ?? null);
  session = null;
  return aiSessions();
}

export async function aiRenameSession(id: string, title: string): Promise<ChatSession[]> {
  const trimmed = title.trim().slice(0, 120);
  if (trimmed.length === 0) return aiSessions();

  const all = await aiSessions();
  const found = threads.get(id)?.session ?? all.find((one) => one.id === id);
  if (found === undefined) return all;

  // `renamed` is what stops auto-titling from overwriting the user's own words later.
  const renamed: ChatSession = { ...found, title: trimmed, renamed: true };
  await writeSession(currentWorkspace()?.root ?? null, renamed);
  const thread = threads.get(id);
  if (thread !== undefined) adoptSession(thread, renamed);
  else if (session?.id === id) session = renamed;

  return aiSessions();
}

/**
 * Open a conversation. Returns it so the renderer can draw the transcript.
 *
 * Whatever was working keeps working: this only changes which conversation is on screen. A
 * conversation that is itself mid-turn comes back as its thread holds it - with the message
 * that started the turn - and the renderer replays the turn so far from `aiLiveTurn`.
 */
export async function aiResumeSession(id: string): Promise<ChatSession | null> {
  const thread = threads.get(id);
  const found = thread?.session ?? (await aiSessions()).find((one) => one.id === id) ?? null;
  if (found === null) return null;

  session = found;
  if (thread !== undefined) thread.lastUsed = Date.now();
  activeTaskId = null;
  return found;
}

/** What the assistant is carrying into the next turn, for the memory strip. */
export function aiCurrentSession(): ChatSession | null {
  return session;
}

/** The conversations working right now. */
export function aiRuns(): AiRunView[] {
  return runViews();
}

/**
 * A working conversation's turn so far, for a chat opened partway through it. Anything still
 * held for batching goes out first, so the window never gets a piece both live and in this.
 */
export function aiLiveTurn(sessionId: string): readonly unknown[] {
  chatEvents.flush();
  return runs.replay(sessionId);
}

/** Retain the live history until the next model has taken it, including completed tools. */
function invalidateChatAgent(thread: ChatThread): void {
  thread.agent?.cancel();
  thread.rebuild = true;
}

/**
 * A route the chats use changed (a key, the provider). The chat on screen drops its pending
 * request; every chat - on screen or working in the background - rebuilds on its next turn.
 * `provider` limits it to the chats talking to that provider.
 */
function invalidateChatAgents(provider?: string): void {
  const shown = shownThread();
  for (const thread of threads.values()) {
    if (provider !== undefined && thread.agentProvider !== provider) continue;
    if (thread === shown) invalidateChatAgent(thread);
    else thread.rebuild = true;
  }
}

/**
 * Stop a previous model's pending request or limit wait when the user switches routes.
 *
 * Only in the chat on screen, where the switch was made. A chat working in the background
 * finishes its turn on the model it started with and takes the new one on its next turn.
 */
export function aiModelSettingsChanged(): void {
  const thread = shownThread();
  if (thread !== null && thread.agent !== null && (thread.agentProvider !== activeProvider() || thread.agentModel !== activeModel(activeProvider()) || thread.agentEndpoint !== baseUrlOf(activeProvider()))) invalidateChatAgent(thread);
}

function broadcast(channel: string, ...args: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, ...args);
  }
}

/** About one frame: code drafts arriving faster than this are merged into one message. */
const LIVE_FRAME_MS = 33;

/** The chat's events, with code drafts coalesced so a fast model does not flood the window. */
const chatEvents = createLiveBatcher<AgentEvent>(
  (event) => broadcast(CHANNELS.aiEvent, event),
  (flush) => { setTimeout(flush, LIVE_FRAME_MS); },
);

/** What Team and solo agents say to each other, and what each one's edits run into. */
const teamMailbox = createTeamMailbox();
const teamOverlaps = createOverlapTracker();
const liveBatchers = new Map<string, ReturnType<typeof createLiveBatcher<LiveEventView>>>();

/** Report a background agent's activity to the chat's live room. */
function broadcastLive(source: LiveSourceView, event: LiveEventView): void {
  const key = `${source.teamId}/${source.nodeId}`;
  let batcher = liveBatchers.get(key);
  if (batcher === undefined) {
    batcher = createLiveBatcher<LiveEventView>(
      (out) => broadcast(CHANNELS.aiLive, { source, event: out }),
      (flush) => { setTimeout(flush, LIVE_FRAME_MS); },
    );
    liveBatchers.set(key, batcher);
  }
  batcher.push(event);
  if (event.kind === "end") liveBatchers.delete(key);
}

function activeProvider(): string {
  const value = currentSettings()["adcode.ai.provider"];
  return typeof value === "string" && value.length > 0 ? value : "tagflow";
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
  if (provider === "tagflow") return typeof value === "string" && tagflowCatalogue()?.models.some((model) => model.id === value) ? value : tagflowDefaultModel();
  if (typeof value === "string" && value.trim().length > 0) return value.trim();

  // The provider's recommended model, not whatever upstream happened to list first - for
  // OpenRouter that was a stealth preview that filled every reply with "I stopped at a limit".
  return recommendedModel(catalogue, provider, preferences) ?? DEFAULT_ANTHROPIC_MODEL;
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
export async function buildProvider(
  id: string,
  offeredKey?: string,
  source = "unknown",
  roleId?: string,
  /** The chat whose replies this provider writes: an included request is noted on that chat. */
  onIncludedRequest?: (requestId: string) => void,
): Promise<Provider | null> {
  if (id === "tagflow") return buildTagflowProvider(source, source === "chat" ? onIncludedRequest : undefined, roleId);
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
  // Every chat's work belongs to the folder being left - including a task waiting for
  // tomorrow's allowance - so all of it stops, and the threads go with the folder.
  for (const id of [...threads.keys()]) dropThread(id);
  chatCommands.stopAll();
  closeAgentBrowser();
}

/** The background commands, in a line for the host context, so a later turn knows they exist. */
function describeBackgroundCommands(): string | null {
  const running = chatCommands.list().filter((item) => item.running);
  if (running.length === 0) return null;
  return `Background commands still running: ${running.map((item) => `${item.id} (${item.command}${item.url === null ? "" : ` at ${item.url}`})`).join(", ")}. command_output reads them; stop_command ends one.`;
}

/** The chat's tools. `undo` is the turn recording the writes, read when each write lands. */
function toolRunner(undo: () => CheckpointTurn | null = () => null, sessionId: () => string | null = () => null) {
  return createAiToolRunner({
    openPreview: (path) => openAiPreview(broadcast, path),
    viewPage: (request, signal) => viewPage(request, { previewUrl: () => aiPreviewUrl(broadcast) }, signal),
    backgroundCommands: chatCommands,
    recordUndo: (path, before, after, encoding) => undo()?.record(path, before, after, encoding),
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
      undo()?.record(path, original, contents);
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
    askUser: (questions, signal) => {
      const id = sessionId();
      // A check agent with no conversation of its own has no card to draw in.
      if (id === null) return Promise.resolve(null);
      return askQuestionInWindows(id, questions, signal);
    },
  });
}

export async function aiStatus(): Promise<AiStatus> {
  void refreshIncludedAi();
  adoptCatalogue();

  const providers: AiProviderInfo[] = [];

  for (const known of catalogue) {
    const needsKey = !KEYLESS.has(known.id);
    const recommended = known.id === "tagflow" ? tagflowDefaultModel() : recommendedModel(catalogue, known.id, preferences);

    providers.push({
      id: known.id,
      displayName: known.name,
      // The recommended model first - it is what "Use this model" picks - then newest first.
      models: [...known.models]
        .sort((a, b) => Number(b.id === recommended) - Number(a.id === recommended))
        .map((model) => modelInfo(known.id, model, recommended)),
      hasKey: needsKey ? await keys.has(known.id) : true,
      needsKey,
      transport: known.id === "tagflow" ? "openai-compatible" : transportFor(known.id),
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
  // Discovery and keychain reads can finish after a migration or user selection. Read the
  // active route together with its model now, rather than returning the earlier provider.
  const provider = activeProvider();
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
  if (provider !== "tagflow" && provider.length > 0 && key.trim().length > 0) {
    await keys.set(provider, key.trim());
    invalidateChatAgents(provider);
  }
  return aiStatus();
}

export async function clearProviderKey(provider: string): Promise<AiStatus> {
  if (provider.length > 0) {
    await keys.clear(provider);
    invalidateChatAgents(provider);
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
    markAgentsForRebuild();
  }
}

/** The providers quick connect may select. Each has a built-in address and a model with tools. */
const QUICK_PROVIDERS = new Set(["google", "anthropic", "openai", "openrouter", "groq", "xai", "cerebras", "deepseek", "ollama"]);

/** The model quick connect picks when the caller does not name one: the provider's recommended one. */
function quickModelFor(providerId: string): string | null {
  return recommendedModel(catalogue, providerId, preferences);
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
    markAgentsForRebuild();
  }

  if (!KEYLESS.has(providerId)) await keys.set(providerId, trimmed);
  await writeSetting("adcode.ai.provider", providerId);
  await writeSetting("adcode.ai.model", chosen);
  invalidateChatAgents();
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
    ...(model.featured === true ? { featured: true } : {}),
    ...(model.note === undefined ? {} : { note: model.note }),
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
  return [...(memoryEnabled ? BUILT_IN_TOOLS : TOOLS_WITHOUT_MEMORY), ...ASSISTANT_EXTENSION_TOOLS, ...ADCODE_APP_TOOLS, BUILTIN_SKILL_TOOL];
}

/**
 * What a model costs, from the catalogue - never a guess. A model running on this machine
 * costs nothing; one the catalogue has no price for has no cost on the usage page.
 */
function usagePrice(providerId: string, model: string): UsagePrice | null {
  if (providerId === "ollama") return { inputMicrosPerMillion: 0, outputMicrosPerMillion: 0 };
  const found = providerIn(catalogue, providerId)?.models.find((candidate) => candidate.id === model);
  const input = found?.inputCostMicrosPerMillion;
  const output = found?.outputCostMicrosPerMillion;
  const cacheRead = found?.cacheReadCostMicrosPerMillion;
  return typeof input === "number" && typeof output === "number"
    ? { inputMicrosPerMillion: input, outputMicrosPerMillion: output, ...(typeof cacheRead === "number" ? { cacheReadMicrosPerMillion: cacheRead } : {}) }
    : null;
}

/** Count one request on the usage page. */
function noteUsage(source: UsageSource, providerId: string, model: string, event: { readonly inputTokens: number; readonly outputTokens: number; readonly cachedTokens?: number; readonly estimated: boolean }): void {
  recordAiUsage({
    source, provider: providerId, model, inputTokens: event.inputTokens, outputTokens: event.outputTokens,
    ...(event.cachedTokens === undefined ? {} : { cachedTokens: event.cachedTokens }),
    estimated: event.estimated, at: Date.now(), price: usagePrice(providerId, model),
  });
}

/** Read fresh on every call, so switching the design skill off applies to the next request. */
const designTasteOn = (): boolean => currentSettings()[DESIGN_TASTE_SETTING] !== false;

/** When and how far a conversation with this model compacts - read fresh, so a settings change applies at once. */
function compactionFor(providerId: string, model: string): AgentCompaction {
  return {
    contextWindow: () => contextWindowFor(catalogue, providerId, model),
    thresholdPercent: () => compactThreshold(currentSettings()),
  };
}

/**
 * A lean request's map of the project, from the same walk glob_files makes (ignored folders
 * skipped). Asked to fix `subtotal`, a 7B local model read a guessed `subtotal.js` and then
 * asked the user for the path; with the real paths in front of it, it opens `src/cart.js`.
 * Built at most every 15 seconds - context is assembled for every request of a turn.
 */
let leanFilesHint: { readonly root: string; readonly at: number; readonly text: string | null } | null = null;
async function projectFilesHint(root: string): Promise<string | null> {
  if (leanFilesHint !== null && leanFilesHint.root === root && Date.now() - leanFilesHint.at < 15_000) return leanFilesHint.text;
  const listed = await toolRunner()
    .run({ type: "tool-call", id: "lean-files", name: "glob_files", input: { pattern: "**/*" } }, new AbortController().signal)
    .catch(() => null);
  const files = listed === null || listed.isError || listed.content === "No files match that pattern."
    ? []
    : listed.content.split("\n").filter((line) => line.length > 0);
  const shown = files.slice(0, 60);
  const text = shown.length === 0
    ? null
    : `Project files${files.length > shown.length ? ` (the first ${shown.length} of ${files.length}${files.length >= 500 ? "+" : ""})` : ""}: ${shown.join(", ")}. Use these exact paths.`;
  leanFilesHint = { root, at: Date.now(), text };
  return text;
}

/**
 * The chat's agent: the one it has, or a new one when there is none or the model changed.
 *
 * A new model or provider takes the current history, including its summary and tool
 * steps. Provider-specific reasoning is removed. A reopened conversation or restart
 * starts from the saved summary and messages.
 * Returns what to tell the user when no agent can be built.
 */
async function ensureChatAgent(thread: ChatThread, providerId: string, model: string): Promise<Agent | string> {
  if (!thread.rebuild && thread.agent !== null && thread.agentProvider === providerId && thread.agentModel === model && thread.agentEndpoint === baseUrlOf(providerId)) {
    return thread.agent;
  }
  const provider = await buildProvider(providerId, undefined, "chat", undefined, (requestId) => {
    thread.includedRequestId = requestId;
    broadcast(CHANNELS.aiEvent, { kind: "included-request", requestId, sessionId: thread.session.id });
  });

  if (provider === null) {
    const name = providerIn(catalogue, providerId)?.name ?? providerId;
    // Two different failures, and the fix is different for each.
    return providerId === "custom" && baseUrlOf("custom") === null
      ? "No address for the custom endpoint. Set one in Connect a model."
      : `No API key for ${name}. Add one in Connect a model.`;
  }

  const carried = thread.agent === null ? null : historyForModelSwitch(thread.agent.history());
  /*
   * A model running on this computer gets the lean request from the first turn: the core
   * read, edit and run tools and a short prompt. Offered all of the tools, a 7B local model
   * (qwen2.5-coder, measured) spent a /fix writing invented memories and never opened the
   * file; with the core tools it reads, edits and runs the tests.
   */
  const lean = providerId === "ollama";
  // Sub-agents share this runner, so their edits land in the same undoable turn. A lean
  // (local) model is not offered them: it should not be juggling helpers.
  const runner = withBuiltinSkills(withAssistantExtensions(toolRunner(() => thread.checkpoint, () => thread.session.id)), designTasteOn);
  // The project's tool rules and hooks check every call exactly once: the chat's own calls
  // (delegate_task included) at its runner, each helper's at the helpers' runner.
  const rules = { root: () => thread.root, sessionId: () => thread.session.id };
  const helperRunner = withAgentRules(runner, { ...rules, agent: "helper" });
  const tools = lean ? chatTools() : [...chatTools(), DELEGATE_TASK];
  const context = async (): Promise<string> => {
      const root = thread.root;
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
        aiWorkspaceContext(root, blocker, thread.editorContext, configuredEditPolicy() === "review" ? "review" : "direct"),
        lean && root !== null ? await projectFilesHint(root) : null,
        root === null ? null : await projectInstructions(root, homedir(), lean),
        ...(root === null ? [] : [describePreviewForAi()]),
        describeBackgroundCommands(),
        // A lean request does not offer the guide's tool, so it is not told about the guide.
        lean ? null : builtinSkillGuidance(designTasteOn()),
        await agentRulesContext(root).catch(() => null),
        thread.startContext ?? null,
      ].filter((line): line is string => line !== null).join("\n");
  };
  const helper = (helperTools: readonly ToolDefinition[]): Agent => createAgent({
    provider, model, tools: helperTools, runner: helperRunner, context,
    effort: configuredEffort(), ...outputBudget(providerId, model), compaction: compactionFor(providerId, model),
  });
  const built = createAgent({
    provider,
    model,
    tools,
    lean: () => lean,
    effort: configuredEffort(),
    ...outputBudget(providerId, model),
    compaction: compactionFor(providerId, model),
    initialMessages: carried ?? restoreHistory(thread.session),
    context,
    runner: withAgentRules(withSubagents(runner, {
      start: (_task, helperTools) => helper(helperTools),
      tools: () => tools,
      status: (text) => thread.status?.(text),
      onEvent: (_task, event) => { if (event.kind === "usage") noteUsage("agents", providerId, model, event); },
    }), { ...rules, agent: "chat" }),
    beforeRequest: async () => {
      // Direct edits apply immediately, so there is no task to create and
      // no budget to reserve. The turn step limit remains the backstop
      // against runaway tool loops.
      return null;
    },
  });
  thread.agent = built;
  thread.rebuild = false;
  thread.agentProvider = providerId;
  thread.agentModel = model;
  thread.agentEndpoint = baseUrlOf(providerId);
  return built;
}

/**
 * Save a compaction with the conversation, so a reopened chat starts from the summary.
 *
 * The summary covers the transcript up to the oldest user turn the model kept - never the
 * newest one, so the request in flight always stays in the transcript itself.
 */
async function recordCompaction(thread: ChatThread, from: Agent, event: { readonly summary: string; readonly keptMessages: number }): Promise<void> {
  const turns = Math.max(1, keptUserTurns(from.history(), event.keptMessages));
  const compacted = withSummary(thread.session, { text: event.summary, coversUntil: summaryCoverage(thread.session.messages, turns), at: Date.now() });
  adoptSession(thread, compacted);
  await writeSession(thread.root, compacted);
  if (session?.id === compacted.id) broadcast(CHANNELS.aiSessionChanged, compacted);
}

/** Summarise the older part of the conversation now: `/compact`, or Compact now on the meter. */
export async function aiCompact(rawFocus: unknown): Promise<AiCompactResultView> {
  const focus = parseCompactFocus(rawFocus);
  if (focus === null) return { ok: false, message: "Keep the focus under 500 characters." };
  if (session === null || session.messages.length === 0) return { ok: false, message: "There is nothing to compact yet." };
  const chat = session;
  const thread = threadFor(chat);
  // Compacting is a turn of its own: it waits for this chat's answer, not for anyone else's.
  const begun = runs.begin(chat.id, chat.title, Date.now());
  if (!begun.ok) return { ok: false, message: runs.isRunning(chat.id) ? "Wait for the current answer to finish, then compact." : begun.reason };

  try {
    const providerId = activeProvider();
    const ready = await ensureChatAgent(thread, providerId, activeModel(providerId));
    if (typeof ready === "string") return { ok: false, message: ready };
    const outcome = await ready.compact(focus);
    if (!outcome.ok) return { ok: false, message: outcome.reason };
    await recordCompaction(thread, ready, outcome);
    broadcast(CHANNELS.aiEvent, { kind: "compacted", summary: outcome.summary, before: outcome.before, after: outcome.after, keptMessages: outcome.keptMessages, sessionId: chat.id });
    const usage = ready.contextUsage();
    if (usage !== null) broadcast(CHANNELS.aiEvent, { kind: "context", ...usage, sessionId: chat.id });
    recordDebug("info", "ai", `Compacted the conversation: about ${String(outcome.before)} to ${String(outcome.after)} tokens`);
    return { ok: true, message: "Earlier conversation compacted.", summary: outcome.summary };
  } finally {
    runs.end(chat.id);
  }
}

/** How full the chat on screen's context is, for the composer's meter. */
export function aiContextUsage(): AiContextUsageView {
  const providerId = activeProvider();
  const model = activeModel(providerId);
  const settings = currentSettings();
  const thread = shownThread();
  const agent = thread?.agent ?? null;
  const live = agent !== null && thread?.agentProvider === providerId && thread.agentModel === model ? agent.contextUsage() : null;
  return {
    tokens: live?.tokens ?? estimateTokens("", agent === null ? session === null ? [] : restoreHistory(session) : historyForModelSwitch(agent.history()), chatTools()),
    contextWindow: contextWindowFor(catalogue, providerId, model),
    thresholdPercent: compactThreshold({ ...settings, "adcode.ai.autoCompact": true }) ?? 80,
    autoCompact: settings["adcode.ai.autoCompact"] !== false,
  };
}


/** How many times stop hooks may send one message's agent back to work. */
const STOP_HOOK_ROUNDS = 3;

/** How one turn ended: done, or stopped by its step limit and to be picked up again by itself. */
type TurnOutcome =
  | { readonly kind: "done"; readonly ok: boolean; readonly ended: "finished" | "stopped" | "failed"; readonly answer?: string }
  | { readonly kind: "continue" };

/**
 * Send a message, and keep working on it until it is done.
 *
 * The turn runs in its conversation's own thread, so it goes on whatever the windows do: the
 * person opening another chat, starting a turn there too, minimising the app or closing the
 * tab. A turn that reaches its step limit is picked up again here, by itself, while Keep going
 * until done is on - not by the chat window, whose timers a browser slows when it is hidden.
 *
 * `sessionId` names a conversation that is not on screen (a follow-up queued in a chat that is
 * working in the background); without it the message goes to the one on screen.
 */
export async function aiSend(
  text: string,
  attachments: readonly AiAttachmentView[] = [],
  editor: AiEditorContextView | null = null,
  sessionId?: string,
): Promise<boolean> {
  let chat: ChatSession;
  if (sessionId !== undefined) {
    const named = threads.get(sessionId)?.session ?? (await aiSessions()).find((one) => one.id === sessionId) ?? null;
    if (named === null) throw new Error("That conversation is no longer here.");
    chat = named;
  } else {
    session ??= startSession();
    chat = session;
  }
  const thread = threadFor(chat);
  const begun = runs.begin(chat.id, chat.title, Date.now());
  if (!begun.ok) {
    // This conversation mid-turn: the composer queues the message and retries on these words.
    if (runs.isRunning(chat.id)) throw new Error("The built-in assistant is already handling a message in this conversation");
    broadcast(CHANNELS.aiEvent, { kind: "error", detail: begun.reason, sessionId: chat.id });
    return false;
  }
  thread.stopRequested = false;
  thread.hookAbort = new AbortController();
  announceRuns();
  let prompt = text;
  let files = attachments;
  let outcome: TurnOutcome = { kind: "done", ok: false, ended: "failed" };
  let stopHookRounds = 0;
  try {
    for (;;) {
      outcome = await runTurn(thread, prompt, files, editor);
      if (outcome.kind === "done") {
        // A stop hook that exits 2 sends the agent back to work with its reason - a few
        // times at most, so a check that can never pass cannot keep a chat busy for ever.
        if (!outcome.ok || thread.stopRequested || stopHookRounds >= STOP_HOOK_ROUNDS) break;
        const reason = await agentStopHooks(thread.root, { sessionId: chat.id, again: stopHookRounds > 0, lastMessage: outcome.answer ?? "" }, thread.hookAbort.signal)
          .catch((error: unknown) => {
            recordDebug("warn", "ai:hooks", `Stop hooks failed: ${error instanceof Error ? error.message : String(error)}`);
            return null;
          });
        if (reason === null || thread.stopRequested) break;
        stopHookRounds += 1;
        recordDebug("info", "ai:hooks", "A stop hook sent the agent back to work");
        prompt = `A stop hook in .adcode/settings.json did not let you finish yet. It said:\n${reason}\nFix what it reports, check it, then finish.`;
        files = [];
        continue;
      }
      if (thread.stopRequested) {
        // Stopped between two turns: the step-limit stop was never shown, so the stop is.
        chatEvents.push({ kind: "cancelled", sessionId: chat.id } as unknown as AgentEvent);
        outcome = { kind: "done", ok: false, ended: "stopped" };
        break;
      }
      prompt = CONTINUE_PROMPT;
      files = [];
    }
    return outcome.kind === "done" && outcome.ok;
  } finally {
    thread.hookAbort = null;
    const ended = outcome.kind === "done" ? outcome.ended : "stopped";
    // How it ended goes out before the run list drops it, so a chat that failed in the
    // background is marked as needing the person, not as done.
    chatEvents.push({ kind: "run-ended", ended, sessionId: chat.id } as unknown as AgentEvent);
    chatEvents.flush();
    runs.end(chat.id);
    announceRuns();
    announceFinishedUnseen(thread.session.title, ended);
  }
}

/** One turn of a conversation: the message, the model's work on it, and saving the result. */
async function runTurn(
  thread: ChatThread,
  text: string,
  attachments: readonly AiAttachmentView[],
  editor: AiEditorContextView | null,
): Promise<TurnOutcome> {
  const sessionId = thread.session.id;
  /** Every event names its conversation, and a running one keeps it for a chat opened later. */
  const send = (event: AgentEvent | { readonly kind: string; readonly [key: string]: unknown }): void => {
    const tagged = { ...event, sessionId };
    chatEvents.push(tagged as unknown as AgentEvent);
    runs.record(sessionId, tagged);
  };
  thread.editorContext = editor;
  thread.includedRequestId = undefined;
  thread.status = (status) => send({ kind: "status", text: status });
  currentTaskPrompt = text.slice(0, 200);
  try {
    const providerId = activeProvider();
    const model = activeModel(providerId);

    if (thread.startContext === undefined) {
      thread.startContext = null;
      thread.startContext = await agentSessionStart(thread.root, sessionId, thread.hookAbort?.signal ?? new AbortController().signal).catch((error: unknown) => {
        recordDebug("warn", "ai:hooks", `sessionStart hooks failed: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });
    }
    const ready = await ensureChatAgent(thread, providerId, model);
    if (typeof ready === "string") {
      send({ kind: "error", detail: ready });
      recordDebug("error", "ai", ready);
      recordMilestone("turn_failed");
      return { kind: "done", ok: false, ended: "failed" };
    }
    recordMilestone("prompt_sent");

    // Attachments ride this turn only. The session keeps names, not bytes: image
    // base64 in a session file would bloat history on disk and re-send stale
    // pixels on every restore, while the names still tell the story.
    const { images, documentText, names } = splitAttachments(attachments);
    // `/fix the login bug` is recorded as typed - the bubble and the title read that way -
    // and only the model is given the command's full instruction.
    const turnText = `${expandSlashCommand(text)}${documentText}`;
    const recordedText =
      names.length === 0 ? text : `${text}\n[Attached: ${names.join(", ")}]`;

    adoptSession(thread, withMessage(thread.session, { role: "user", text: recordedText, at: Date.now() }));
    let turnSession = thread.session;
    // Saved as the turn starts, not only when it ends: a new chat working in the background has
    // to be in the conversation list, or there is no way back to it until it finishes.
    await writeSession(thread.root, turnSession);
    announceRuns();

    let answer = "";
    let paragraphBreak = false;
    let turnSucceeded = true;
    let cancelled = false;
    let refused = false;
    let lastError: string | null = null;
    let modelTraceRecorded = false;
    const turnStarted = Date.now();
    let toolCalls = 0;
    let keepGoing = false;
    // Automatic mode writes as it goes; this turn's writes become one undoable checkpoint.
    const turnRoot = thread.root;
    thread.checkpoint = turnRoot !== null && configuredEditPolicy() === "trusted" ? checkpoints.open(turnRoot, turnSession.id) : null;
    recordDebug("info", "ai", `Turn started: ${providerId} / ${model}`);

    for await (const event of ready.send(turnText, { images })) {
      if (event.kind === "usage") {
        noteUsage("chat", providerId, model, event);
        continue;
      }
      // Out of steps with Keep going until done on: not an ending, the next turn picks it up.
      if (event.kind === "error" && !thread.stopRequested && shouldKeepGoing({
        detail: event.detail,
        keepGoing: currentSettings()["adcode.ai.keepGoing"] !== false,
        continued: runs.list().find((run) => run.sessionId === sessionId)?.continued ?? 0,
      })) {
        keepGoing = true;
        turnSucceeded = false;
        lastError = event.detail;
        send({ kind: "continuing", count: runs.noteContinued(sessionId), limit: KEEP_GOING_LIMIT });
        recordDebug("info", "ai", "Reached the step limit - keeping going");
        continue;
      }
      send(event);
      if (event.kind === "tool-draft") continue;
      if (event.kind === "compacted") {
        await recordCompaction(thread, ready, event);
        turnSession = thread.session;
      }
      // What the debug log keeps of a turn: which tools failed and why, and how it ended.
      // Never the prompt, the answer, or a file's contents.
      if (event.kind === "tool-call") toolCalls += 1;
      if (event.kind === "tool-result" && event.isError) recordDebug("warn", "ai:tool", `${event.name} failed: ${event.content.slice(0, 200)}`);
      if (event.kind === "error") {
        recordDebug("error", "ai", `${providerId} / ${model}: ${event.detail}`);
        // End this run on an account switch, then bind the next user turn to the new
        // account. A cached provider otherwise rejects every retry in this chat.
        if (/The signed-in account changed\./.test(event.detail)) thread.rebuild = true;
      }
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
      if (event.kind === "error") lastError = event.detail;
      if (event.kind === "refusal") refused = true;
    }
    chatEvents.flush();

    // How the turn ended, as one fixed word, for the admin panel's per-model health. Never
    // the prompt, the reply or the provider's own message.
    recordModelOutcome(
      providerId,
      model,
      cancelled ? "cancelled" : refused ? "refused" : lastError !== null ? outcomeOfError(lastError) : "ok",
      Date.now() - turnStarted,
    );

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
          send({
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
      turnSession = withMessage(thread.session, { role: "assistant", text: answer, at: Date.now(),...(thread.includedRequestId === undefined ? {} : { includedRequestId: thread.includedRequestId }) });
    } else {
      turnSession = thread.session;
    }

    await writeSession(turnRoot, turnSession);
    adoptSession(thread, turnSession);
    if (session?.id === turnSession.id) broadcast(CHANNELS.aiSessionChanged, session);
    const checkpoint = await (thread.checkpoint?.finish() ?? Promise.resolve(null)).catch(() => null);
    thread.checkpoint = null;
    if (checkpoint !== null) {
      broadcast(CHANNELS.aiCheckpoint, { ...checkpointView(checkpoint), sessionId });
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
    if (keepGoing) return { kind: "continue" };
    return { kind: "done", ok: turnSucceeded, ended: turnSucceeded ? "finished" : cancelled ? "stopped" : "failed", answer };
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
    const checkpoint = await (thread.checkpoint?.finish() ?? Promise.resolve(null)).catch(() => null);
    thread.checkpoint = null;
    if (checkpoint !== null) {
      broadcast(CHANNELS.aiCheckpoint, { ...checkpointView(checkpoint), sessionId });
    }
    send({ kind: "error", detail });
    recordMilestone("turn_failed");
    return { kind: "done", ok: false, ended: "failed" };
  } finally {
    currentTaskPrompt = null;
    thread.status = null;
  }
}

/** Restore only this project's recorded edits belonging to the requested conversation. */
export async function aiSessionCheckpoints(sessionId: string): Promise<AiCheckpointView[]> {
  const root = currentWorkspace()?.root ?? null;
  if (root === null || !/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) return [];
  const sessions = await readSessions(root);
  if (!sessions.some(session => session.id === sessionId)) return [];
  return checkpointsForSession(await checkpoints.list(root), sessions, sessionId).map(checkpointView);
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
  // Ghost text waits while chats work, so it does not compete with them for the rate limit.
  if (runs.list().length > 0 || input.prefix.trim().length === 0) return null;

  completionInFlight?.controller.abort();
  const controller = new AbortController();
  completionInFlight = { id: input.requestId, controller };

  try {
    const providerId = activeProvider();
    const provider = await buildProvider(providerId,undefined,"completion");
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
    const provider = await buildProvider(providerId,undefined,"edit");
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
    const provider = await buildProvider(input.route.providerId,undefined,"agent",input.context.role.id);
    if (provider === null) throw new Error(`No connection for ${input.route.providerId}`);
    const service = await readyAiWorkspaceService();
    const task = await service.read(input.childTaskId);
    if (task === null || task.sandbox === null) throw new Error("Team role workspace is unavailable");
    const fixedWorkspace = {
      taskId: task.id,
      sandboxRoot: join(app.getPath("userData"), "ai-workspaces", "sandboxes", task.id),
      humanRoot: task.workspaceRoot,
    };
    // Every agent shares the project's memory, as the chat does - unless capture is off.
    const memoryOn = currentSettings()["adcode.ai.memoryCapture"] !== false;
    const onTeam = input.kind === "team";
    const teamRecord = onTeam ? await (await readyAiTeamService()).read(input.teamId) : null;
    const roles = teamRecord?.plan.roles ?? [input.context.role];
    const labelFor = (roleId: string): string => roles.find((role) => role.id === roleId)?.label ?? roleId;
    const liveSource: LiveSourceView = {
      teamId: input.teamId,
      nodeId: input.node.id,
      roleId: input.context.role.id,
      label: input.context.role.label,
      model: input.route.modelId,
      kind: input.kind,
    };
    const live = (event: LiveEventView): void => broadcastLive(liveSource, event);
    const fileRunner = createAiToolRunner({
      workspace: async () => fixedWorkspace,
      workspaceUnavailableMessage: () => "This Team role's isolated workspace is unavailable.",
      memory: () => (memoryOn ? memoryForWorkspace() : null),
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
    const runner = createTeamRoleRunner({
      inner: fileRunner,
      teamId: input.teamId,
      roleId: input.context.role.id,
      roster: roles.map((role) => role.id),
      labelFor,
      mailbox: teamMailbox,
      overlaps: onTeam ? teamOverlaps : null,
      teamTools: onTeam,
      now: Date.now,
      onLive: live,
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
    // One working routine for every agent, so each one behaves like a professional on a
    // team: learn what is known, plan, keep teammates informed, prove it, report honestly.
    const routine = [
      ...(memoryOn ? ["Start with project_context to learn what this project has already decided, and record any new decision or gotcha with memory_write."] : []),
      "If the work has more than two steps, post your plan with update_plan and keep it current.",
      "Report only what your tool results show: never claim a check passed, a file changed or something works, and never claim ADCode lacks a feature, without a result that says so.",
      "Before you finish, prove it works: run the project's own checks that apply - its tests, type checker or linter (look in package.json or the equivalent) - with run_command, and fix any failure you caused. If there are none, say so plainly.",
    ];
    const teammates = roles.filter((role) => role.id !== input.context.role.id);
    // Read once per run: an agent's tools are fixed when it starts.
    const tasteOn = designTasteOn();
    // The project's own AGENTS.md binds Team and solo agents as much as the chat.
    const designGuidance = [builtinSkillGuidance(tasteOn), await projectInstructions(task.workspaceRoot, homedir())].filter((line): line is string => line !== null);
    const system = input.kind === "solo"
      ? [
        "You are an ADCode agent working on one task in an isolated copy of the project.",
        `Agent: ${input.context.role.label}`,
        `Your standing instructions: ${input.context.role.objective}`,
        "Do the task end to end with the file tools you have.",
        ...routine,
        ...designGuidance,
        "Finish with a concise summary of what you changed, how you checked it, and anything the user should check. Your edits are applied or reviewed when you finish.",
      ]
      : [
        "You are one isolated role inside an explicitly confirmed ADCode Team.",
        `Role: ${input.context.role.label} (id ${input.context.role.id})`,
        `Role objective: ${input.context.role.objective}`,
        `Your teammates, working at the same time: ${teammates.map((role) => `${role.label} (id ${role.id})`).join(", ") || "none"}.`,
        "Work only on this node. Use the isolated file tools; never assume another role's transcript.",
        "Talk to your teammates with message_teammate: tell them when you finish something they depend on (an API, a schema, a rename), and ask before changing a file their piece obviously owns. Their messages arrive with your tool results - follow them.",
        ...routine,
        ...designGuidance,
        "Finish with a concise outcome summary: what you changed and how you checked it. All edits remain review-only until the Team merge.",
      ];
    const planTool = access.tools.some((tool) => tool.name === UPDATE_PLAN.name) ? [] : [UPDATE_PLAN];
    const roleAgent = createAgent({
      provider: roleProvider,
      model: input.route.modelId,
      compaction: compactionFor(input.route.providerId, input.route.modelId),
      // The skill tool only reads text bundled with the app, so tool access does not gate it.
      tools: [...access.tools, ...planTool, ...(memoryOn ? MEMORY_TOOLS : []), ...(onTeam ? TEAM_TOOLS : []), ...(tasteOn ? [BUILTIN_SKILL_TOOL] : [])],
      // The project's tool rules and hooks bind Team and solo agents as they bind the chat.
      runner: withAgentRules(withBuiltinSkills(runner, () => tasteOn), { root: () => task.workspaceRoot, agent: input.kind === "solo" ? "agent" : "team", sessionId: () => task.id }),
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
    // The chat's live room shows this agent from its first step to its last.
    live({ kind: "start" });
    let liveOk = false;
    try {
      try {
        for await (const event of roleAgent.send(compactPrompt, { signal: local.signal })) {
          if (event.kind === "usage") {
            noteUsage("agents", input.route.providerId, input.route.modelId, event);
            continue;
          }
          const view = liveEventFrom(event);
          if (view !== null) live(view);
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
      liveOk = true;
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
    } finally {
      live({ kind: "end", ok: liveOk });
    }
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
const soloSettlements = new Map<string, Promise<void>>();

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
  if (started.plan.kind === "solo") {
    const settling = settleSoloRun(id, coordinator).finally(() => {
      if (soloSettlements.get(id) === settling) soloSettlements.delete(id);
    });
    soloSettlements.set(id, settling);
  }
  return teamView(started);
}

export async function aiTeamCancel(id: string): Promise<AiTeamView> {
  if ((await currentTeam(id)) === null) {
    throw new Error("That Team does not belong to the open workspace");
  }
  return teamView(await (await readyAiTeamCoordinator()).cancel(id));
}

export async function aiTeamRemove(id: string): Promise<boolean> {
  const team = await currentTeam(id);
  if (team === null) {
    throw new Error("That agent run does not belong to the open workspace");
  }
  if (["preparing", "running", "merging"].includes(team.state)) {
    throw new Error("Stop the agent before deleting its run.");
  }
  await soloSettlements.get(id);
  const removed = await (await readyAiTeamCoordinator()).remove(id);
  if (removed) {
    const timer = activityTimers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    activityTimers.delete(id);
    teamActivity.delete(id);
    teamTouched.delete(id);
    teamHolds.delete(id);
    teamMailbox.clear(id);
    teamOverlaps.clear(id);
    broadcast(CHANNELS.aiTeamRemoved, id);
    broadcast(CHANNELS.aiWorkspaceChanged, null);
  }
  return removed;
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

/** A key or model changed under every chat: each takes the new one on its next turn. */
function markAgentsForRebuild(): void {
  for (const thread of threads.values()) thread.rebuild = true;
}

/** Stop the chat on screen, or the one named. Every other chat keeps working. */
export function aiCancel(sessionId?: string): void {
  completionInFlight?.controller.abort();
  completionInFlight = null;
  const thread = sessionId === undefined ? shownThread() : threads.get(sessionId) ?? null;
  if (thread !== null) {
    thread.stopRequested = true;
    thread.agent?.cancel();
    thread.hookAbort?.abort();
  }
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
  // The conversation being put away keeps its thread: it may be working, and if it is not,
  // its agent still holds its history for when it is opened again.
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
