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
import type { AiProviderInfo, AiStatus } from "../../shared/api.ts";

export interface ConnectView {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

export interface ConnectViewDeps {
  readonly host: HTMLElement;
  readonly status: () => Promise<AiStatus>;
  readonly checkKey: (provider: string, key: string) => Promise<{ ok: boolean; detail?: string; message?: string }>;
  readonly setKey: (provider: string, key: string) => Promise<AiStatus>;
  readonly clearKey: (provider: string) => Promise<AiStatus>;
  /** Persist the chosen provider, model, and custom address. */
  readonly write: (id: string, value: string) => Promise<void>;
  readonly restoreFocus: () => void;
}

export function createConnectView(deps: ConnectViewDeps): ConnectView {
  let open = false;
  let status: AiStatus | null = null;
  let selected: string | null = null;
  let query = "";

  const sheet = document.createElement("div");
  sheet.className = "settings-sheet connect-sheet";
  sheet.hidden = true;
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Connect a model");

  const panel = document.createElement("div");
  panel.className = "settings-panel";

  const header = document.createElement("header");
  header.className = "settings-header";

  const title = document.createElement("h1");
  title.className = "settings-title";
  title.textContent = "Connect a model";

  const done = document.createElement("button");
  done.className = "ghost-button";
  done.textContent = "Done";
  done.addEventListener("click", () => api.close());

  header.append(title, done);

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

  const detail = document.createElement("div");
  detail.className = "connect-detail";

  body.append(list, detail);
  panel.append(header, search, lede, body);
  sheet.append(panel);
  deps.host.append(sheet);

  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) api.close();
  });

  function matches(provider: AiProviderInfo): boolean {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return true;

    if (provider.displayName.toLowerCase().includes(needle)) return true;
    return provider.models.some(
      (model) =>
        model.name.toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle),
    );
  }

  function renderProviders(): void {
    list.replaceChildren();
    if (status === null) return;

    for (const provider of status.providers) {
      if (!matches(provider)) continue;

      const row = document.createElement("button");
      row.type = "button";
      row.className = "connect-row";
      row.dataset["selected"] = String(provider.id === selected);
      row.dataset["active"] = String(provider.id === status.activeProvider);

      const name = document.createElement("span");
      name.className = "connect-name";
      name.textContent = provider.displayName;

      const state = document.createElement("span");
      state.className = "connect-state";
      // Three different things, and conflating them is how a connection screen lies.
      state.textContent = !provider.needsKey
        ? "no key needed"
        : provider.hasKey
          ? "connected"
          : provider.transport === "unsupported"
            ? "needs an address"
            : "needs a key";
      state.dataset["tone"] =
        provider.hasKey || !provider.needsKey ? "ok" : provider.transport === "unsupported" ? "warn" : "";

      row.append(name, state);
      row.addEventListener("click", () => {
        selected = provider.id;
        renderProviders();
        renderDetail();
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
    detail.replaceChildren();
    if (status === null) return;

    const provider = status.providers.find((one) => one.id === selected);
    if (provider === undefined) {
      const hint = document.createElement("p");
      hint.className = "empty-hint";
      hint.textContent = "Pick a provider to connect it.";
      detail.append(hint);
      return;
    }

    const heading = document.createElement("h2");
    heading.className = "settings-group-title";
    heading.textContent = provider.displayName;
    detail.append(heading);

    /* ── The address, for the custom endpoint ─────────────────────────── */

    if (provider.id === "custom") {
      const note = document.createElement("p");
      note.className = "settings-row-description";
      note.textContent =
        "Any address that speaks the OpenAI format: a gateway, a hosted provider, or a model running on this machine.";
      detail.append(note);

      const address = document.createElement("input");
      address.className = "input connect-input";
      address.type = "url";
      address.placeholder = "https://openrouter.ai/api/v1";
      address.value = status.customBaseUrl;
      address.setAttribute("aria-label", "Endpoint address");
      address.addEventListener("blur", () => {
        void deps.write("adcode.ai.customBaseUrl", address.value.trim());
      });
      detail.append(address);
    }

    /* ── The key ──────────────────────────────────────────────────────── */

    if (provider.needsKey) {
      const keyField = document.createElement("input");
      keyField.className = "input connect-input";
      keyField.type = "password";
      keyField.placeholder = provider.hasKey ? "A key is stored for this provider" : "Paste your key";
      keyField.setAttribute("aria-label", `${provider.displayName} key`);

      const actions = document.createElement("div");
      actions.className = "actions connect-actions";

      const result = document.createElement("p");
      result.className = "connect-result";

      const check = document.createElement("button");
      check.className = "btn btn-primary";
      check.textContent = "Check and save";
      check.addEventListener("click", () => {
        const key = keyField.value.trim();
        if (key.length === 0) {
          result.textContent = "Paste a key first.";
          result.dataset["tone"] = "warn";
          return;
        }

        check.disabled = true;
        result.dataset["tone"] = "";
        result.textContent = "Asking the provider…";

        void deps.checkKey(provider.id, key).then(async (outcome) => {
          check.disabled = false;

          if (!outcome.ok) {
            result.dataset["tone"] = "error";
            result.textContent = outcome.message ?? "That key was not accepted.";
            return;
          }

          // Only stored once it has actually worked. A saved key that does not is worse
          // than no key, because nothing later says why the assistant is silent.
          status = await deps.setKey(provider.id, key);
          keyField.value = "";
          result.dataset["tone"] = "ok";
          result.textContent = outcome.detail ?? "Connected.";

          renderProviders();
          renderDetail();
        });
      });

      actions.append(check);

      if (provider.hasKey) {
        const forget = document.createElement("button");
        forget.className = "btn btn-outline";
        forget.textContent = "Forget key";
        forget.addEventListener("click", () => {
          void deps.clearKey(provider.id).then(async (next) => {
            status = next;
            renderProviders();
            renderDetail();
          });
        });
        actions.append(forget);
      }

      detail.append(keyField, actions, result);

      const stored = document.createElement("p");
      stored.className = "settings-row-description";
      stored.textContent =
        "Keys are kept in this computer's own password store, never in a settings file, and are never sent anywhere except to the provider you chose.";
      detail.append(stored);

      if (provider.doc !== null) {
        const link = document.createElement("p");
        link.className = "settings-row-description";
        link.textContent = `Where to get one: ${provider.doc}`;
        detail.append(link);
      }
    }

    /* ── The models ───────────────────────────────────────────────────── */

    if (provider.models.length > 0) {
      const modelsHeading = document.createElement("h3");
      modelsHeading.className = "connect-subheading";
      modelsHeading.textContent = "Models";
      detail.append(modelsHeading);

      const models = document.createElement("div");
      models.className = "connect-models";

      for (const model of provider.models) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "connect-model";
        row.dataset["selected"] = String(
          provider.id === status.activeProvider && model.id === status.activeModel,
        );

        const name = document.createElement("span");
        name.className = "connect-model-name";
        name.textContent = model.name;

        const marks = document.createElement("span");
        marks.className = "connect-model-marks";
        // Tool calls are the one capability that changes what this editor may do with a
        // model: without them the agent cannot read a file, and it is a chat box.
        marks.textContent = [model.toolCall ? "tools" : "no tools", model.reasoning ? "reasoning" : ""]
          .filter((mark) => mark.length > 0)
          .join(" · ");

        row.append(name, marks);
        row.addEventListener("click", () => {
          void Promise.all([
            deps.write("adcode.ai.provider", provider.id),
            deps.write("adcode.ai.model", model.id),
          ]).then(async () => {
            status = await deps.status();
            renderProviders();
            renderDetail();
          });
        });

        models.append(row);
      }

      detail.append(models);
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
  }

  async function load(): Promise<void> {
    status = await deps.status();
    selected ??= status.activeProvider;

    lede.textContent = status.catalogueIsLive
      ? "Every provider that publishes a model list. Your key stays on this machine."
      : `Showing the list that shipped with ADCode, taken on ${status.catalogueTakenOn}. It refreshes when there is a connection.`;

    renderProviders();
    renderDetail();
  }

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      api.close();
    }
  };

  const api: ConnectView = {
    open(): void {
      if (open) return;
      open = true;

      void load();

      sheet.hidden = false;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          sheet.dataset["state"] = "open";
          search.focus();
        });
      });

      document.addEventListener("keydown", onKeydown);
    },

    close(): void {
      if (!open) return;
      open = false;

      delete sheet.dataset["state"];
      document.removeEventListener("keydown", onKeydown);
      window.setTimeout(() => {
        if (!open) sheet.hidden = true;
      }, 220);

      deps.restoreFocus();
    },

    isOpen: () => open,
  };

  return api;
}
