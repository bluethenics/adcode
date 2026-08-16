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
import { relative } from "node:path";
import { BrowserWindow } from "electron";
import {
  BUILT_IN_TOOLS,
  DEFAULT_ANTHROPIC_MODEL,
  TOOLS_WITHOUT_MEMORY,
  applyHunks,
  createAgent,
  createAnthropicProvider,
  createGoogleProvider,
  createOllamaProvider,
  createOpenAiProvider,
  type Agent,
  type Provider,
  type ProviderId,
} from "@adcode/ai";
import { CHANNELS, type AiProviderInfo, type AiStatus, type ProposedEditView } from "../shared/api.ts";
import { createKeychainStore } from "./keychain.ts";
import { createAiToolRunner, type ProposedEdit } from "./aiTools.ts";
import { memoryForWorkspace } from "./memory.ts";
import { currentSettings } from "./settings.ts";
import { currentWorkspace, writeTextFile } from "./workspace.ts";

const keys = createKeychainStore();

/** Ollama runs on the user's own machine, so it is the one provider needing no key. */
const NEEDS_KEY: Readonly<Record<ProviderId, boolean>> = {
  anthropic: true,
  openai: true,
  google: true,
  ollama: false,
};

const MODELS: Readonly<Record<ProviderId, readonly string[]>> = {
  anthropic: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
  openai: ["gpt-5", "gpt-5-mini", "o4-mini"],
  google: ["gemini-2.5-pro", "gemini-2.5-flash"],
  ollama: ["qwen2.5-coder", "llama3.1", "deepseek-coder-v2"],
};

const DISPLAY: Readonly<Record<ProviderId, string>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  ollama: "Local (Ollama)",
};

const PROVIDERS: readonly ProviderId[] = ["anthropic", "openai", "google", "ollama"];

/** Proposals awaiting review, keyed by path. Nothing here has touched disk (§5.3). */
const pendingEdits = new Map<string, ProposedEdit>();

let agent: Agent | null = null;
let agentProvider: ProviderId | null = null;
let agentModel: string | null = null;

function broadcast(channel: string, ...args: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, ...args);
  }
}

function activeProvider(): ProviderId {
  const value = currentSettings()["adcode.ai.provider"];
  return typeof value === "string" && PROVIDERS.includes(value as ProviderId)
    ? (value as ProviderId)
    : "anthropic";
}

function activeModel(provider: ProviderId): string {
  const value = currentSettings()["adcode.ai.model"];
  const models = MODELS[provider];

  if (typeof value === "string" && models.includes(value)) return value;
  return models[0] ?? DEFAULT_ANTHROPIC_MODEL;
}

async function buildProvider(id: ProviderId): Promise<Provider | null> {
  if (id === "ollama") return createOllamaProvider();

  const key = await keys.get(id);
  if (key === null) return null;

  if (id === "anthropic") return createAnthropicProvider({ apiKey: key });
  if (id === "openai") return createOpenAiProvider(key);
  return createGoogleProvider({ apiKey: key });
}

function toolRunner() {
  return createAiToolRunner({
    workspaceRoot: () => currentWorkspace()?.root ?? null,
    memory: () => memoryForWorkspace(),
    onProposedEdit: (edit) => {
      pendingEdits.set(edit.path, edit);

      const root = currentWorkspace()?.root;
      const view: ProposedEditView = {
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
  for (const id of PROVIDERS) {
    providers.push({
      id,
      displayName: DISPLAY[id],
      models: MODELS[id],
      hasKey: NEEDS_KEY[id] ? await keys.has(id) : true,
      needsKey: NEEDS_KEY[id],
    });
  }

  return {
    providers,
    activeProvider: provider,
    activeModel: activeModel(provider),
    ready: providers.find((p) => p.id === provider)?.hasKey ?? false,
  };
}

export async function setProviderKey(provider: string, key: string): Promise<AiStatus> {
  if (PROVIDERS.includes(provider as ProviderId) && key.trim().length > 0) {
    await keys.set(provider as ProviderId, key.trim());
    agent = null;
  }
  return aiStatus();
}

export async function clearProviderKey(provider: string): Promise<AiStatus> {
  if (PROVIDERS.includes(provider as ProviderId)) {
    await keys.clear(provider as ProviderId);
    agent = null;
  }
  return aiStatus();
}

/**
 * Send a turn, streaming every event to the renderer as it happens.
 *
 * The events are what §5.3's trace widget renders: "which tool it called, which file it
 * read, which command it ran, what it decided. This is what makes the AI legible instead
 * of magical."
 */
export async function aiSend(text: string): Promise<void> {
  try {
    const providerId = activeProvider();
    const model = activeModel(providerId);

    // Rebuild when the user switches provider or model - §5.2's runtime choice - but
    // keep the agent otherwise so the conversation survives.
    if (agent === null || agentProvider !== providerId || agentModel !== model) {
      const provider = await buildProvider(providerId);

      if (provider === null) {
        broadcast(CHANNELS.aiEvent, {
          kind: "error",
          detail: `No API key for ${DISPLAY[providerId]}. Add one in Settings.`,
        });
        return;
      }

      const memoryEnabled = currentSettings()["adcode.ai.memoryCapture"] !== false;

      agent = createAgent({
        provider,
        model,
        tools: memoryEnabled ? BUILT_IN_TOOLS : TOOLS_WITHOUT_MEMORY,
        runner: toolRunner(),
      });
      agentProvider = providerId;
      agentModel = model;
    }

    for await (const event of agent.send(text)) {
      broadcast(CHANNELS.aiEvent, event);
    }
  } catch (error) {
    // §9: a failure here costs an answer, never the editor.
    broadcast(CHANNELS.aiEvent, {
      kind: "error",
      detail: error instanceof Error ? error.message : "the assistant failed",
    });
  }
}

export function aiCancel(): void {
  agent?.cancel();
}

export function aiReset(): void {
  agent?.reset();
  pendingEdits.clear();
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

  pendingEdits.delete(path);
  if (acceptedHunkIds.length === 0) return true;

  const next = applyHunks(edit.original, edit.hunks, acceptedHunkIds);
  const result = await writeTextFile(path, next);
  return result.ok;
}
