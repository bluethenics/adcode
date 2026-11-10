/**
 * Connect a model.
 *
 * The provider used to be four radio buttons and a hardcoded list of six models, which
 * meant the dropdown offered models a key could not reach and hid ones it could. This is
 * the catalogue instead: every provider that publishes one, searchable, with the models
 * each actually offers - and an address box for anything not in the list.
 *
 * **The key is checked by using it.** A key can be well-formed, correctly stored, and still
 * refused: revoked, wrong account, no credit left. Anything short of one real request is a
 * guess, and discovering the truth at the moment somebody pastes it is the entire reason
 * this screen exists rather than a text field in Settings.
 *
 * Keys go to the operating system's password store, never to a settings file. The screen
 * says so, because "where did my key go" is a fair question to have about an editor.
 */
import {
  parseConnections,
  NIM_BASE_URL,
  type ConnectionProfile,
} from "@adcode/ai/connections";
import type { AiModelInfo, AiProviderInfo, AiStatus, CliAgentView, LocalModelsView } from "../../shared/api.ts";
import { pasteText } from "../clipboard.ts";
import { createQuickConnect, type QuickConnect } from "./quickConnect.ts";
import { localDescription as localDescriptionText, localLabel as localLabelText, WEB_LOCAL_MODELS } from "./localModelsText.ts";
import { DESKTOP_DOWNLOAD_URL, isWebSurface } from "../surface.ts";

export interface ConnectView {
  readonly element: HTMLElement;
  /** Show the quick routes on the next open even if a model is already connected. */
  showQuick(): void;
  /** Open on one provider's page, such as a coding CLI's. */
  select(providerId: string): void;
  shown(): void;
  hidden(): void;
  open(): void;
  close(): void;
  isOpen(): boolean;
}

export interface ConnectViewDeps {
  readonly onStatusChanged?: (listener: () => void) => () => void;
  readonly status: () => Promise<AiStatus>;
  readonly checkKey: (
    provider: string,
    key: string,
  ) => Promise<{ ok: boolean; detail?: string; message?: string }>;
  readonly setKey: (provider: string, key: string) => Promise<AiStatus>;
  readonly clearKey: (provider: string) => Promise<AiStatus>;
  /** Persist the chosen provider, model, and custom address. */
  readonly write: (id: string, value: string) => Promise<void>;
  /** The coordinator owns the dialog shell, dismissal, and focus return. */
  readonly requestOpen: () => void;
  readonly requestClose: () => void;
  /** Runs a command in a terminal tab: installing, signing in to, or opening a coding CLI. */
  readonly runInTerminal?: (command: string) => void;
  /** Looks for coding CLIs again after one is installed. */
  readonly refreshCliAgents?: () => Promise<AiStatus>;
}

/** A coding CLI's state in the provider list: what is true of this computer. */
export function cliLabel(cli: CliAgentView): string {
  if (!cli.installed) return "not installed";
  return cli.headless ? "installed" : "runs in terminal";
}

/** What choosing a coding CLI means, in a sentence or two. */
export function cliDescription(cli: CliAgentView): string {
  if (!cli.installed) return `${cli.name} is not installed on this computer. Install it, sign in once in a terminal, then press Check again.`;
  if (!cli.headless) return `${cli.name} runs as an interactive app in a terminal. Open it in a terminal tab beside your code; it uses its own account and works in the open project.`;
  return `${cli.name} answers in ADCode's chat, with its own account, models and tools, working in the open project. ADCode adds your editor context and keeps the conversation. Usage is billed by ${cli.name}, not by ADCode.`;
}

