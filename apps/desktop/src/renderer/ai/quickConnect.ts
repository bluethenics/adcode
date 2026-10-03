/**
 * "Connect your AI" - the shortest routes to a working assistant, before the full list.
 *
 * Production on 2026-10-03: the first prompt a new person sent met "No model connected",
 * and the button beside it opened fourteen providers, every one "needs a key", with a paid
 * one selected. Nothing said free. Of 419 installs, 394 were gone in five minutes.
 *
 * This panel leads with the three routes that work for somebody with no key and no budget,
 * fastest first:
 *
 * 1. **A free Google Gemini key.** "Get my free key" opens AI Studio in the person's own
 *    browser. They copy the key there, and the moment this window has focus again the
 *    clipboard is checked: an AI Studio key is connected without a paste. Google's free
 *    tier may use what is sent to improve its products, and the card says so - an honest
 *    "free" is the only kind worth offering.
 * 2. **A model already on this computer**, when Ollama is running.
 * 3. **Any key they already have.** The provider is read off the key itself.
 *
 * Every route goes through `ai.quickConnect`, which checks the key against the model it will
 * use and saves nothing unless that model answers. The full catalogue stays one link away.
 */
import {
  FREE_GEMINI_MODEL,
  PROVIDER_NAMES,
  detectKeyProvider,
  looksLikeGeminiKey,
  preferredOllamaModel,
} from "../../shared/quickConnect.ts";

export type QuickConnectRoute = "free" | "local" | "key";

export interface QuickConnectDeps {
  /** A model is connected and selected. */
  onConnected(info: { readonly provider: string; readonly model: string; readonly route: QuickConnectRoute }): void;
  /** Open the full Connect screen, for every other provider. */
  openAllProviders(): void;
  /** Compact: fewer words, for the top of the full Connect screen. */
  readonly compact?: boolean;
}

