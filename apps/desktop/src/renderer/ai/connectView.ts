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
import type { AiProviderInfo, AiStatus } from "../../shared/api.ts";

export interface ConnectView {
  readonly element: HTMLElement;
  shown(): void;
  hidden(): void;
  open(): void;
  close(): void;
  isOpen(): boolean;
}

export interface ConnectViewDeps {
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
}

export function createConnectView(deps: ConnectViewDeps): ConnectView {
  let open = false;
  let status: AiStatus | null = null;
  let selected: string | null = null;
  let query = "";
  let polling: ReturnType<typeof setInterval> | undefined;

  const element = document.createElement("section");
  element.className = "connect-view";
  element.setAttribute("aria-label", "Connect a model");

  const panel = document.createElement("div");
  panel.className = "connect-panel";

  const header = document.createElement("header");
  header.className = "settings-header";

  const title = document.createElement("h1");
  title.className = "settings-title";
  title.textContent = "Connect a model";

  const done = document.createElement("button");
  done.className = "ghost-button";
  done.textContent = "Close";
  done.setAttribute("aria-label", "Close Connect a model");
  done.title = "Close Connect a model";
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
  const add = document.createElement("button");
  add.className = "btn btn-primary";
  add.textContent = "Add API connection";
  add.addEventListener("click", () => renderConnection());
  const toolbar = document.createElement("div");
  toolbar.className = "connect-toolbar";
  toolbar.append(search, add);
  panel.append(header, lede, toolbar, body);
  element.append(panel);

  function renderConnection(existing?: ConnectionProfile): void {
    detail.replaceChildren();
    const heading = document.createElement("h2");
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
    detail.append(heading, form);
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
          renderProviders();
          renderDetail();
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
      state.textContent = provider.id === status.activeProvider && status.ready
        ? "In use"
        : !provider.needsKey
        ? "no key needed"
        : provider.hasKey
          ? "connected"
          : provider.transport === "unsupported"
            ? "needs an address"
            : "needs a key";
      state.dataset["tone"] =
        provider.hasKey || !provider.needsKey
          ? "ok"
          : provider.transport === "unsupported"
            ? "warn"
            : "";

      row.append(avatar, name, state);
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
        renderProviders();
        renderDetail();
      }).catch((error: unknown) => {
        selectionText.textContent = error instanceof Error ? error.message : "Could not select this model.";
        use.disabled = false;
      });
    });
    selection.append(selectionText, use);
    detail.append(selection);
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
      showKey.addEventListener("click", () => {
        const showing = keyField.type === "text";
        keyField.type = showing ? "password" : "text";
        showKey.textContent = showing ? "Show" : "Hide";
        keyField.focus();
      });

      const pasteKey = document.createElement("button");
      pasteKey.type = "button";
      pasteKey.className = "connect-show-key";
      pasteKey.textContent = "Paste";
      pasteKey.title = "Paste from clipboard";
      pasteKey.setAttribute("aria-label", "Paste key from clipboard");
      pasteKey.addEventListener("click", () => {
        void navigator.clipboard
          ?.readText()
          .then((text) => {
            if (text.trim().length > 0) {
              keyField.value = text.trim();
              keyField.focus();
            }
          })
          .catch(() => {
            keyField.focus();
          });
      });

      keyRow.append(keyField, showKey, pasteKey);

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

            renderProviders();
            renderDetail();
          })
          .catch((error) => {
            check.disabled = false;
            result.textContent =
              error instanceof Error
                ? error.message
                : "Connection check failed.";
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

      detail.append(keyRow, actions, result);

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
          provider.id === status.activeProvider &&
            model.id === status.activeModel,
        );

        const name = document.createElement("span");
        name.className = "connect-model-name";
        name.textContent = model.name;

        const marks = document.createElement("span");
        marks.className = "connect-model-marks";
        // Tool calls are the one capability that changes what this editor may do with a
        // model: without them the agent cannot read a file, and it is a chat box.
        marks.textContent = [
          model.toolCall ? "tools" : "no tools",
          model.reasoning ? "reasoning" : "",
        ]
          .filter((mark) => mark.length > 0)
          .join(" · ");

        row.append(name, marks);
        row.addEventListener("click", () => {
          void deps
            .write("adcode.ai.provider", provider.id)
            .then(() => deps.write("adcode.ai.model", model.id))
            .then(async () => {
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

  async function activateProvider(provider: AiProviderInfo): Promise<void> {
    const model = status?.activeProvider === provider.id
      ? status.activeModel
      : provider.models[0]?.id ?? "";
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

  async function load(): Promise<void> {
    status = await deps.status();
    selected ??= status.activeProvider;

    lede.textContent = "Choose the model your assistant uses. Connect a provider or add your own API endpoint.";

    renderProviders();
    renderDetail();
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
      polling = setInterval(() => {
        if (open)
          void deps
            .status()
            .then((next) => {
              status = next;
              renderActivity();
            })
            .catch(() => undefined);
      }, 1000);

      requestAnimationFrame(() => {
        search.focus();
      });
    },

    hidden(): void {
      open = false;
      clearInterval(polling);
    },

    close(): void {
      deps.requestClose();
    },

    isOpen: () => open,
  };

  return api;
}
