/**
 * Plugins > Apps: the services the assistant can reach through Composio, with their logos.
 *
 * One connector does all of it. The banner at the top is that connector's state - not added,
 * waiting for a browser sign-in, or connected - and its one button moves it to the next
 * state. Each card then links a single app: it asks the chat to start that app's sign-in on
 * the person's Composio account, because Composio hands the consent link to whoever is
 * calling its tools. Nothing here stores a key; every credential stays with Composio.
 *
 * The connector is an ordinary MCP connector underneath (`shared/composioApps.ts` names it),
 * so it also shows on the Tools page with its tools, and every rule there still applies.
 */
import type { AssistantControlAction, AssistantControlsView, AssistantServerView } from "../../shared/assistantControls.ts";
import {
  COMPOSIO_APPS, COMPOSIO_CATEGORIES, COMPOSIO_CONNECTOR_ID, COMPOSIO_ENDPOINT, composioLinkPrompt, composioLogoUrl, composioSlug,
  searchComposioApps, type ComposioApp, type ComposioCategory,
} from "../../shared/composioApps.ts";
import { button, el } from "../dialogs/formDialog.ts";
import { createMascot } from "../ai/mascot.ts";

export interface ComposioAppsDeps {
  readonly query: () => string;
  readonly askAssistant: (prompt: string) => void;
  readonly say: (text: string) => void;
  readonly openTools: () => void;
}

type ConnectorState = "missing" | "sign-in" | "connecting" | "connected" | "error";

export function composioState(server: AssistantServerView | undefined): ConnectorState {
  if (server === undefined) return "missing";
  if (server.status === "connected") return "connected";
  if (server.status === "connecting") return "connecting";
  if (server.oauth === "required") return "sign-in";
  return server.status === "error" ? "error" : "sign-in";
}

/** The app's logo, with its initial behind it for the moment before it loads, or if it never does. */
function logo(slug: string, name: string): HTMLElement {
  const frame = el("span", "composio-logo", name.slice(0, 1).toUpperCase());
  frame.setAttribute("aria-hidden", "true");
  const image = document.createElement("img");
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  image.src = composioLogoUrl(slug);
  image.addEventListener("load", () => { frame.dataset["loaded"] = "true"; });
  image.addEventListener("error", () => image.remove());
  frame.append(image);
  return frame;
}