export interface QuickConnect {
  readonly element: HTMLElement;
  /** Look for Ollama again and re-check the clipboard. Cheap; call whenever the panel appears. */
  refresh(): void;
  dispose(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The provider's error, cut to something a person can read in a card. */
function plain(message: string): string {
  const trimmed = message.replace(/\s+/g, " ").trim();
  if (/API key not valid|API_KEY_INVALID|invalid api key|incorrect api key|401|403/i.test(trimmed)) {
    return "That key was not accepted. Check you copied all of it, or create a new one.";
  }
  if (/quota|429|rate/i.test(trimmed)) return "The key works, but its limit is used up for now. Try again in a minute.";
  if (/fetch failed|ENOTFOUND|ECONN|network|timed? ?out/i.test(trimmed)) return "Could not reach the service. Check your internet connection and try again.";
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}…` : trimmed;
}

export function createQuickConnect(deps: QuickConnectDeps): QuickConnect {
  const root = el("section", "quick-connect");
  root.setAttribute("aria-label", "Connect your AI");
  if (deps.compact === true) root.dataset["compact"] = "true";

  let busy = false;
  let disposed = false;
  let waitingForGemini = false;

  /* ── 1. Free Gemini key ─────────────────────────────────────────────── */

  const gemini = el("article", "quick-connect-card");
  gemini.dataset["route"] = "free";
  const geminiHead = el("div", "quick-connect-card-head");
  const geminiTitle = el("strong", "quick-connect-title", "Google Gemini");
  const geminiBadge = el("span", "quick-connect-badge", "Free · recommended");
  geminiHead.append(geminiTitle, geminiBadge);
  const geminiText = el("p", "quick-connect-text", "Free with any Google account, no card. Takes about a minute.");
  const geminiSteps = el("ol", "quick-connect-steps");
  geminiSteps.hidden = true;
  for (const step of [
    "Sign in on the page that just opened.",
    "Click “Create API key”, then copy it.",
    "Come back here - ADCode picks the key up by itself.",
  ]) geminiSteps.append(el("li", "", step));

  const geminiActions = el("div", "quick-connect-actions");
  const geminiStart = el("button", "chat-send quick-connect-primary", "Get my free key");
  geminiStart.type = "button";
  const geminiPaste = el("input", "quick-connect-input");
  geminiPaste.type = "password";
  geminiPaste.placeholder = "…or paste the key here";
  geminiPaste.setAttribute("aria-label", "Gemini API key");
  geminiPaste.autocomplete = "off";
  geminiPaste.spellcheck = false;
  geminiPaste.hidden = true;
  geminiActions.append(geminiStart, geminiPaste);

  const geminiStatus = el("p", "quick-connect-status");
  geminiStatus.setAttribute("role", "status");
  const geminiFine = el(
    "small",
    "quick-connect-fine",
    "Google's free tier may use what you send to improve its products. For private or work code, use a paid key below.",
  );
  gemini.append(geminiHead, geminiText, geminiSteps, geminiActions, geminiStatus, geminiFine);

  geminiStart.addEventListener("click", () => {
    void window.adcode.ai.openKeyPage("gemini");
    waitingForGemini = true;
    geminiSteps.hidden = false;
    geminiPaste.hidden = false;
    geminiStart.textContent = "Open the key page again";
    geminiStart.className = "ghost-button quick-connect-primary";
    geminiStatus.textContent = "Waiting for your key…";
    geminiStatus.dataset["state"] = "waiting";
  });

  geminiPaste.addEventListener("input", () => {
    if (looksLikeGeminiKey(geminiPaste.value)) void connect("google", geminiPaste.value, FREE_GEMINI_MODEL, "free", geminiStatus);
  });

  /** The key copied in AI Studio, noticed as soon as this window is looked at again. */
  async function checkClipboard(): Promise<void> {
    if (!waitingForGemini || busy || disposed || !root.isConnected) return;
    let text = "";
    try {
      text = await window.adcode.clipboard.readText();
    } catch {
      return;
    }
    if (looksLikeGeminiKey(text)) {
      geminiPaste.value = text.trim();
      await connect("google", text, FREE_GEMINI_MODEL, "free", geminiStatus);
    }
  }
  const onFocus = (): void => void checkClipboard();
  window.addEventListener("focus", onFocus);
  // Focus does not always fire when returning from a browser on every desktop, so keep
  // looking, gently, while the person is away getting the key.
  const poll = window.setInterval(() => { if (document.hasFocus()) void checkClipboard(); }, 1500);

  /* ── 2. Ollama ──────────────────────────────────────────────────────── */

  const local = el("article", "quick-connect-card");
  local.dataset["route"] = "local";
  local.hidden = true;
  const localHead = el("div", "quick-connect-card-head");
  localHead.append(el("strong", "quick-connect-title", "On this computer"), el("span", "quick-connect-badge", "Free · private"));
  const localText = el("p", "quick-connect-text", "");
  const localActions = el("div", "quick-connect-actions");
  const localUse = el("button", "ghost-button quick-connect-primary", "Use it");
  localUse.type = "button";
  localActions.append(localUse);
  const localStatus = el("p", "quick-connect-status");
  localStatus.setAttribute("role", "status");
  local.append(localHead, localText, localActions, localStatus);
  let localModel: string | null = null;
  localUse.addEventListener("click", () => {
    if (localModel !== null) void connect("ollama", "", localModel, "local", localStatus);
  });

  /* ── 3. A key they already have ─────────────────────────────────────── */

  const own = el("article", "quick-connect-card");
  own.dataset["route"] = "key";
  const ownHead = el("div", "quick-connect-card-head");
  ownHead.append(el("strong", "quick-connect-title", "I already have a key"));
  const ownText = el("p", "quick-connect-text", "OpenAI, Anthropic, OpenRouter, Groq, xAI, DeepSeek, Cerebras or Gemini - paste it and ADCode works out which.");
  const ownActions = el("div", "quick-connect-actions");
  const ownInput = el("input", "quick-connect-input");
  ownInput.type = "password";
  ownInput.placeholder = "Paste your API key";
  ownInput.setAttribute("aria-label", "Your API key");
  ownInput.autocomplete = "off";
  ownInput.spellcheck = false;
  const ownConnect = el("button", "ghost-button", "Connect");
  ownConnect.type = "button";
  ownConnect.disabled = true;
  ownActions.append(ownInput, ownConnect);
  const ownStatus = el("p", "quick-connect-status");
  ownStatus.setAttribute("role", "status");
  own.append(ownHead, ownText, ownActions, ownStatus);

  ownInput.addEventListener("input", () => {
    const provider = detectKeyProvider(ownInput.value);
    ownConnect.disabled = provider === null;
    ownStatus.dataset["state"] = "";
    ownStatus.textContent = ownInput.value.trim().length === 0
      ? ""
      : provider === null
        ? "ADCode can't tell which service this key is for - choose it in All providers."
        : `Looks like a ${PROVIDER_NAMES[provider]} key.`;
  });
  const submitOwn = (): void => {
    const provider = detectKeyProvider(ownInput.value);
    if (provider !== null) void connect(provider, ownInput.value, provider === "google" ? FREE_GEMINI_MODEL : null, "key", ownStatus);
  };
  ownConnect.addEventListener("click", submitOwn);
  ownInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitOwn();
  });

  /* ── All providers ──────────────────────────────────────────────────── */

  const more = el("button", "quick-connect-more", "All providers and models →");
  more.type = "button";
  more.addEventListener("click", () => deps.openAllProviders());

  root.append(gemini, local, own, more);

  async function connect(
    provider: string,
    key: string,
    model: string | null,
    route: QuickConnectRoute,
    status: HTMLElement,
  ): Promise<void> {
    if (busy) return;
    busy = true;
    root.dataset["busy"] = "true";
    status.dataset["state"] = "checking";
    status.textContent = provider === "ollama" ? "Checking the local model…" : "Checking your key…";
    try {
      const result = await window.adcode.ai.quickConnect(provider, key.trim(), model);
      if (result.ok) {
        waitingForGemini = false;
        status.dataset["state"] = "ok";
        status.textContent = `Connected - ${result.model}. You're ready.`;
        window.adcode.milestones.record(route === "free" ? "ai_connected_free" : route === "local" ? "ai_connected_local" : "ai_connected_key");
        deps.onConnected({ provider: result.provider, model: result.model, route });
      } else {
        status.dataset["state"] = "error";
        status.textContent = plain(result.message);
      }
    } catch (error) {
      status.dataset["state"] = "error";
      status.textContent = plain(error instanceof Error ? error.message : String(error));
    } finally {
      busy = false;
      delete root.dataset["busy"];
    }
  }

  async function findLocal(): Promise<void> {
    let found = { running: false, models: [] as string[] };
    try {
      found = await window.adcode.ai.detectOllama();
    } catch {
      // No Ollama, or no bridge to ask through: the card simply stays hidden.
    }
    if (disposed) return;
    localModel = preferredOllamaModel(found.models);
    local.hidden = !found.running || localModel === null;
    if (localModel !== null) {
      localText.textContent = `Ollama is running with ${localModel}. Nothing leaves your machine; speed depends on your computer.`;
      localUse.textContent = `Use ${localModel}`;
    }
  }

  void findLocal();

  return {
    element: root,
    refresh() {
      void findLocal();
      void checkClipboard();
    },
    dispose() {
      disposed = true;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(poll);
    },
  };
}
