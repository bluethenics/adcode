/**
 * Which model each chat talks to.
 *
 * Reported for 2.6.5: "there is an issue when I try to use new, different models in two
 * different chats." The model was one setting for the whole app (`adcode.ai.provider` and
 * `adcode.ai.model`), read again at the start of every turn. So choosing Beta in chat B moved
 * chat A onto Beta too: its chip, its next message, a turn it kept going by itself, and the
 * conversation reopened after a restart. A failed turn in A waiting for "a different model"
 * even resent itself on B's choice.
 *
 * Now each chat keeps its own model, saved with the conversation:
 *   - a chat that has never talked to a model takes the model chosen last (the settings);
 *   - its first turn writes that model into the chat, and it stays there;
 *   - choosing a model - the chip, Connect, Settings, Phone link - changes the settings, and
 *     the chat on screen where it was chosen follows; other chats keep theirs.
 *
 * Pure: no Electron, so these rules are tested as they are written (chatModels.test.ts).
 */
import type { ChatModelChoice } from "@adcode/ai";

export type { ChatModelChoice };

export function sameChoice(a: ChatModelChoice | undefined | null, b: ChatModelChoice | undefined | null): boolean {
  return a !== undefined && a !== null && b !== undefined && b !== null && a.provider === b.provider && a.model === b.model;
}

export interface ChatRouteDeps {
  /** The model chosen last, resolved for its provider: what a chat without its own uses. */
  readonly chosenLast: () => ChatModelChoice;
  /**
   * A chat's own model id as its provider would send it. A connection always sends its own
   * model; an included model that has left the list gives way to the list's default.
   */
  readonly resolve: (provider: string, model: string) => string;
  /** Whether the provider can still be reached at all: a deleted connection cannot. */
  readonly exists: (provider: string) => boolean;
}

/** The provider and model a chat's next request goes to. */
export function chatRoute(chat: { readonly model?: ChatModelChoice } | null | undefined, deps: ChatRouteDeps): ChatModelChoice {
  const own = chat?.model;
  if (own !== undefined && deps.exists(own.provider)) return { provider: own.provider, model: deps.resolve(own.provider, own.model) };
  return deps.chosenLast();
}

/**
 * Notices when the settings name a different model than they did, so the chat on screen can
 * follow. Compared as written, not as resolved: the included list arriving after launch
 * changes what an empty model id resolves to, and that is nobody choosing anything.
 */
export function createModelChoiceWatch(): {
  /** The settings as they were found, if nothing has been seen yet. */
  seed(provider: unknown, model: unknown): void;
  /** True when these differ from the last seen; the first ever seen is only the baseline. */
  changed(provider: unknown, model: unknown): boolean;
} {
  let seen: string | null = null;
  const key = (provider: unknown, model: unknown): string => `${typeof provider === "string" ? provider : ""}\u0000${typeof model === "string" ? model : ""}`;
  return {
    seed(provider, model) {
      seen ??= key(provider, model);
    },
    changed(provider, model) {
      const now = key(provider, model);
      const changed = seen !== null && now !== seen;
      seen = now;
      return changed;
    },
  };
}
