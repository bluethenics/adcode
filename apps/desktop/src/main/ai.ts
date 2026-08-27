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
import { join, relative } from "node:path";
import { app, BrowserWindow } from "electron";
import {
  BUILT_IN_TOOLS,
  BUNDLED_CATALOGUE,
  DEFAULT_ANTHROPIC_MODEL,
  SNAPSHOT_TAKEN_ON,
  TOOLS_WITHOUT_MEMORY,
  applyHunks,
  baseUrlFor,
  createAgent,
  createAnthropicProvider,
  createGoogleProvider,
  createOpenAiCompatibleProvider,
  estimateRequestTokens,
  mergeCatalogue,
  parseCatalogue,
  providerIn,
  transportFor,
  type Agent,
  type AiWorkspaceTask,
  titleFor,
  withMessage,
  type CatalogueProvider,
  type ChatSession,
  type Provider,
} from "@adcode/ai";
import {
  CHANNELS,
  type AiKeyCheck,
  type AiWorkspaceActionView,
  type AiWorkspaceApplySelectionView,
  type AiWorkspaceChangeView,
  type AiProviderInfo,
  type AiStatus,
  type AiWorkspaceTaskView,
  type AiWorkspaceTraceView,
  type ProposedEditView,
} from "../shared/api.ts";
import { recordAgentEdit } from "./activity.ts";
import { createKeychainStore } from "./keychain.ts";
import { createAiToolRunner, type ProposedEdit } from "./aiTools.ts";
import { memoryForWorkspace } from "./memory.ts";
import { currentSettings } from "./settings.ts";
import { currentWorkspace } from "./workspace.ts";
import { clearSessions, deleteSession, readSessions, writeSession } from "./aiSessions.ts";
import { createAiWorkspaceService, type AiWorkspaceService } from "./aiWorkspaceService.ts";
import { normalizeForCompare } from "./pathSafety.ts";
import { recoverableDrafts } from "./history.ts";
import { workspaceHasUnsavedDraft } from "./aiWorkspaceDrafts.ts";
import {
  toAiWorkspaceActionView,
  toAiWorkspaceChangeViews,
  toAiWorkspaceTaskView,
  toAiWorkspaceTraceView,
} from "./aiWorkspaceViews.ts";

const keys = createKeychainStore();

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
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return;

    const live = parseCatalogue(await response.json());
    if (live.length === 0) return;

    catalogue = mergeCatalogue(BUNDLED_CATALOGUE, live);
    catalogueIsLive = true;
  } catch {
    // The snapshot is already loaded. Nothing to say.
  }
}

/** Where a provider's API lives: the catalogue's address, or the user's own. */
function baseUrlOf(providerId: string): string | null {
  if (providerId === "custom") {
    const custom = currentSettings()["adcode.ai.customBaseUrl"];
    const trimmed = typeof custom === "string" ? custom.trim().replace(/\/+$/, "") : "";
    return trimmed.length === 0 ? null : trimmed;
  }

  return baseUrlFor(providerId);
}

/** Proposals awaiting review, keyed by path. Nothing here has touched disk (§5.3). */
const pendingEdits = new Map<string, ProposedEdit>();
let activeTaskId: string | null = null;
let currentTaskPrompt: string | null = null;
let taskService: AiWorkspaceService | null = null;
let taskRecovery: Promise<void> | null = null;
let taskWorkspaceUnavailableReason: string | null = null;

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

function announceWorkspaceTask(task: Parameters<typeof toAiWorkspaceTaskView>[0]): void {
  broadcast(CHANNELS.aiWorkspaceChanged, toAiWorkspaceTaskView(task));
}

function belongsToCurrentWorkspace(task: AiWorkspaceTask): boolean {
  const root = currentWorkspace()?.root;
  return root !== undefined && normalizeForCompare(root) === normalizeForCompare(task.workspaceRoot);
}

async function currentWorkspaceTask(taskId: string): Promise<AiWorkspaceTask | null> {
  const task = await (await readyAiWorkspaceService()).read(taskId);
  return task !== null && belongsToCurrentWorkspace(task) ? task : null;
}

