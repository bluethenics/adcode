/**
 * The shortest routes to a working assistant, as plain rules.
 *
 * Production on 2026-10-03: of 419 real installs, 394 were gone within five minutes and
 * five ever came back. The first thing a new person typed met "No model connected", and
 * the screen behind that button listed fourteen providers, every one of them marked
 * "needs a key", with a paid one selected. Nothing on it said free.
 *
 * Quick connect offers three routes instead, fastest first:
 *
 * - **A free Google Gemini key.** Any Google account, no card. AI Studio hands out a key in
 *   about thirty seconds, and the Flash models are free of charge on Google's free tier.
 *   `looksLikeGeminiKey` is what lets ADCode notice the copied key on its own.
 * - **A model already on this computer**, when Ollama is running.
 * - **Any key the person already has.** `detectKeyProvider` names the provider from the key
 *   itself, so "paste it" is the whole instruction.
 *
 * Pure: no DOM, no Electron, so every rule here is tested as it is written.
 */

/**
 * Google's alias for its newest Flash model.
 *
 * An alias rather than a version, because the free tier follows Flash forward and a pinned
 * version is the one that eventually leaves it. The bundled catalogue lists it first under
 * Google, with tool use, which the assistant cannot work without.
 */
export const FREE_GEMINI_MODEL = "gemini-flash-latest";

/** Where AI Studio creates a key. Opened in the person's own browser, never inside ADCode. */
export const GEMINI_KEY_PAGE = "https://aistudio.google.com/apikey";

/** Where to get Ollama, for the card that explains what it is. */
export const OLLAMA_DOWNLOAD_PAGE = "https://ollama.com/download";

/** The providers a key can name by its shape. */
export type DetectedProvider =
  | "anthropic"
  | "openai"
  | "google"
  | "openrouter"
  | "groq"
  | "xai"
  | "cerebras"
  | "deepseek";

/** Strip what a copy drags along: surrounding whitespace, quotes, a trailing newline. */
function clean(raw: string): string {
  return raw.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
}

/** An AI Studio key, alone on the clipboard. `AIza` and 35 more URL-safe characters. */
export function looksLikeGeminiKey(raw: string): boolean {
  return /^AIza[0-9A-Za-z_-]{35}$/.test(clean(raw));
}

/**
 * Which provider issued this key, or null when its shape does not say.
 *
 * Order matters: `sk-ant-` and `sk-or-` are both `sk-` keys, so the specific prefixes are
 * tried before OpenAI's general one. DeepSeek also issues `sk-` keys, but always as exactly
 * 32 lowercase hex characters, which no OpenAI key has ever been. Anything without a tell -
 * Mistral and Together use bare strings - returns null, and the caller asks instead of
 * guessing: a wrong guess sends somebody's key to the wrong company.
 */
export function detectKeyProvider(raw: string): DetectedProvider | null {
  const key = clean(raw);
  if (key.length < 20 || /\s/.test(key)) return null;

  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("sk-or-")) return "openrouter";
  if (key.startsWith("gsk_")) return "groq";
  if (key.startsWith("xai-")) return "xai";
  if (key.startsWith("csk-")) return "cerebras";
  if (looksLikeGeminiKey(key)) return "google";
  if (/^sk-[0-9a-f]{32}$/.test(key)) return "deepseek";
  if (/^sk-[A-Za-z0-9_-]{20,}$/.test(key)) return "openai";
  return null;
}

/** Display names for the providers above, for "Looks like an OpenAI key". */
export const PROVIDER_NAMES: Readonly<Record<DetectedProvider, string>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google Gemini",
  openrouter: "OpenRouter",
  groq: "Groq",
  xai: "xAI",
  cerebras: "Cerebras",
  deepseek: "DeepSeek",
};

/**
 * Model families that handle tool calls and code well, best first.
 *
 * The assistant reads and writes files through tools, so a local model that cannot call
 * them answers in prose and changes nothing - the worst possible first impression.
 */
const OLLAMA_PREFERENCE = [
  "qwen3-coder",
  "qwen2.5-coder",
  "qwen3",
  "devstral",
  "gpt-oss",
  "llama3.3",
  "llama3.2",
  "llama3.1",
  "mistral-nemo",
  "qwen2.5",
];

/** The installed local model to start with, or null when there is none worth chatting to. */
export function preferredOllamaModel(installed: readonly string[]): string | null {
  const chat = installed.filter((name) => !/embed/i.test(name));
  for (const family of OLLAMA_PREFERENCE) {
    const found = chat.find((name) => name.toLowerCase().startsWith(family));
    if (found !== undefined) return found;
  }
  return chat[0] ?? null;
}
