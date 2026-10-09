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
  /** Tag Flow AI, the built-in model. Absent in documents saved before it existed. */
  tagflow?: TagflowSettings;
}

/**
 * How Tag Flow AI is offered: the relay reads all of it, the desktop the switches and links.
 * None of it is secret - the key lives in the worker's `TAGFLOW_API_KEY`, never here.
 */
export interface TagflowSettings {
  /** Off: the relay answers 503 and the app stops offering Tag Flow. */
  enabled: boolean;
  /** Requests per user per window; 0 is unlimited. */
  requestLimit: number;
  /** Window length in hours, 1 to 168; windows are fixed and aligned to the UTC epoch. */
  windowHours: number;
  /** At the limit, the app waits for the reset and continues the same turn. */
  autoContinue: boolean;
  privacyUrl: string;
  /** Empty until Tag Flow publishes terms; the app then links its site instead. */
  termsUrl: string;
}

export interface ModelCatalogRecord {
  overrides: ModelCatalog;
  updatedAt: number;
  updatedBy: string;
}