const REUSABLE_TASK_STATES = new Set(["ready", "running", "paused", "review", "conflict"]);

async function ensureToolWorkspace() {
  const human = currentWorkspace()?.root ?? null;
  taskWorkspaceUnavailableReason = null;
  if (human === null) {
    taskWorkspaceUnavailableReason = "Open a folder before using AI file tools.";
    return null;
  }
  if (currentSettings()["adcode.ai.isolatedWorkspaces"] === false) {
    taskWorkspaceUnavailableReason = "AI file tools are off because Isolate AI edits is disabled in Settings.";
    return null;
  }
  if (workspaceHasUnsavedDraft(human, await recoverableDrafts())) {
    taskWorkspaceUnavailableReason =
      "Save your open file changes before starting AI file tools, so the isolated task begins from what you see.";
    return null;
  }

  const service = await readyAiWorkspaceService();
  let task = activeTaskId === null ? null : await service.read(activeTaskId);
  if (
    task === null ||
    normalizeForCompare(task.workspaceRoot) !== normalizeForCompare(human) ||
    !REUSABLE_TASK_STATES.has(task.state)
  ) {
    task = await service.start({
      workspaceRoot: human,
      prompt: currentTaskPrompt ?? "Continue the assistant task",
      tokenLimit: configuredTaskTokenBudget(),
    });
    activeTaskId = task.id;
    announceWorkspaceTask(task);
  }

  return {
    taskId: task.id,
    sandboxRoot: join(app.getPath("userData"), "ai-workspaces", "sandboxes", task.id),
    humanRoot: human,
  };
}

function configuredTaskTokenBudget(): number {
  const value = currentSettings()["adcode.ai.taskTokenBudget"];
  return value === "25000" || value === "250000" ? Number(value) : 100_000;
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
  const value = currentSettings()["adcode.ai.model"];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();

  const known = providerIn(catalogue, provider);
  return known?.models[0]?.id ?? DEFAULT_ANTHROPIC_MODEL;
}

/**
 * A client for whichever provider is selected.
 *
 * Two first-class clients - Anthropic and Google, which do not speak the OpenAI wire format
 * - and everything else through one OpenAI-compatible client pointed at a different address.
 * That is what makes hundreds of providers reachable without hundreds of adapters, and it
 * is the same mechanism the custom endpoint uses.
 */
async function buildProvider(id: string): Promise<Provider | null> {
  const key = KEYLESS.has(id) ? "" : ((await keys.get(id)) ?? "");
  if (!KEYLESS.has(id) && key.length === 0 && id !== "custom") return null;

  if (id === "anthropic") return createAnthropicProvider({ apiKey: key });
  if (id === "google") return createGoogleProvider({ apiKey: key });

  const baseUrl = baseUrlOf(id);
  if (baseUrl === null) return null;

  const known = providerIn(catalogue, id);

  return createOpenAiCompatibleProvider({
    id,
    displayName: known?.name ?? id,
    baseUrl,
    apiKey: key,
    models: (known?.models ?? []).map((model) => model.id),
  });
}

function toolRunner() {
  return createAiToolRunner({
    workspace: ensureToolWorkspace,
    workspaceUnavailableMessage: () =>
      taskWorkspaceUnavailableReason ?? "No folder is open, so there is nothing to work on yet.",
    memory: () => memoryForWorkspace(),
    writeSandboxFile: async (path, contents) => {
      if (activeTaskId === null) throw new Error("Task workspace is unavailable");
      const task = await (await readyAiWorkspaceService()).write(activeTaskId, path, contents);
      announceWorkspaceTask(task);
      const change = task.changes.find((item) => item.path === path);
      if (change === undefined) throw new Error("Task change was not recorded");
      return change;
    },
    onProposedEdit: (edit) => {
      pendingEdits.set(edit.path, edit);

      const root = currentWorkspace()?.root;
      const view: ProposedEditView = {
        taskId: edit.taskId,
        relativePath: edit.relativePath,
        path: edit.path,
        displayPath: root === undefined ? edit.path : relative(root, edit.path),
        summary: edit.summary,
        hunks: edit.hunks.map((hunk) => ({
          id: hunk.id,
          startLine: hunk.startLine,
          original: hunk.original,
          replacement: hunk.replacement,
        })),
      };

      broadcast(CHANNELS.aiProposedEdit, view);
    },
  });
}

