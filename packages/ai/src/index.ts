/**
 * The AI layer: a provider-neutral agent loop, inline diff, and completion scheduling.
 *
 * No Electron, no DOM, no Monaco - so the parts that carry the hardest guarantees (§1's
 * "no AI feature may block a keystroke" and §5.3's "nothing is ever written to disk
 * unseen") are testable without launching an editor.
 */
export * from "./types.ts";
export * from "./workspaces.ts";
export * from "./team.ts";
export * from "./teamGraph.ts";

export {
  createAgent,
  estimateRequestTokens,
  MAX_TURNS,
  type Agent,
  type AgentDeps,
} from "./agent.ts";
export { computeHunks, applyHunks, type Hunk } from "./diff.ts";
export {
  IDLE_MS,
  decideCompletion,
  initialCompletionState,
  type CompletionDecision,
  type CompletionEffect,
  type CompletionEvent,
  type CompletionState,
  type Suggestion,
} from "./completion.ts";

export {
  BUILT_IN_TOOLS,
  TOOLS_WITHOUT_MEMORY,
  LIST_FILES,
  MEMORY_SEARCH,
  MEMORY_WRITE,
  PROJECT_CONTEXT,
  PROPOSE_EDIT,
  READ_FILE,
  SEARCH,
} from "./tools.ts";

export {
  createAnthropicProvider,
  ANTHROPIC_MODELS,
  DEFAULT_ANTHROPIC_MODEL,
} from "./providers/anthropic.ts";
export {
  createOpenAiCompatibleProvider,
  createOpenAiProvider,
  createOllamaProvider,
  OPENAI_MODELS,
  OLLAMA_MODELS,
  OPENAI_BASE_URL,
  OLLAMA_BASE_URL,
} from "./providers/openaiCompatible.ts";
export { createGoogleProvider, GOOGLE_MODELS, GOOGLE_BASE_URL } from "./providers/google.ts";

export {
  BUNDLED_CATALOGUE,
  SNAPSHOT_TAKEN_ON,
  baseUrlFor,
  mergeCatalogue,
  parseCatalogue,
  providerIn,
  searchCatalogue,
  transportFor,
  type CatalogueModel,
  type CatalogueProvider,
  type Transport,
} from "./catalogue.ts";

export {
  pruneSessions,
  searchSessions,
  sortSessions,
  titleFor,
  validateSession,
  withMessage,
  type ChatMessage,
  type ChatRole,
  type ChatSession,
} from "./sessions.ts";
