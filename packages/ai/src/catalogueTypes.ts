/**
 * What a provider and a model are, in the catalogue.
 *
 * Their own file so that the generated snapshot can be typed without importing the module
 * that reads it - which was a cycle, and one the dependency firewall was right to refuse
 * even though it was types-only and harmless at runtime.
 */

export interface CatalogueModel {
  readonly id: string;
  readonly name: string;
  /** Whether the model can call tools. An agent that cannot is a chat box. */
  readonly toolCall: boolean;
  readonly reasoning: boolean;
  /** Upstream USD-per-million prices converted to integer microdollars. */
  readonly inputCostMicrosPerMillion?: number | null;
  readonly outputCostMicrosPerMillion?: number | null;
  readonly cacheReadCostMicrosPerMillion?: number | null;
  readonly cacheWriteCostMicrosPerMillion?: number | null;
  /** How many tokens the model reads at once, where models.dev publishes it. */
  readonly contextWindow?: number | null;
  /** The most tokens one reply may contain. Decides how far a cut-off reply is given room. */
  readonly maxOutput?: number | null;
  /** The reasoning-effort levels the model accepts, in its own words. Absent: none. */
  readonly effortLevels?: readonly string[];
  /** "YYYY-MM-DD", for newest-first order and the New badge. */
  readonly releaseDate?: string;
  /** Upstream's word on the model's standing: "alpha", "beta" or "deprecated". */
  readonly status?: string;
  /** The model's family as models.dev names it ("gpt-codex", "claude-sonnet"). */
  readonly family?: string;
  /** What it reads ("text", "image", "pdf"...) and writes, where published. */
  readonly inputs?: readonly string[];
  readonly outputs?: readonly string[];
}

export interface CatalogueProvider {
  readonly id: string;
  readonly name: string;
  /** Environment variables this provider's key is conventionally read from. */
  readonly env: readonly string[];
  readonly doc: string | null;
  readonly models: readonly CatalogueModel[];
}