export function createComposioAppsView(deps: ComposioAppsDeps): { render(panel: HTMLElement): Promise<void> } {
  let category: ComposioCategory | null = null;
  let controls: AssistantControlsView | null = null;
  let busy = false;
  let host: HTMLElement | null = null;

  const server = (): AssistantServerView | undefined => controls?.servers.find((item) => item.id === COMPOSIO_CONNECTOR_ID);

  async function act(action: AssistantControlAction): Promise<boolean> {
    try {
      controls = await window.adcode.ai.control(action);
      return true;
    } catch (error) {
      deps.say(error instanceof Error ? error.message : "That did not work. Try again.");
      return false;
    }
  }

  /** Take the connector from wherever it is to connected, one step per press where a browser is involved. */
  async function connect(): Promise<void> {
    if (busy) return;
    busy = true;
    paint();
    try {
      if (server() === undefined) {
        const saved = await act({ kind: "save-server", server: { id: COMPOSIO_CONNECTOR_ID, name: "Composio", transport: "http", endpoint: COMPOSIO_ENDPOINT, args: [] } });
        if (!saved) return;
      }
      if (composioState(server()) !== "connected") {
        deps.say("Your browser is opening Composio's sign-in. Approve it there, then come back.");
        // Signs in through the browser, then connects without asking a second time.
        if (!await act({ kind: "sign-in", id: COMPOSIO_CONNECTOR_ID })) return;
      }
      const live = server();
      if (live?.status === "connected") {
        // Composio's tools are how apps get linked and used, so the assistant needs them on.
        for (const tool of live.tools) if (!tool.enabled) await act({ kind: "set-tool", id: COMPOSIO_CONNECTOR_ID, tool: tool.name, enabled: true });
        deps.say("Composio is connected. Pick an app to link it.");
      } else if (live?.error) {
        deps.say(`Composio did not connect: ${live.error}`);
      }
    } finally {
      busy = false;
      paint();
    }
  }

  function link(name: string, slug: string): void {
    if (composioState(server()) !== "connected") {
      deps.say("Connect Composio first - the button at the top - then link apps.");
      return;
    }
    deps.askAssistant(composioLinkPrompt(name, slug));
  }

  function banner(): HTMLElement {
    const state = busy ? "connecting" : composioState(server());
    const box = el("section", "composio-banner");
    box.dataset["state"] = state;
    const mascot = createMascot({ mood: state === "connected" ? "done" : state === "connecting" ? "working" : state === "error" ? "error" : "idle", label: "ADCode mascot" });
    const text = el("div", "composio-banner-text");
    const title = state === "connected" ? "Composio is connected"
      : state === "connecting" ? "Connecting to Composio…"
      : state === "error" ? "Composio did not connect"
      : state === "sign-in" ? "Sign in to Composio to finish"
      : "Give your assistant your apps";
    const detail = state === "connected" ? `${String(server()?.tools.length ?? 0)} tools ready. Link an app below, or just ask in chat: "send this to Slack", "create a Supabase table".`
      : state === "connecting" ? "Finish the sign-in in your browser. This page updates when it is done."
      : state === "error" ? (server()?.error ?? "Try again. If your browser showed an out-of-date sign-in page, close it and use the newest one.")
      : "One sign-in, in your browser, unlocks Gmail, Supabase, Cloudflare, GitHub, Slack and hundreds more. ADCode never sees a password or key for any of them.";
    text.append(el("strong", "", title), el("p", "", detail));
    const actions = el("div", "composio-banner-actions");
    if (state === "connected") {
      actions.append(button("Manage tools", "ad-btn", () => deps.openTools()));
    } else {
      const go = button(state === "connecting" ? "Waiting for your browser…" : state === "missing" ? "Connect Composio" : state === "error" ? "Try again" : "Sign in", "ad-btn ad-btn-primary", () => void connect());
      go.disabled = state === "connecting";
      actions.append(go);
    }
    box.append(mascot.element, text, actions);
    return box;
  }

  function card(item: ComposioApp, connected: boolean): HTMLElement {
    const node = el("article", "community-card composio-card");
    const top = el("div", "community-card-top");
    const names = el("div", "community-card-names");
    names.append(el("strong", "composio-card-name", item.name), el("span", "community-card-by", item.category));
    top.append(logo(item.slug, item.name), names);
    const go = button(connected ? "Link" : "Connect", connected ? "ad-btn" : "ad-btn ad-btn-primary", () => { if (connected) link(item.name, item.slug); else void connect(); });
    go.setAttribute("aria-label", `${connected ? "Link" : "Connect"} ${item.name}`);
    const foot = el("div", "community-card-foot");
    foot.append(el("span", "community-card-contributes", "via Composio"), go);
    node.append(top, el("p", "community-card-text", item.does), foot);
    return node;
  }

  function paint(): void {
    if (host === null) return;
    const query = deps.query();
    const connected = composioState(server()) === "connected";
    const bar = el("div", "community-bar");
    const categories = el("div", "community-categories");
    categories.setAttribute("role", "group");
    categories.setAttribute("aria-label", "Category");
    for (const option of [null, ...COMPOSIO_CATEGORIES]) {
      const control = button(option ?? "All", "community-category", () => { category = option; paint(); });
      control.setAttribute("aria-pressed", String(category === option));
      categories.append(control);
    }
    bar.append(categories);

    const found = searchComposioApps(query, category);
    const grid = el("div", "community-grid composio-grid");
    found.forEach((item, index) => {
      const node = card(item, connected);
      node.style.setProperty("--stagger", String(Math.min(index, 14)));
      grid.append(node);
    });

    const extra = el("div", "composio-more");
    const typed = composioSlug(query);
    if (typed !== null && query.trim() !== "" && !COMPOSIO_APPS.some((item) => item.slug === typed)) {
      const name = query.trim();
      extra.append(
        el("p", "", `"${name}" is not in this short list, but Composio covers many more services.`),
        button(`Try linking ${name}`, "ad-btn", () => link(name, typed)),
      );
    } else {
      extra.append(el("p", "", `${String(COMPOSIO_APPS.length)} popular apps are listed. Composio supports hundreds more - search for one by name to link it.`));
    }

    host.replaceChildren(banner(), bar, found.length > 0 ? grid : el("p", "community-empty", "No listed app matches that search."), extra);
  }

  window.adcode.ai.onControlsChanged(() => {
    if (host === null || !host.isConnected) return;
    void window.adcode.ai.controls().then((view) => { controls = view; paint(); }).catch(() => undefined);
  });

  return {
    async render(panel) {
      host = panel;
      controls = await window.adcode.ai.controls().catch(() => controls);
      paint();
    },
  };
}