/** "1M", "200K", "32K": a token count the way a person reads it. */
function tokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${String(Math.round(tokens / 100_000) / 10).replace(/\.0$/, "")}M`;
  return `${String(Math.round(tokens / 1000))}K`;
}

function modelName(model: AiModelInfo, local: boolean): string {
  return local && model.name === model.id && model.id.includes(":")
    ? model.id.split(":")[0]!.replace(/[-_]/g, " ").replace(/([a-z])(\d)/gi, "$1 $2").replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    : model.name;
}

/** "$2", "$0.15", "$10": a price per million tokens, as short as it stays exact. */
function price(dollars: number): string {
  return `$${dollars >= 10 ? dollars.toFixed(0) : dollars >= 1 ? dollars.toFixed(2).replace(/\.00$/, "") : dollars.toFixed(2)}`;
}

/** "1M context · $2 in / $10 out per 1M tokens" - only what the catalogue actually published. */
export function modelFacts(model: AiModelInfo): string {
  const parts: string[] = [];
  if (typeof model.note === "string" && model.note.length > 0) parts.push(model.note);
  if (typeof model.contextWindow === "number" && model.contextWindow > 0) parts.push(`${tokenCount(model.contextWindow)} context`);
  if (model.free !== true && typeof model.inputPrice === "number" && typeof model.outputPrice === "number") {
    parts.push(`${price(model.inputPrice)} in / ${price(model.outputPrice)} out per 1M tokens`);
  }
  return parts.join(" · ");
}

/** Ollama's row, in three words: what is true of this computer (on the web: that it needs the desktop app). */
export function localLabel(local: LocalModelsView): string {
  return localLabelText(local, isWebSurface());
}

function localDescription(local: LocalModelsView): string {
  return localDescriptionText(local, isWebSurface());
}

let connectViewSequence = 0;

export function createConnectView(deps: ConnectViewDeps): ConnectView {
  let open = false;
  let status: AiStatus | null = null;
  let selected: string | null = null;
  let query = "";
  let polling: ReturnType<typeof setInterval> | undefined;
  let activityPending = false;
  let unsubscribeStatus: (() => void) | undefined;
  let activeTab: "free" | "all" = "free";
  let freeSelecting = false;
  let freeError = "";
  const tabPrefix = `connect-models-${++connectViewSequence}`;

  const element = document.createElement("section");
  element.className = "connect-view";
  element.setAttribute("aria-label", "Connect a model");

  const panel = document.createElement("div");
  panel.className = "connect-panel";

  const header = document.createElement("header");
  header.className = "settings-header connect-header";

  const title = document.createElement("h1");
  title.className = "settings-title";
  title.textContent = "Connect a model";

  const done = document.createElement("button");
  done.className = "ghost-button";
  done.textContent = "Close";
  done.setAttribute("aria-label", "Close Connect a model");
  done.title = "Close Connect a model";
  done.addEventListener("click", () => api.close());

  const headingGroup = document.createElement("div");
  headingGroup.className = "connect-heading-group";
  const subtitle = document.createElement("p");
  subtitle.textContent = "Choose what powers your assistant.";
  headingGroup.append(title, subtitle);
  header.append(headingGroup, done);

  // Guided 3-step affordance, mirroring the in-chat banner: choose, key, model.
  // The steps are live: renderSteps() marks each done/active/todo as the
  // connection progresses, and the progress bar fills alongside them.
  const steps = document.createElement("ol");
  steps.className = "connect-steps";
  steps.setAttribute("aria-label", "How connecting works");
  for (const [index, label] of ["Choose a provider", "Check and save its key", "Pick a model"].entries()) {
    const step = document.createElement("li");
    step.className = "connect-step";
    step.dataset["state"] = "todo";
    const number = document.createElement("span");
    number.className = "connect-step-number";
    number.textContent = String(index + 1);
    number.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = label;
    step.append(number, text);
    steps.append(step);
  }

  const progress = document.createElement("div");
  progress.className = "connect-progress";
  progress.setAttribute("aria-hidden", "true");
  const progressFill = document.createElement("div");
  progressFill.className = "connect-progress-fill";
  progress.append(progressFill);

  function renderSteps(): void {
    const states: Array<"done" | "active" | "todo"> = ["todo", "todo", "todo"];
    if (status !== null) {
      const provider = status.providers.find((one) => one.id === selected);
      const keyed = provider !== undefined && (provider.hasKey || !provider.needsKey);
      const using = status.ready && provider !== undefined && provider.id === status.activeProvider;
      if (using) {
        states[0] = "done"; states[1] = "done"; states[2] = "done";
      } else if (keyed) {
        states[0] = "done"; states[1] = "done"; states[2] = "active";
      } else if (provider !== undefined) {
        states[0] = "done"; states[1] = "active";
      } else {
        states[0] = "active";
      }
    }
    [...steps.children].forEach((child, index) => {
      if (child instanceof HTMLElement) child.dataset["state"] = states[index] ?? "todo";
    });
    const done = states.filter((state) => state === "done").length;
    progressFill.style.width = `${String(Math.round((done / states.length) * 100))}%`;
  }

  const search = document.createElement("input");
  search.className = "settings-search";
  search.type = "search";
  search.placeholder = "Search providers and models";
  search.setAttribute("aria-label", "Search providers and models");
  search.addEventListener("input", () => {
    query = search.value;
    renderProviders();
  });

  const lede = document.createElement("p");
  lede.className = "help-lede";

  const body = document.createElement("div");
  body.className = "settings-body connect-body";

  const list = document.createElement("div");
  list.className = "connect-list";
  list.setAttribute("aria-label", "Model providers");
  const rail = document.createElement("aside");
  rail.className = "connect-rail";
  const railHeading = document.createElement("h2");
  railHeading.className = "connect-rail-heading";
  railHeading.textContent = "Providers";
  const providerCount = document.createElement("span");
  railHeading.append(providerCount);
  rail.append(railHeading, list);

  const detail = document.createElement("div");
  detail.className = "connect-detail";

  body.append(rail, detail);
  const add = document.createElement("button");
  add.className = "btn btn-primary";
  add.textContent = "+ Add connection";
  add.addEventListener("click", () => renderConnection());
  const toolbar = document.createElement("div");
  toolbar.className = "connect-toolbar";
  toolbar.append(search, add);
  const footer = document.createElement("footer");
  footer.className = "connect-footer";
  const connectionStatus = document.createElement("span");
  connectionStatus.className = "connect-current";
  connectionStatus.setAttribute("role", "status");
  const catalogueStatus = document.createElement("span");
  footer.append(connectionStatus, catalogueStatus);
  /*
   * The quick routes, above the full list, while nothing is connected.
   *
   * This screen is where the "No model connected" button led, and on a first run it opened
   * on Anthropic, "needs a key", with thirteen more below it - nothing said free. Somebody
   * without a key now sees the free route first; the catalogue is still right below.
   */
  const quickHost = document.createElement("div");
  quickHost.className = "connect-quick";
  quickHost.hidden = true;
  let quick: QuickConnect | null = null;
  /** Set by "Get a Free AI Key", which should offer the routes whether or not one is connected. */
  let forceQuick = false;
  function paintQuick(connected: boolean): void {
    const ready = connected && !forceQuick;
    quickHost.hidden = ready;
    if (ready) {
      quick?.dispose();
      quick = null;
      quickHost.replaceChildren();
      return;
    }
    if (quick === null) {
      quick = createQuickConnect({
        includeKeyless: false,
        compact: true,
        onConnected: () => void load(),
        openAllProviders: () => search.focus(),
      });
      const title = document.createElement("h2");
      title.className = "connect-quick-heading";
      title.textContent = "Fastest way to start";
      quickHost.replaceChildren(title, quick.element);
    } else {
      quick.refresh();
    }
  }

  const tabs = document.createElement("div");
  tabs.className = "connect-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Model connection options");
  const freePanel = document.createElement("section");
  freePanel.className = "connect-free-panel";
  freePanel.id = `${tabPrefix}-free-panel`;
  freePanel.setAttribute("role", "tabpanel");
  freePanel.setAttribute("aria-labelledby", `${tabPrefix}-free-tab`);
  const allPanel = document.createElement("div");
  allPanel.className = "connect-all-panel";
  allPanel.id = `${tabPrefix}-all-panel`;
  allPanel.setAttribute("role", "tabpanel");
  allPanel.setAttribute("aria-labelledby", `${tabPrefix}-all-tab`);
  allPanel.append(steps, progress, lede, quickHost, toolbar, body);
  const tabButtons = (["free", "all"] as const).map((mode) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "connect-tab";
    button.id = `${tabPrefix}-${mode}-tab`;
    button.textContent = mode === "free" ? "Free models" : "Your API key";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", `${tabPrefix}-${mode}-panel`);
    button.addEventListener("click", () => selectTab(mode));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      selectTab(event.key === "Home" ? "free" : event.key === "End" ? "all" : activeTab === "free" ? "all" : "free", true);
    });
    tabs.append(button);
    return button;
  });
  function selectTab(mode: "free" | "all", focus = false): void {
    activeTab = mode;
    element.dataset["tab"] = mode;
    freePanel.hidden = mode !== "free";
    allPanel.hidden = mode !== "all";
    tabButtons.forEach((button, index) => {
      const selected = mode === (index === 0 ? "free" : "all");
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus();
    });
  }
  function renderFreeModels(): void {
    freePanel.replaceChildren();
    const note = document.createElement("p");
    note.className = "connect-free-intro";
    note.textContent = "No API key needed. Pick a model to get started.";
    freePanel.append(note);
    if (freeError) {
      const error = document.createElement("p");
      error.className = "connect-result";
      error.setAttribute("role", "alert");
      error.textContent = freeError;
      const retry = document.createElement("button");
      retry.type = "button"; retry.className = "ad-btn"; retry.textContent = "Try again";
      retry.addEventListener("click", () => { void load(); });
      freePanel.append(error, retry);
    }
    if (status === null) {
      if (!freeError) { const loading = document.createElement("p"); loading.className = "connect-free-note"; loading.textContent = "Checking available models…"; loading.setAttribute("role", "status"); freePanel.append(loading); }
      return;
    }
    // Coding CLIs are not "free models": they bill through their own accounts.
    const providers = status.providers.filter((provider) => provider.cli === undefined && !provider.needsKey && provider.hasKey && provider.models.length > 0 && (provider.local === undefined || provider.local.running));
    if (providers.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-hint";
      empty.textContent = "No free models available yet.";
      const browse = document.createElement("button"); browse.type = "button"; browse.className = "ad-btn"; browse.textContent = "Connect with an API key";
      browse.addEventListener("click", () => selectTab("all", true));
      freePanel.append(empty, browse);
    }
    for (const provider of providers) {
      const group = document.createElement("section"); group.className = "connect-free-group";
      const local = provider.local !== undefined;
      group.dataset["source"] = local ? "local" : "included";
      const head = document.createElement("div"); head.className = "connect-free-group-head";
      const avatar = document.createElement("span"); avatar.className = "connect-free-avatar";
      avatar.textContent = local ? "O" : "AD";
      avatar.setAttribute("aria-hidden", "true");
      const heading = document.createElement("div"); heading.className = "connect-free-group-copy";
      const title = document.createElement("h2"); title.textContent = local ? "On this computer" : "Included with ADCode";
      const description = document.createElement("p"); description.className = "connect-free-note";
      description.textContent = local ? "Ollama · runs locally" : "Free with your ADCode account";
      heading.append(title, description);
      const badge = document.createElement("span"); badge.className = "connect-source-badge";
      badge.textContent = local ? "Local" : "No key";
      head.append(avatar, heading, badge);
      group.append(head);
      for (const model of provider.models) {
        const row = document.createElement("article"); row.className = "connect-free-model";
        const copy = document.createElement("div"); copy.className = "connect-free-model-copy";
        const name = document.createElement("strong");
        name.textContent = modelName(model, local);
        name.title = model.id;
        const facts = document.createElement("div"); facts.className = "connect-free-facts";
        const tags: string[] = [];
        if (model.recommended) tags.push("Recommended");
        if (typeof model.contextWindow === "number" && model.contextWindow > 0) tags.push(`${tokenCount(model.contextWindow)} context`);
        if (local) {
          const size = model.id.split(":")[1]?.match(/^\d+(?:\.\d+)?b/i)?.[0];
          if (size) tags.push(size.toUpperCase());
        }
        if (model.toolCall) tags.push("Tools");
        for (const text of tags) {
          const tag = document.createElement("span"); tag.textContent = text;
          if (text === "Recommended") tag.className = "connect-free-recommended";
          facts.append(tag);
        }
        copy.append(name, facts);
        const use = document.createElement("button"); use.type = "button"; use.className = "ad-btn";
        const current = status.ready && status.activeProvider === provider.id && status.activeModel === model.id;
        row.dataset["current"] = String(current);
        use.textContent = current ? "In use" : "Use model";
        use.setAttribute("aria-label", `${current ? "In use" : "Use model"}: ${model.name}`);
        use.disabled = current || freeSelecting;
        use.addEventListener("click", () => {
          freeSelecting = true; freeError = ""; renderFreeModels();
          void (async () => {
            try {
              await deps.write("adcode.ai.provider", provider.id);
              await deps.write("adcode.ai.model", model.id);
              status = await deps.status();
              renderProviders(); renderDetail(); paintQuick(status.ready);
            } catch (error) { freeError = error instanceof Error ? error.message : "Could not select this model. Try again."; }
            finally { freeSelecting = false; if (open) renderFreeModels(); }
          })();
        });
        row.append(copy, use); group.append(row);
      }
      const details = document.createElement("details"); details.className = "connect-free-disclosure";
      const summary = document.createElement("summary"); summary.textContent = local ? "About local models" : "Usage & privacy";
      const privacy = document.createElement("p");
      privacy.textContent = local
        ? "Requests stay on this computer. Speed depends on your hardware."
        : "Sign in with a verified account to use them, free. Messages and project context pass through ADCode to the chosen provider.";
      details.append(summary, privacy);
      for (const model of provider.models) {
        if (!model.note) continue;
        const explanation = document.createElement("p"); explanation.textContent = `${model.name}: ${model.note}`;
        details.append(explanation);
      }
      group.append(details);
      freePanel.append(group);
    }
    const local = status.providers.find((provider) => provider.local !== undefined)?.local;
    if (local !== undefined && (!local.running || local.models.length === 0)) {
      const group = document.createElement("section"); group.className = "connect-free-group";
      const title = document.createElement("h3"); title.textContent = "Models on this computer";
      const help = document.createElement("p"); help.className = "connect-free-note";
      help.textContent = isWebSurface()
        ? WEB_LOCAL_MODELS
        : local.running ? "Install a model in Ollama, then check again. Local requests stay on your computer." : "Start Ollama to use local models without an API key.";
      group.append(title, help, localActions(local)); freePanel.append(group);
    }
  }
  panel.append(header, tabs, freePanel, allPanel, footer);
  selectTab("free");
  renderFreeModels();
  element.append(panel);

  // Detail entrance replays only when the user moves somewhere new - a model
  // pick or a saved key updates in place, and flashing the whole panel for an
  // in-place update reads as a flicker, not feedback. Scroll is kept across
  // in-place updates so the model list does not jump to the top.
  let detailKey: string | null = null;

  /** Replay the detail entrance so a real move visibly arrives. */
  function animateDetail(): void {
    const key = `${panel.dataset["mode"] ?? ""}:${selected ?? ""}`;
    const moved = detailKey !== key;
    detailKey = key;
    if (!moved) return;
    detail.classList.remove("connect-anim-in");
    void detail.offsetWidth;
    detail.classList.add("connect-anim-in");
  }

  function keepDetailScroll(rerender: () => void): void {
    const top = detail.scrollTop;
    rerender();
    detail.scrollTop = top;
  }

  function renderConnection(existing?: ConnectionProfile): void {
    panel.dataset["mode"] = "profile";
    renderProviders();
    detail.replaceChildren();
    const back = document.createElement("button");
    back.className = "ad-btn ad-btn-tertiary connect-back";
    back.type = "button";
    back.textContent = "Back to provider";
    back.addEventListener("click", () => {
      renderDetail();
      renderProviders();
    });
    const heading = document.createElement("h2");
    heading.className = "connect-detail-title";
    heading.textContent = existing ? "Edit connection" : "New API connection";
    const form = document.createElement("form");
    form.className = "connect-profile-form";
    const field = (label: string, value: string, type = "text") => {
      const wrapper = document.createElement("label");
      wrapper.textContent = label;
      const input = document.createElement("input");
      input.className = "input connect-input";
      input.type = type;
      input.value = value;
      input.required = true;
      input.setAttribute("aria-label", label);
      wrapper.append(input);
      form.append(wrapper);
      return input;
    };
    const name = field("Connection name", existing?.name ?? "");
    const endpoint = field("API base URL", existing?.baseUrl ?? "", "url");
    const model = field("Model ID", existing?.model ?? "");
    const rpm = field(
      "Requests per minute",
      String(existing?.rpm ?? 30),
      "number",
    );
    rpm.min = "1";
    rpm.max = "6000";
    const preset = document.createElement("button");
    preset.type = "button";
    preset.className = "btn btn-outline";
    preset.textContent = "Use NVIDIA NIM preset";
    preset.addEventListener("click", () => {
      endpoint.value = NIM_BASE_URL;
      name.value ||= "NVIDIA NIM";
      model.placeholder = "Exact model ID from your NVIDIA API dashboard";
    });
    const explanation = document.createElement("p");
    explanation.className = "settings-row-description";
    explanation.textContent =
      "Chat, completion and team requests share this RPM limit. Upstream token and account limits still apply. Save the profile, then check and save its API key.";
    const result = document.createElement("p");
    result.className = "connect-result";
    result.setAttribute("role", "status");
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "btn btn-primary";
    save.textContent = "Save connection";
    form.append(preset, explanation, save, result);
    const description = document.createElement("p");
    description.className = "connect-detail-description";
    description.textContent = "Connect an OpenAI-compatible service or a model running locally.";
    detail.append(back, heading, description, form);
    animateDetail();
    name.focus();
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        save.disabled = true;
        try {
          const profile = {
            id: existing?.id ?? `connection-${crypto.randomUUID()}`,
            name: name.value,
            baseUrl: endpoint.value,
            model: model.value,
            rpm: Number(rpm.value),
          };
          const latest = await deps.status();
          const profiles = parseConnections([
            ...(latest.connections ?? []).filter(
              (item) => item.id !== profile.id,
            ),
            profile,
          ]);
          await deps.write("adcode.ai.connections", JSON.stringify(profiles));
          selected = profile.id;
          status = await deps.status();
          renderDetail();
          renderProviders();
        } catch (error) {
          result.textContent =
            error instanceof Error
              ? error.message
              : "Could not save connection.";
        } finally {
          save.disabled = false;
        }
      })();
    });
  }

  function matches(provider: AiProviderInfo): boolean {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return true;

    if (provider.displayName.toLowerCase().includes(needle)) return true;
    return provider.models.some(
      (model) =>
        model.name.toLowerCase().includes(needle) ||
        model.id.toLowerCase().includes(needle),
    );
  }

  /** Providers people reach for first, pinned above the alphabetical rest. */
  const PINNED_PROVIDERS = [
    "anthropic",
    "openai",
    "google",
    "cli-claude",
    "cli-codex",
    "cli-opencode",
    "ollama",
    "openrouter",
    "deepseek",
    "groq",
    "mistral",
    "xai",
    "custom",
  ];

  /** In the provider list: anything that needs a key, and the coding CLIs. */
  function listed(provider: AiProviderInfo): boolean {
    return provider.needsKey || provider.cli !== undefined;
  }

  function orderedProviders(): AiProviderInfo[] {
    if (status === null) return [];
    const rank = new Map(PINNED_PROVIDERS.map((id, index) => [id, index]));
    const fallback = PINNED_PROVIDERS.length;
    return status.providers
      .filter((provider) => listed(provider) && matches(provider))
      .sort(
        (a, b) =>
          (rank.get(a.id) ?? fallback) - (rank.get(b.id) ?? fallback) ||
          a.displayName.localeCompare(b.displayName),
      );
  }

  function renderProviders(): void {
    list.replaceChildren();
    if (status === null) return;
    renderSteps();
    providerCount.textContent = String(status.providers.filter((provider) => listed(provider) && matches(provider)).length);
    const current = status.providers.find((provider) => provider.id === status?.activeProvider);
    const currentModel = current?.models.find((model) => model.id === status?.activeModel);
    connectionStatus.textContent = status.ready
      ? `Using ${currentModel ? modelName(currentModel, current?.local !== undefined) : status.activeModel || "default model"}`
      : "No model selected";
    connectionStatus.title = `${current?.displayName ?? status.activeProvider} · ${status.activeModel}`;
    connectionStatus.dataset["ready"] = String(status.ready);
    catalogueStatus.textContent = status.catalogueIsLive ? "Live model catalogue" : "Bundled model catalogue";
    catalogueStatus.title = `Catalogue updated ${status.catalogueTakenOn}`;

    for (const provider of orderedProviders()) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "connect-row";
      const isSelected = provider.id === selected && panel.dataset["mode"] !== "profile";
      row.dataset["selected"] = String(isSelected);
      row.setAttribute("aria-pressed", String(isSelected));
      row.dataset["active"] = String(provider.id === status.activeProvider);

      const avatar = document.createElement("span");
      avatar.className = "connect-provider-avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = provider.displayName.slice(0, 1).toUpperCase();

      const name = document.createElement("span");
      name.className = "connect-name";
      name.textContent = provider.displayName;

      const state = document.createElement("span");
      state.className = "connect-state";
      // Three different things, and conflating them is how a connection screen lies.
      // Ollama says what is true of this computer, not "no key needed" whether or not it exists.
      const local = provider.local;
      state.textContent = provider.id === status.activeProvider && status.ready
        ? "In use"
        : provider.cli !== undefined
        ? cliLabel(provider.cli)
        : local !== undefined
        ? localLabel(local)
        : !provider.needsKey
        ? "no key needed"
        : provider.hasKey
          ? "key saved"
          : provider.transport === "unsupported"
            ? "needs an address"
            : "needs a key";
      state.dataset["tone"] = provider.cli !== undefined
        ? provider.cli.installed ? "ok" : ""
        : local !== undefined
        ? local.running && local.models.length > 0 ? "ok" : local.installed ? "warn" : ""
        : provider.hasKey || !provider.needsKey
          ? "ok"
          : provider.transport === "unsupported"
            ? "warn"
            : "";

      row.append(avatar, name, state);
      row.addEventListener("click", () => {
        selected = provider.id;
        renderDetail();
        renderProviders();
        // Rebuilding the list must not leave keyboard focus on a removed button.
        list.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
      });

      list.append(row);
    }

    if (list.childElementCount === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-hint";
      empty.textContent = `Nothing matches “${query}”.`;
      list.append(empty);
    }
  }

  function renderDetail(): void {
    panel.dataset["mode"] = "provider";
    detail.replaceChildren();
    renderSteps();
    if (status === null) return;

    const provider = status.providers.find((one) => one.id === selected);
    if (provider === undefined) {
      const hint = document.createElement("p");
      hint.className = "empty-hint";
      hint.textContent = "Pick a provider to connect it.";
      detail.append(hint);
      animateDetail();
      return;
    }

    const heading = document.createElement("h2");
    heading.className = "connect-detail-title";
    heading.textContent = provider.displayName;
    detail.append(heading);
    const description = document.createElement("p");
    description.className = "connect-detail-description";
    description.textContent = provider.id === "tagflow"
      ? "Included AI for your verified account, free and with no ADCode usage limit. No API key needed. Prompts and project context pass through ADCode's server to the selected provider. Sign in in Account before your first message."
      : provider.cli !== undefined
      ? cliDescription(provider.cli)
      : provider.transport === "unsupported"
      ? "Add an API connection with this provider's endpoint to get started."
      : provider.local !== undefined
        ? localDescription(provider.local)
        : provider.needsKey
          ? "Connect your account, then choose a model for your assistant."
          : "Run your assistant with a local model. No API key required.";
    detail.append(description);
    if (provider.local !== undefined) detail.append(localActions(provider.local));
    if (provider.cli !== undefined) detail.append(cliActions(provider, provider.cli));
    // A CLI with no headless mode is opened, not selected: the rest is about chat models.
    if (provider.cli !== undefined && !provider.cli.headless) { renderSteps(); animateDetail(); return; }
    const selection = document.createElement("div");
    selection.className = "connect-selection";
    const selectionText = document.createElement("p");
    selectionText.setAttribute("role", "status");
    selectionText.textContent = provider.id === status.activeProvider && status.ready
      ? "This model is in use by the assistant."
      : provider.hasKey || !provider.needsKey
        ? "Connection saved. Select a model to use it in the assistant."
        : "Check and save your API key to start using this provider.";
    const use = document.createElement("button");
    use.className = "btn btn-primary";
    use.textContent = provider.id === status.activeProvider && status.ready ? "In use" : "Use this model";
    use.disabled = !(provider.hasKey || !provider.needsKey) || provider.transport === "unsupported"
      || (provider.id === status.activeProvider && status.ready);
    use.addEventListener("click", () => {
      use.disabled = true;
      void activateProvider(provider).then(() => {
        keepDetailScroll(() => {
          renderProviders();
          renderDetail();
        });
      }).catch((error: unknown) => {
        selectionText.textContent = error instanceof Error ? error.message : "Could not select this model.";
        use.disabled = false;
      });
    });
    selection.append(selectionText, use);
    detail.append(selection);

    /* ── Thinking effort: how hard reasoning models think ─────────────── */

    const effortWrap = document.createElement("div");
    effortWrap.className = "connect-effort";
    const effortLabel = document.createElement("span");
    effortLabel.className = "connect-effort-label";
    effortLabel.textContent = "Thinking effort";
    const effortGroup = document.createElement("div");
    effortGroup.className = "connect-effort-group";
    effortGroup.setAttribute("role", "radiogroup");
    effortGroup.setAttribute("aria-label", "Thinking effort");
    const currentEffort = status.effort ?? "auto";
    const effortOptions = [
      ["auto", "Auto"],
      ["low", "Low"],
      ["medium", "Med"],
      ["high", "High"],
      ["max", "Max"],
    ] as const;
    for (const [value, label] of effortOptions) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "connect-effort-option";
      option.textContent = label;
      option.title = value === "auto" ? "Let the provider decide" : `${label} reasoning effort`;
      option.setAttribute("role", "radio");
      option.setAttribute("aria-checked", String(currentEffort === value));
      option.dataset["selected"] = String(currentEffort === value);
      option.addEventListener("click", () => {
        if ((status?.effort ?? "auto") === value) return;
        option.disabled = true;
        void deps.write("adcode.ai.effort", value).then(async () => {
          status = await deps.status();
          keepDetailScroll(() => {
            renderProviders();
            renderDetail();
          });
        }).catch(() => {
          option.disabled = false;
        });
      });
      effortGroup.append(option);
    }
    const effortHint = document.createElement("p");
    effortHint.className = "settings-row-description";
    effortHint.textContent = "How hard reasoning models think before answering. Higher efforts cost more.";
    effortWrap.append(effortLabel, effortGroup, effortHint);
    detail.append(effortWrap);
    const connection = status.connections?.find(
      (item) => item.id === provider.id,
    );
    if (connection) {
      const summary = document.createElement("p");
      summary.className = "settings-row-description";
      summary.textContent = `${connection.baseUrl} / ${connection.rpm} requests/minute`;
      const activity = document.createElement("p");
      activity.className = "connect-activity";
      activity.dataset["connectionActivity"] = connection.id;
      activity.setAttribute("role", "status");
      const edit = document.createElement("button");
      edit.className = "btn btn-outline";
      edit.textContent = "Edit connection";
      edit.addEventListener("click", () => renderConnection(connection));
      const remove = document.createElement("button");
      remove.className = "btn btn-outline";
      remove.dataset["danger"] = "true";
      remove.textContent = "Delete connection";
      remove.addEventListener("click", () => {
        void (async () => {
          try {
            const latest = await deps.status();
            await deps.clearKey(connection.id);
            await deps.write(
              "adcode.ai.connections",
              JSON.stringify(
                parseConnections(
                  (latest.connections ?? []).filter(
                    (item) => item.id !== connection.id,
                  ),
                ),
              ),
            );
            if (latest.activeProvider === connection.id) {
              await deps.write("adcode.ai.provider", "anthropic");
              await deps.write("adcode.ai.model", "");
            }
            selected = null;
            await load();
          } catch (error) {
            activity.textContent =
              error instanceof Error
                ? error.message
                : "Could not delete connection.";
          }
        })();
      });
      detail.append(summary, activity, edit, remove);
      renderActivity();
    }

    /* ── The address, for the custom endpoint ─────────────────────────── */

    if (provider.id === "custom") {
      const note = document.createElement("p");
      note.className = "settings-row-description";
      note.textContent =
        "Any address that speaks the OpenAI format: a gateway, a hosted provider, or a model running on this machine.";
      detail.append(note);

      const guide = document.createElement("ol");
      guide.className = "connect-custom-guide";
      for (const text of [
        "Paste the endpoint address - it saves as you type.",
        "Name the model exactly as the service spells it, below.",
        "Check and save your API key in the key section.",
      ]) {
        const item = document.createElement("li");
        item.textContent = text;
        guide.append(item);
      }
      detail.append(guide);

      const address = document.createElement("input");
      address.className = "input connect-input";
      address.type = "url";
      address.placeholder = "https://openrouter.ai/api/v1";
      address.value = status.customBaseUrl;
      address.setAttribute("aria-label", "Endpoint address");
      const saveAddress = async (): Promise<void> => {
        await deps.write("adcode.ai.customBaseUrl", address.value.trim());
        status = await deps.status();
        renderProviders();
      };
      address.addEventListener("blur", () => {
        void saveAddress().catch(() => undefined);
      });
      const saveEndpoint = document.createElement("button");
      saveEndpoint.type = "button";
      saveEndpoint.className = "btn btn-primary connect-save-endpoint";
      saveEndpoint.textContent = "Save endpoint";
      saveEndpoint.addEventListener("click", () => {
        saveEndpoint.disabled = true;
        void saveAddress().then(
          () => {
            saveEndpoint.disabled = false;
            saveEndpoint.textContent = "Saved";
            window.setTimeout(() => {
              saveEndpoint.textContent = "Save endpoint";
            }, 1400);
          },
          () => {
            saveEndpoint.disabled = false;
          },
        );
      });
      detail.append(address, saveEndpoint);
    }

    /* ── The key ──────────────────────────────────────────────────────── */

    if (provider.needsKey) {
      const keySection = document.createElement("details");
      keySection.className = "connect-key-section";
      keySection.open = !provider.hasKey;
      const keyHeading = document.createElement("summary");
      keyHeading.className = "connect-subheading";
      keyHeading.textContent = provider.hasKey ? "API key saved · Manage key" : "API key";
      keySection.append(keyHeading);
      const keyRow = document.createElement("div");
      keyRow.className = "connect-key-row";

      const keyField = document.createElement("input");
      keyField.className = "input connect-input";
      keyField.type = "password";
      keyField.placeholder = provider.hasKey
        ? "A key is stored for this provider"
        : "Paste your key";
      keyField.setAttribute("aria-label", `${provider.displayName} key`);
      keyField.setAttribute("autocomplete", "off");
      keyField.setAttribute("spellcheck", "false");

      const showKey = document.createElement("button");
      showKey.type = "button";
      showKey.className = "connect-show-key";
      showKey.textContent = "Show";
      showKey.title = "Show or hide the key";
      showKey.setAttribute("aria-label", "Show or hide the key");
      showKey.setAttribute("aria-pressed", "false");
      showKey.addEventListener("click", () => {
        const showing = keyField.type === "text";
        keyField.type = showing ? "password" : "text";
        showKey.textContent = showing ? "Show" : "Hide";
        showKey.setAttribute("aria-pressed", String(!showing));
        keyField.focus();
      });

      const pasteKey = document.createElement("button");
      pasteKey.type = "button";
      pasteKey.className = "connect-show-key";
      pasteKey.textContent = "Paste";
      pasteKey.title = "Paste from clipboard";
      pasteKey.setAttribute("aria-label", "Paste key from clipboard");
      pasteKey.addEventListener("click", () => {
        void pasteText().then((text) => {
          if (text.trim().length > 0) {
            keyField.value = text.trim();
          }
          keyField.focus();
        });
      });

      keyRow.append(keyField, showKey, pasteKey);

      const actions = document.createElement("div");
      actions.className = "actions connect-actions";

      const result = document.createElement("p");
      result.className = "connect-result";
      result.setAttribute("role", "status");
      result.setAttribute("aria-live", "polite");

      const check = document.createElement("button");
      check.className = "btn btn-primary";
      check.textContent = "Check and save";
      check.addEventListener("click", () => {
        const key = keyField.value.trim();
        if (key.length === 0) {
          result.textContent = "Paste a key first.";
          result.dataset["tone"] = "warn";
          keyField.focus();
          return;
        }

        check.disabled = true;
        check.textContent = "Checking…";
        check.classList.add("is-busy");
        keyField.disabled = true;
        keyRow.setAttribute("aria-busy", "true");
        result.dataset["tone"] = "";
        result.textContent = "Asking the provider — this verifies the key with one real request…";

        void deps
          .checkKey(provider.id, key)
          .then(async (outcome) => {
            if (!outcome.ok) {
              check.disabled = false;
              result.dataset["tone"] = "error";
              result.textContent =
                outcome.message ?? "That key was not accepted.";
              return;
            }

            // Only stored once it has actually worked. A saved key that does not is worse
            // than no key, because nothing later says why the assistant is silent.
            if (connection) {
              const latest = await deps.status();
              if (
                latest.connections?.find((item) => item.id === connection.id)
                  ?.baseUrl !== connection.baseUrl
              ) {
                result.textContent =
                  "The connection address changed. Check the key again for its new address.";
                check.disabled = false;
                return;
              }
            }
            status = await deps.setKey(provider.id, key);
            keyField.value = "";
            await activateProvider(provider);
            result.dataset["tone"] = "ok";
            result.textContent = outcome.detail ?? "Connected.";

            keepDetailScroll(() => {
              renderProviders();
              renderDetail();
            });
          })
          .catch((error) => {
            check.disabled = false;
            result.dataset["tone"] = "error";
            result.textContent =
              error instanceof Error
                ? error.message
                : "Connection check failed.";
          }).finally(() => {
            check.disabled = false;
            check.textContent = "Check and save";
            check.classList.remove("is-busy");
            keyField.disabled = false;
            keyRow.removeAttribute("aria-busy");
          });
      });

      actions.append(check);

      if (provider.hasKey) {
        const forget = document.createElement("button");
        forget.className = "btn btn-outline";
        forget.textContent = "Forget key";
        forget.dataset["danger"] = "true";
        forget.addEventListener("click", () => {
          forget.disabled = true;
          void deps.clearKey(provider.id).then(async (next) => {
            status = next;
            keepDetailScroll(() => {
              renderProviders();
              renderDetail();
            });
          }).catch((error: unknown) => {
            result.dataset["tone"] = "error";
            result.textContent = error instanceof Error ? error.message : "Could not forget key.";
            forget.disabled = false;
          });
        });
        actions.append(forget);
      }

      keySection.append(keyRow, actions, result);

      const stored = document.createElement("p");
      stored.className = "settings-row-description";
      stored.textContent =
        "Keys are kept in this computer's own password store, never in a settings file, and are never sent anywhere except to the provider you chose.";
      keySection.append(stored);

      if (provider.doc !== null) {
        const link = document.createElement("p");
        link.className = "settings-row-description";
        link.textContent = `Where to get one: ${provider.doc}`;
        keySection.append(link);
      }
      detail.append(keySection);
    }

    /* ── The models ───────────────────────────────────────────────────── */

    if (provider.models.length > 0) {
      const modelsHeading = document.createElement("h3");
      modelsHeading.className = "connect-subheading";
      modelsHeading.textContent = "Models";
      detail.append(modelsHeading);

      const modelSearch = document.createElement("input");
      modelSearch.type = "search";
      modelSearch.className = "ad-input connect-model-search";
      modelSearch.placeholder = `Search ${provider.models.length} models…`;
      modelSearch.setAttribute("aria-label", `Search ${provider.displayName} models`);
      const modelCount = document.createElement("p");
      modelCount.className = "connect-model-count";
      modelCount.setAttribute("role", "status");
      const modelFeedback = document.createElement("p");
      modelFeedback.className = "connect-result";
      modelFeedback.setAttribute("role", "status");
      detail.append(modelSearch, modelCount, modelFeedback);

      const models = document.createElement("div");
      models.className = "connect-models";

      for (const model of provider.models) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "connect-model";
        row.dataset["selected"] = String(
          provider.id === status.activeProvider &&
            model.id === status.activeModel,
        );
        row.setAttribute("aria-pressed", row.dataset["selected"]!);
        row.dataset["search"] = `${model.name} ${model.id}`.toLowerCase();

        const name = document.createElement("span");
        name.className = "connect-model-name";
        name.textContent = model.name;
        const copy = document.createElement("span");
        copy.className = "connect-model-copy";
        const id = document.createElement("span");
        id.className = "connect-model-id";
        id.textContent = model.id;
        copy.append(name, id);
        // Real numbers from the catalogue - context and price - so a choice is an informed one.
        const facts = modelFacts(model);
        if (facts.length > 0) {
          const line = document.createElement("span");
          line.className = "connect-model-facts";
          line.textContent = facts;
          copy.append(line);
        }

        const marks = document.createElement("span");
        marks.className = "connect-model-marks";
        // What "Use this model" picks, what just came out, and what costs nothing.
        const badges: Array<[string, string]> = [];
        if (model.recommended === true) badges.push(["Recommended", "recommended"]);
        if (model.featured === true) badges.push(["Featured", "new"]);
        if (model.isNew === true) badges.push(["New", "new"]);
        if (model.free === true) badges.push(["Free", "free"]);
        else if (model.freeTier === true) badges.push(["Free tier", "free"]);
        if (model.reasoning) badges.push(["Reasoning", ""]);
        // Tool calls are the one capability that changes what this editor may do with a
        // model: without them the agent cannot read a file, and it is a chat box.
        if (!model.toolCall) badges.push(["Chat only", "warn"]);
        for (const [text, tone] of badges) {
          const badge = document.createElement("span");
          badge.className = tone === "recommended" ? "connect-model-badge" : "connect-model-tag";
          if (tone.length > 0) badge.dataset["tone"] = tone;
          badge.textContent = text;
          marks.append(badge);
        }

        row.append(copy, marks);
        row.addEventListener("click", () => {
          row.disabled = true;
          row.classList.add("is-busy");
          modelFeedback.dataset["tone"] = "";
          modelFeedback.textContent = `Selecting ${model.name}…`;
          void deps
            .write("adcode.ai.provider", provider.id)
            .then(() => deps.write("adcode.ai.model", model.id))
            .then(async () => {
              status = await deps.status();
              keepDetailScroll(() => {
                renderProviders();
                renderDetail();
              });
            }).catch((error: unknown) => {
              row.disabled = false;
              modelFeedback.dataset["tone"] = "error";
              modelFeedback.textContent = error instanceof Error ? error.message : "Could not select this model.";
            });
        });

        models.append(row);
      }

      detail.append(models);
      const filterModels = () => {
        const needle = modelSearch.value.trim().toLowerCase();
        let count = 0;
        for (const row of models.querySelectorAll<HTMLElement>(".connect-model")) {
          row.hidden = !row.dataset["search"]?.includes(needle);
          if (!row.hidden) count++;
        }
        modelCount.textContent = count === 0 ? "No models match your search." : `${count} model${count === 1 ? "" : "s"} available`;
      };
      modelSearch.addEventListener("input", filterModels);
      filterModels();
    } else if (provider.id === "custom") {
      const modelField = document.createElement("input");
      modelField.className = "input connect-input";
      modelField.type = "text";
      modelField.placeholder = "Model name, exactly as the service spells it";
      modelField.value = status.activeModel;
      modelField.setAttribute("aria-label", "Model name");
      modelField.addEventListener("blur", () => {
        void Promise.all([
          deps.write("adcode.ai.provider", "custom"),
          deps.write("adcode.ai.model", modelField.value.trim()),
        ]);
      });
      detail.append(modelField);
    }

    renderSteps();
    animateDetail();
  }

  /**
   * A coding CLI's way forward: install it, sign in once, or open it in a terminal - and, once
   * it answers in the chat, any model name the CLI accepts, not just the ones listed.
   */
  function cliActions(provider: AiProviderInfo, cli: CliAgentView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "connect-cli";
    const row = document.createElement("div");
    row.className = "connect-local-actions";
    const note = document.createElement("p");
    note.className = "connect-result";
    note.setAttribute("role", "status");
    const action = (label: string, primary: boolean, run: () => Promise<void> | void): void => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = primary ? "btn btn-primary" : "ad-btn";
      button.textContent = label;
      button.addEventListener("click", () => {
        button.disabled = true;
        void Promise.resolve(run()).finally(() => { button.disabled = false; });
      });
      row.append(button);
    };
    const terminal = (command: string, said: string): void => {
      if (deps.runInTerminal === undefined) return;
      deps.runInTerminal(command);
      deps.requestClose();
      note.textContent = said;
    };
    if (isWebSurface()) {
      action("Get the desktop app", true, () => { window.open(DESKTOP_DOWNLOAD_URL, "_blank", "noopener"); });
      note.textContent = "Coding CLIs run on your own computer, in the desktop app.";
      row.append(note);
      wrap.append(row);
      return wrap;
    }
    if (!cli.installed) {
      action("Install in a terminal", true, () => terminal(cli.install, `Installing ${cli.name} in a terminal.`));
      action("Copy install command", false, async () => { await window.adcode.clipboard.writeText(cli.install); note.textContent = `Copied: ${cli.install}`; });
    } else if (!cli.headless) {
      action(`Open ${cli.name} in a terminal`, true, () => terminal(cli.command, `Opened ${cli.name} in a terminal.`));
    } else {
      action("Sign in in a terminal", false, () => terminal(cli.signIn, `Opened ${cli.name}'s sign-in in a terminal. Come back when it is done.`));
    }
    action("Check again", false, async () => {
      if (deps.refreshCliAgents === undefined) return;
      status = await deps.refreshCliAgents();
      keepDetailScroll(() => { renderProviders(); renderDetail(); });
    });
    row.append(note);
    wrap.append(row);
    if (cli.installed) {
      const meta = document.createElement("p");
      meta.className = "settings-row-description";
      meta.textContent = cli.version === null ? `Found as \`${cli.command}\`.` : `Found ${cli.version}.`;
      wrap.append(meta);
    }
    if (cli.installed && cli.headless) {
      // Any model the CLI accepts, typed as it spells it: lists go stale faster than CLIs do.
      const form = document.createElement("form");
      form.className = "connect-cli-model";
      const input = document.createElement("input");
      input.className = "input connect-input";
      input.placeholder = provider.models.length > 1 ? `Or type a model, such as ${provider.models[1]!.id}` : "Or type a model name the CLI accepts";
      input.setAttribute("aria-label", `Model name for ${cli.name}`);
      input.spellcheck = false;
      const use = document.createElement("button");
      use.type = "submit";
      use.className = "ad-btn";
      use.textContent = "Use model";
      form.append(input, use);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const model = input.value.trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+=-]{0,199}$/.test(model)) { note.textContent = "Type the model exactly as the CLI names it, with no spaces."; return; }
        use.disabled = true;
        void (async () => {
          await deps.write("adcode.ai.provider", provider.id);
          await deps.write("adcode.ai.model", model);
          status = await deps.status();
          keepDetailScroll(() => { renderProviders(); renderDetail(); });
        })().finally(() => { use.disabled = false; });
      });
      wrap.append(form);
    }
    return wrap;
  }

  /** Ollama's way forward: get it, start it, or look again once a model is pulled. */
  function localActions(local: LocalModelsView): HTMLElement {
    const row = document.createElement("div");
    row.className = "connect-local-actions";
    const note = document.createElement("p");
    note.className = "connect-result";
    note.setAttribute("role", "status");
    const action = (label: string, primary: boolean, run: (button: HTMLButtonElement) => Promise<void>): void => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = primary ? "btn btn-primary" : "ad-btn";
      button.textContent = label;
      button.addEventListener("click", () => {
        button.disabled = true;
        void run(button).finally(() => { button.disabled = false; });
      });
      row.append(button);
    };
    const refresh = async (next?: AiStatus): Promise<void> => {
      status = next ?? (await deps.status());
      keepDetailScroll(() => {
        renderProviders();
        renderDetail();
      });
      renderFreeModels();
    };

    if (isWebSurface()) {
      // The sandbox's own Ollama is never the person's: on the web the way forward is the desktop app.
      action("Get the desktop app", true, async () => { window.open(DESKTOP_DOWNLOAD_URL, "_blank", "noopener"); });
      row.append(note);
      return row;
    }
    if (!local.installed) {
      action("Download Ollama", true, async () => { await window.adcode.ai.openKeyPage("ollama"); });
    } else if (!local.running) {
      action("Start Ollama", true, async (button) => {
        button.textContent = "Starting…";
        note.textContent = "";
        const next = await window.adcode.ai.startOllama().catch(() => null);
        if (next === null || next.providers.find((one) => one.id === "ollama")?.local?.running !== true) {
          button.textContent = "Start Ollama";
          note.dataset["tone"] = "error";
          note.textContent = "Ollama did not start. Open the Ollama app yourself, then press Check again.";
          return;
        }
        await refresh(next);
      });
    }
    if (!(local.running && local.models.length > 0)) action("Check again", local.installed && local.running, () => refresh());
    row.append(note);
    return row;
  }

  async function activateProvider(provider: AiProviderInfo): Promise<void> {
    const model = status?.activeProvider === provider.id
      ? status.activeModel
      : (provider.models.find((one) => one.recommended) ?? provider.models[0])?.id ?? "";
    await deps.write("adcode.ai.provider", provider.id);
    await deps.write("adcode.ai.model", model);
    status = await deps.status();
  }

  function renderActivity(): void {
    for (const activity of detail.querySelectorAll<HTMLElement>(
      "[data-connection-activity]",
    )) {
      const item = status?.connections?.find(
        (one) => one.id === activity.dataset["connectionActivity"],
      );
      if (!item) continue;
      const seconds = Math.max(
        0,
        Math.ceil((item.cooldownUntil - Date.now()) / 1000),
      );
      activity.textContent =
        seconds > 0
          ? `Provider cooldown: ${seconds}s / ${item.queued} queued`
          : item.queued > 0
            ? `${item.queued} requests queued: waiting for RPM slot`
            : "Ready: shared request pacing active";
    }
  }

  async function refreshActivityStatus(): Promise<void> {
    if (!open || document.hidden || activityPending) return;
    activityPending = true;
    try {
      const next = await deps.status();
      if (open) {
        const providersChanged = JSON.stringify(status?.providers) !== JSON.stringify(next.providers);
        const selectionChanged = status?.activeProvider !== next.activeProvider ||
          status?.activeModel !== next.activeModel || status?.ready !== next.ready;
        status = next;
        renderActivity();
        if (providersChanged || selectionChanged) {
          // Refresh newly discovered providers without clearing an unfinished connection form.
          renderProviders();
          paintQuick(next.ready);
          renderFreeModels();
        }
      }
    } catch { /* Keep the last usable status during a transient error. */ }
    finally { activityPending = false; }
  }

  /** Shimmer rows so the panel never flashes empty while providers load. */
  function renderSkeletons(): void {
    list.replaceChildren();
    for (let index = 0; index < 4; index++) {
      const skeleton = document.createElement("div");
      skeleton.className = "connect-row is-skeleton";
      skeleton.setAttribute("aria-hidden", "true");
      const avatar = document.createElement("span");
      avatar.className = "connect-provider-avatar";
      const name = document.createElement("span");
      name.className = "connect-name";
      const state = document.createElement("span");
      state.className = "connect-state";
      skeleton.append(avatar, name, state);
      list.append(skeleton);
    }
  }

  async function load(): Promise<void> {
    body.setAttribute("aria-busy", "true");
    connectionStatus.textContent = "Loading providers…";
    // Show the skeleton only on a cold open — a background refresh replacing
    // the list underneath the pointer would feel like a flicker, not speed.
    if (list.childElementCount === 0) renderSkeletons();
    try {
      status = await deps.status();
      if (!open) return;
      freeError = "";
      if (!status.providers.some((provider) => provider.id === selected && listed(provider)) && !status.connections?.some((connection) => connection.id === selected)) {
        selected = status.providers.find((provider) => provider.id === status?.activeProvider && provider.needsKey)?.id ?? status.providers.find((provider) => provider.needsKey)?.id ?? null;
      }

      lede.textContent = "Choose the model your assistant uses. Connect a provider or add your own API endpoint.";
      paintQuick(status.ready);

      renderDetail();
      renderProviders();
      renderFreeModels();
    } catch (error) {
      if (!open) return;
      freeError = error instanceof Error ? error.message : "Could not load models.";
      renderFreeModels();
      detail.replaceChildren();
      const message = document.createElement("p");
      message.className = "connect-result";
      message.dataset["tone"] = "error";
      message.setAttribute("role", "alert");
      message.textContent = error instanceof Error ? error.message : "Could not load providers.";
      const retry = document.createElement("button");
      retry.className = "ad-btn";
      retry.textContent = "Try again";
      retry.addEventListener("click", () => { void load(); });
      detail.append(message, retry);
      connectionStatus.textContent = "Providers unavailable";
    } finally {
      body.removeAttribute("aria-busy");
    }
  }

  const api: ConnectView = {
    element,

    open(): void {
      deps.requestOpen();
    },

    shown(): void {
      if (open) return;
      open = true;

      void load();
      unsubscribeStatus = deps.onStatusChanged?.(() => { void refreshActivityStatus(); });
      polling = setInterval(() => { void refreshActivityStatus(); }, 3000);

      requestAnimationFrame(() => {
        if (activeTab === "free") tabButtons[0]?.focus();
        else search.focus();
      });
    },

    showQuick(): void {
      forceQuick = true;
    },

    select(providerId: string): void {
      selected = providerId;
      forceQuick = false;
      selectTab("all");
      if (open) { renderProviders(); renderDetail(); } else deps.requestOpen();
    },

    hidden(): void {
      open = false;
      forceQuick = false;
      quick?.dispose();
      quick = null;
      quickHost.replaceChildren();
      clearInterval(polling);
      unsubscribeStatus?.();
      unsubscribeStatus = undefined;
    },

    close(): void {
      deps.requestClose();
    },

    isOpen: () => open,
  };

  return api;
}
