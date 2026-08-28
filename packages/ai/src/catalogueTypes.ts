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
}

export interface CatalogueProvider {
  readonly id: string;
  readonly name: string;
  /** Environment variables this provider's key is conventionally read from. */
  readonly env: readonly string[];
  readonly doc: string | null;
  readonly models: readonly CatalogueModel[];
}
