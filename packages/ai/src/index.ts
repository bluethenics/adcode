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
export * from "./toolAccess.ts";
export * from "./teamGraph.ts";
export * from "./routing.ts";
export * from "./teamBudget.ts";
export * from "./teamMerge.ts";
export * from "./automation.ts";
export * from "./continuation.ts";
export * from "./terminalTeam.ts";
export * from "./adapter.ts";

export {
  closeOpenToolCalls,
  createAgent,
  estimateRequestTokens,
  MAX_TURNS,
  type Agent,
  type AgentCompaction,
  type AgentDeps,
  type CompactOutcome,
} from "./agent.ts";
export { computeHunks, applyHunks, type Hunk } from "./diff.ts";
export {
  IDLE_MS,
  MAX_INLINE_COMPLETION_CHARS,
  decideCompletion,
  initialCompletionState,
  normalizeInlineCompletion,
  type CompletionDecision,
  type CompletionEffect,
  type CompletionEvent,
  type CompletionState,
  type Suggestion,
} from "./completion.ts";

export {
  BUILT_IN_TOOLS,
  TOOLS_WITHOUT_MEMORY,
  AGENT_RUN_TOOLS,
  RUN_COMMAND_FOREGROUND,
  COMMAND_OUTPUT,
  STOP_COMMAND,
  MOVE_FILE,
  DELETE_FILE,
  OPEN_PREVIEW,
  VIEW_PAGE,
  UPDATE_PLAN,
  LIST_FILES,
  MEMORY_SEARCH,
  MEMORY_WRITE,
  PROJECT_CONTEXT,
  PROPOSE_EDIT,
  EDIT_FILE,
  READ_FILE,
  SEARCH,
  GLOB_FILES,
  GET_OUTLINE,
  RUN_COMMAND,
  FETCH_URL,
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
  DEFAULT_CONTEXT_WINDOW,
  SNAPSHOT_TAKEN_ON,
  RECOMMENDED_MODELS,
  baseUrlFor,
  contextWindowOf,
  isUsableModel,
  mergeCatalogue,
  parseCatalogue,
  providerIn,
  recommendedModel,
  searchCatalogue,
  traitsOf,
  transportFor,
  usableCatalogue,
  type CatalogueModel,
  type CatalogueProvider,
  type Transport,
} from "./catalogue.ts";
export { effortFor } from "./effort.ts";
export {
  EMPTY_OVERRIDES,
  applyOverrides,
  modelKey,
  parseOverrides,
  preferencesWith,
  type AddedModel,
  type CatalogueOverrides,
} from "./catalogueOverrides.ts";
export { allowedOutputSize } from "./outputSize.ts";
export { THINKING_FILLED_ALLOWANCE } from "./agent.ts";

export {
  pruneSessions,
  searchSessions,
  sortSessions,
  titleFor,
  validateSession,
  withMessage,
  withSummary,
  summaryCoverage,
  restoreHistory,
  type ChatMessage,
  type ChatRole,
  type ChatSession,
  type ChatSummary,
} from "./sessions.ts";

export * from "./connections.ts";
export * from "./requestScheduler.ts";
export * from "./requestSize.ts";
export * from "./compaction.ts";

export {
  buildInlineEditRequest,
  cleanInlineEditAnswer,
  INLINE_EDIT_CONTEXT_CHARS,
  INLINE_EDIT_MAX_SELECTION,
  type InlineEditInput,
} from "./inlineEdit.ts";