export async function aiStatus(): Promise<AiStatus> {
  const provider = activeProvider();

  const providers: AiProviderInfo[] = [];

  for (const known of catalogue) {
    const needsKey = !KEYLESS.has(known.id);

    providers.push({
      id: known.id,
      displayName: known.name,
      models: known.models.map((model) => ({
        id: model.id,
        name: model.name,
        toolCall: model.toolCall,
        reasoning: model.reasoning,
      })),
      hasKey: needsKey ? await keys.has(known.id) : true,
      needsKey,
      transport: transportFor(known.id),
      doc: known.doc,
    });
  }

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

  const active = providers.find((one) => one.id === provider);

  return {
    providers,
    activeProvider: provider,
    activeModel: activeModel(provider),
    // Ready means a turn would actually reach something: a key where one is needed, and an
    // address where the provider is the custom one.
    ready:
      (active?.hasKey ?? false) &&
      (provider !== "custom" || customUrl !== null),
    customBaseUrl: customUrl ?? "",
    catalogueTakenOn: SNAPSHOT_TAKEN_ON,
    catalogueIsLive,
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
  const previous = await keys.get(providerId);
  if (trimmed.length > 0) await keys.set(providerId, trimmed);

  try {
    const provider = await buildProvider(providerId);
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
    // A failed check must not leave a bad key behind where a good one was.
    if (trimmed.length > 0 && previous !== null) await keys.set(providerId, previous);
    agent = null;
  }
}

/**
 * Send a turn, streaming every event to the renderer as it happens.
 *
 * The events are what §5.3's trace widget renders: "which tool it called, which file it
 * read, which command it ran, what it decided. This is what makes the AI legible instead
 * of magical."
 */
export async function aiSend(text: string): Promise<void> {
  currentTaskPrompt = text;
  try {
    const providerId = activeProvider();
    const model = activeModel(providerId);

    // Rebuild when the user switches provider or model - §5.2's runtime choice - but
    // keep the agent otherwise so the conversation survives.
    if (agent === null || agentProvider !== providerId || agentModel !== model) {
      const provider = await buildProvider(providerId);

      if (provider === null) {
        const name = providerIn(catalogue, providerId)?.name ?? providerId;
        // Two different failures, and the fix is different for each.
        const detail =
          providerId === "custom" && baseUrlOf("custom") === null
            ? "No address for the custom endpoint. Set one in Connect a model."
            : `No API key for ${name}. Add one in Connect a model.`;

        broadcast(CHANNELS.aiEvent, { kind: "error", detail });
        return;
      }

      const memoryEnabled = currentSettings()["adcode.ai.memoryCapture"] !== false;

      agent = createAgent({
        provider,
        model,
        tools: memoryEnabled ? BUILT_IN_TOOLS : TOOLS_WITHOUT_MEMORY,
        runner: toolRunner(),
        beforeRequest: async (request) => {
          // Chat without an open project remains available. With a project, every model
          // round-trip reserves a conservative maximum before it can spend the user's key.
          if (currentWorkspace() === null || currentSettings()["adcode.ai.isolatedWorkspaces"] === false) {
            return null;
          }
          const workspace = await ensureToolWorkspace();
          if (workspace === null) {
            // A question-only chat still works before a task exists. Once a task exists,
            // a new unsaved draft pauses its next provider turn instead of letting the
            // agent continue from a stale filesystem snapshot.
            return activeTaskId === null ? null : taskWorkspaceUnavailableReason;
          }
          const reserved = await (await readyAiWorkspaceService()).reserveUsage(workspace.taskId, {
            tokens: estimateRequestTokens(request),
            costMicros: 0,
          });
          announceWorkspaceTask(reserved.task);
          return reserved.ok
            ? null
            : reserved.reason === "token-limit"
              ? "Task token budget reached. Increase it in Settings or start a new task."
              : "Task cost budget reached. Increase it in Settings or start a new task.";
        },
      });
      agentProvider = providerId;
      agentModel = model;
    }

    session ??= startSession();
    session = withMessage(session, { role: "user", text, at: Date.now() });

    let answer = "";

    for await (const event of agent.send(text)) {
      broadcast(CHANNELS.aiEvent, event);
      if (event.kind === "text") answer += event.text;
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
  } catch (error) {
    // §9: a failure here costs an answer, never the editor.
    broadcast(CHANNELS.aiEvent, {
      kind: "error",
      detail: error instanceof Error ? error.message : "the assistant failed",
    });
  } finally {
    currentTaskPrompt = null;
  }
}

export function aiCancel(): void {
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
  agent?.reset();
  if (activeTaskId !== null) {
    const taskId = activeTaskId;
    void readyAiWorkspaceService()
      .then((service) => service.pause(taskId))
      .then((task) => {
        if (task !== null) announceWorkspaceTask(task);
      });
  }
  pendingEdits.clear();
  activeTaskId = null;
  session = null;
}

/**
 * Apply the hunks the user accepted, and only those.
 *
 * This is the single point where a model-authored change reaches disk, and it happens
 * only after the user has seen it (§5.3). Accepting nothing writes nothing.
 */
export async function aiApplyHunks(path: string, acceptedHunkIds: readonly string[]): Promise<boolean> {
  const edit = pendingEdits.get(path);
  if (edit === undefined) return false;
  if ((await currentWorkspaceTask(edit.taskId)) === null) return false;

  if (acceptedHunkIds.length === 0) {
    try {
      const service = await readyAiWorkspaceService();
      await service.reject(edit.taskId, edit.relativePath);
      const task = await service.read(edit.taskId);
      if (task !== null) announceWorkspaceTask(task);
      pendingEdits.delete(path);
      return true;
    } catch {
      return false;
    }
  }

  const next = applyHunks(edit.original, edit.hunks, acceptedHunkIds);
  const result = await (await readyAiWorkspaceService()).apply(edit.taskId, [
    { path: edit.relativePath, acceptedHunkIds },
  ]);
  announceWorkspaceTask(result.task);

  if (result.ok) {
    pendingEdits.delete(path);
    // Counted here because this is the only place a model-authored change reaches disk.
    // The number is the growth in the file, not the size of the hunks: a hunk that
    // replaces twenty lines with twenty-one added one character of the agent's work, and
    // reporting twenty-one would credit it with the twenty the person had already
    // written. Only what the agent added is the agent's.
    recordAgentEdit({
      chars: Math.max(0, next.length - edit.original.length),
      acceptedEdits: acceptedHunkIds.length,
      rejectedEdits: edit.hunks.length - acceptedHunkIds.length,
    });
  }

  return result.ok;
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
  if ((await currentWorkspaceTask(taskId)) === null) return [];
  return (await (await readyAiWorkspaceService()).traces(taskId)).map(toAiWorkspaceTraceView);
}

export async function aiWorkspaceApply(
  taskId: string,
  selections: readonly AiWorkspaceApplySelectionView[],
): Promise<AiWorkspaceActionView> {
  if ((await currentWorkspaceTask(taskId)) === null) throw new Error("Task is not in the open workspace");
  const result = await (await readyAiWorkspaceService()).apply(taskId, selections);
  announceWorkspaceTask(result.task);
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

export async function aiWorkspaceRollback(taskId: string): Promise<AiWorkspaceActionView> {
  if ((await currentWorkspaceTask(taskId)) === null) throw new Error("Task is not in the open workspace");
  const result = await (await readyAiWorkspaceService()).rollback(taskId);
  announceWorkspaceTask(result.task);
  return toAiWorkspaceActionView(result);
}
