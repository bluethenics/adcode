/**
 * The shape of the admin panel's model list, on its own so `store.ts` can name it without
 * importing `modelCatalog.ts` - which imports `store.ts` back, a cycle the firewall refuses.
 * What the document means, and how it is checked, lives in `modelCatalog.ts`.
 */

export interface AddedModel {
  provider: string;
  id: string;
  name: string;
  contextWindow?: number;
  maxOutput?: number;
  reasoning?: boolean;
  effortLevels?: string[];
  /** USD per million tokens. */
  inputPrice?: number;
  outputPrice?: number;
  releaseDate?: string;
}

export interface ModelCatalog {
  /** provider id -> the model it starts on. */
  recommended: Record<string, string>;
  /** "provider:model" keys. */
  hidden: string[];
  featured: string[];
  /** "provider:model" -> one line shown with the model. */
  notes: Record<string, string>;
  added: AddedModel[];
}

export interface ModelCatalogRecord {
  overrides: ModelCatalog;
  updatedAt: number;
  updatedBy: string;
}
