/**
 * Provider-neutral types for the AI layer. No logic.
 *
 * Brief §5.2: "an in-process agent loop with BYO API keys for Anthropic, OpenAI, Google,
 * and a local endpoint (Ollama or compatible)... The provider is a runtime choice, not a
 * build-time one." These types are the seam that makes that true - the agent loop knows
 * only this vocabulary, and each provider adapter translates its own wire format into it.
 */

/**
 * A provider's id.
 *
 * Open-ended on purpose. It used to be a union of four, which made the set of usable
 * providers a build-time decision - and the catalogue has nearly two hundred, growing
 * without this editor shipping again. The four named here are the ones with a first-class
 * client; the template keeps them discoverable in an editor without closing the type.
 */
export type ProviderId = "anthropic" | "openai" | "google" | "ollama" | (string & {});

export interface ModelChoice {
  readonly provider: ProviderId;
  readonly model: string;
}

/* ── Conversation ───────────────────────────────────────────────────────── */

export type Role = "user" | "assistant";

export interface TextBlock {
  readonly type: "text";
  readonly text: string;
}

export interface ToolCallBlock {
  readonly type: "tool-call";
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export interface ToolResultBlock {
  readonly type: "tool-result";
  readonly toolCallId: string;
  readonly content: string;
  readonly isError: boolean;
}

export type ContentBlock = TextBlock | ToolCallBlock | ToolResultBlock;

export interface Message {
  readonly role: Role;
  readonly content: readonly ContentBlock[];
}

/* ── Tools ──────────────────────────────────────────────────────────────── */

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the tool's arguments. */
  readonly inputSchema: Record<string, unknown>;
  /**
   * Whether this tool changes anything the user would want to see first.
   * §5.3: "Nothing is ever written to disk unseen" - a mutating tool's result goes
   * through the inline diff widget rather than straight to the filesystem.
   */
  readonly mutating: boolean;
}

export interface ToolRunner {
  run(call: ToolCallBlock, signal: AbortSignal): Promise<{ content: string; isError: boolean }>;
}

/* ── Streaming ──────────────────────────────────────────────────────────── */

/**
 * What the agent emits as it works.
 *
 * §5.3's trace widget is the reason this is an event stream rather than a promise:
 * "shows the agent's *workings*, live: which tool it called, which file it read, which
 * command it ran, what it decided. This is what makes the AI legible instead of magical,
 * and it is what a developer will judge the feature on."
 */
export type AgentEvent =
  | { readonly kind: "text"; readonly text: string }
  /** A summary of the model's reasoning, where the provider exposes one. */
  | { readonly kind: "thinking"; readonly text: string }
  | { readonly kind: "tool-call"; readonly call: ToolCallBlock }
  | {
      readonly kind: "tool-result";
      readonly toolCallId: string;
      readonly name: string;
      readonly content: string;
      readonly isError: boolean;
    }
  | { readonly kind: "turn-end"; readonly reason: StopReason }
  /** The provider declined. Not an error - a normal, reportable outcome. */
  | { readonly kind: "refusal"; readonly detail: string }
  /** §9: the AI layer degrades; it never throws into the editor. */
  | { readonly kind: "error"; readonly detail: string }
  | { readonly kind: "cancelled" };

export type StopReason = "end-turn" | "tool-use" | "max-tokens" | "refusal" | "cancelled";

export interface ProviderRequest {
  readonly model: string;
  readonly system: string;
  readonly messages: readonly Message[];
  readonly tools: readonly ToolDefinition[];
  readonly maxTokens: number;
}

/** What a provider adapter yields. The agent loop turns these into `AgentEvent`s. */
export type ProviderEvent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "thinking"; readonly text: string }
  | { readonly kind: "tool-call"; readonly call: ToolCallBlock }
  | { readonly kind: "stop"; readonly reason: StopReason; readonly detail?: string };

export interface Provider {
  readonly id: ProviderId;
  readonly displayName: string;
  /** Models this provider offers, most capable first. */
  readonly models: readonly string[];
  stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
}

/** Where a provider's key comes from. Never settings JSON (§5.2). */
export interface KeyStore {
  get(provider: ProviderId): Promise<string | null>;
  set(provider: ProviderId, key: string): Promise<void>;
  clear(provider: ProviderId): Promise<void>;
  has(provider: ProviderId): Promise<boolean>;
}
