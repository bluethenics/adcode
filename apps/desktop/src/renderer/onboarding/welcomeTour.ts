/**
 * The welcome tour: arriving in ADCode without starting over.
 *
 * Shown once to somebody new, before "What do you want to build?", and once more to
 * everybody who was already here when 2.6 arrived - because the things it sets up did not
 * exist when they were first welcomed. Four short steps over a living dot field:
 *
 *  1. **Welcome** - what this is, or for a returning user, what is new.
 *  2. **Your AI** - the coding CLIs already on this computer, each one press from being
 *     ADCode's model, on the subscription the person already pays for.
 *  3. **Your conversations** - found in Claude Code, Codex and OpenCode and imported in one
 *     press, with the count ticking up as they arrive.
 *  4. **Your apps** - Gmail, Supabase, Cloudflare and the rest, one sign-in away.
 *
 * Every step can be skipped, Escape closes it, and nothing is connected, started or imported
 * without a press. The dot field quickens while a scan or import runs, so the page looks like
 * it is working when it is.
 */
import type { AiProviderInfo, ChatImportScan } from "../../shared/api.ts";
import { COMPOSIO_APPS, composioLogoUrl } from "../../shared/composioApps.ts";
import { createAgentMascot, type AgentMood } from "../agents/agentMascot.ts";
import { defaultMascotFor } from "../agents/mascotStyle.ts";
import { createAdcodeMascot } from "../mascot/adcodeMascot.ts";
import { createDotField } from "./dotField.ts";
import { cliConnectPlan, connectCli } from "../ai/cliConnect.ts";

export interface WelcomeTourDeps {
  /** True for somebody who used ADCode before this tour existed. */
  readonly returning: boolean;
  readonly selectProvider: (providerId: string) => void;
  readonly runInTerminal: (command: string) => void;
  /** Write a setting: connecting a CLI makes it the active model. */
  readonly write: (id: string, value: string) => Promise<unknown>;
  readonly openApps: () => void;
  readonly showConversations: () => void;
  /** Called once, however the tour ends. `next` says what the person asked for on the way out. */
  readonly done: (next: "build" | "apps" | "provider" | "close") => void;
}

export interface WelcomeTour {
  open(): void;
  isOpen(): boolean;
}

const STEPS = ["welcome", "ai", "chats", "apps"] as const;
type Step = (typeof STEPS)[number];

const HEADLINES: Readonly<Record<Step, readonly [string, string]>> = {
  welcome: ["Build with the AI you already have.", "ADCode brings your models, your conversations and your tools into one place."],
  ai: ["Your AI, already paid for.", "Coding tools on this computer answer in ADCode with their own subscription."],
  chats: ["Nothing starts from zero.", "Bring the conversations you had in other tools. They stay on this computer."],
  apps: ["Your apps, one sign-in away.", "Let the assistant work with the services you use every day."],
};

const NEW_IN_26: readonly (readonly [string, string])[] = [
  ["A real browser", "Tabs, sign-ins and an assistant that can use the same page you do."],
  ["Move in", "Use your Claude, ChatGPT or OpenCode subscription, and import your old conversations."],
  ["Connected apps", "Gmail, Supabase, Cloudflare and more through one sign-in."],
  ["Live rooms", "Work on one project together; every assistant knows what the others are doing."],
  ["Deeper usage", "Charts for where your tokens go, when you work, and what each model costs."],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function action(label: string, className: string, run: () => void): HTMLButtonElement {
  const node = el("button", className, label);
  node.type = "button";
  node.addEventListener("click", run);
  return node;
}

/** Count from one number to another over a short time, for a figure that has just changed. */
export function countUp(node: HTMLElement, to: number, format: (value: number) => string = (value) => value.toLocaleString()): void {
  const from = Number(node.dataset["value"] ?? 0);
  node.dataset["value"] = String(to);
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset["reducedMotion"] === "true";
  if (still || from === to) { node.textContent = format(to); return; }
  const started = performance.now();
  const step = (now: number): void => {
    const progress = Math.min(1, (now - started) / 520);
    // Ease-out: fast at first, settling on the figure.
    const eased = 1 - (1 - progress) ** 3;
    node.textContent = format(Math.round(from + (to - from) * eased));
    if (progress < 1 && node.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function createWelcomeTour(deps: WelcomeTourDeps): WelcomeTour {
  const dialog = el("dialog", "welcome-tour");
  dialog.setAttribute("aria-labelledby", "welcome-tour-headline");
  const field = createDotField({ mood: "calm" });

  const hero = el("div", "welcome-tour-hero");
  const brand = el("p", "welcome-tour-brand", deps.returning ? "ADCode 2.6" : "Welcome to ADCode");
  const headline = el("h1", "welcome-tour-headline");
  headline.id = "welcome-tour-headline";
  const lead = el("p", "welcome-tour-lead");
  const mascots = el("div", "welcome-tour-mascots");
  // Buck leads the hero, and each step gives him the mood of what that step is doing. The
  // cast below him stays: they are the tools the step is about, he is ADCode.
  const buck = createAdcodeMascot({ mood: "greeting", interactive: true });
  hero.append(field.element, buck.element, brand, headline, lead, mascots);

  const side = el("div", "welcome-tour-side");
  const body = el("div", "welcome-tour-body");
  const foot = el("footer", "welcome-tour-foot");
  const dots = el("ol", "welcome-tour-dots");
  dots.setAttribute("aria-label", "Steps");
  const skip = action("Skip", "welcome-tour-skip", () => finish("close"));
  const back = action("Back", "welcome-tour-back", () => show(STEPS[Math.max(0, STEPS.indexOf(step) - 1)]!));
  const next = action("Continue", "welcome-tour-next", () => {
    const index = STEPS.indexOf(step);
    if (index === STEPS.length - 1) finish(deps.returning ? "close" : "build");
    else show(STEPS[index + 1]!);
  });
  const nav = el("div", "welcome-tour-nav");
  nav.append(back, next);
  foot.append(skip, dots, nav);
  side.append(body, foot);
  dialog.append(hero, side);

  let step: Step = "welcome";
  let ended = false;
  let scan: ChatImportScan | null = null;
  let imported = 0;

  function finish(nextMove: "build" | "apps" | "provider" | "close"): void {
    if (ended) return;
    ended = true;
    field.destroy();
    buck.destroy();
    if (dialog.open) dialog.close();
    dialog.remove();
    deps.done(nextMove);
  }

  /** A few mascots in the hero, each with its own shape and colour, in the step's mood. */
  function cast(ids: readonly string[], mood: AgentMood): void {
    mascots.replaceChildren(...ids.slice(0, 6).map((id, index) => {
      const mascot = createAgentMascot({ look: defaultMascotFor(id), mood, size: 72 }).element;
      mascot.style.setProperty("--order", index.toString());
      return mascot;
    }));
  }

  function heading(title: string, text: string): HTMLElement {
    const wrap = el("header", "welcome-tour-step-head");
    wrap.append(el("h2", "", title), el("p", "", text));
    return wrap;
  }

  function welcomeStep(): void {
    buck.setMood("greeting");
    cast(["adcode", "browser", "rooms", "apps", "usage"], "happy");
    if (!deps.returning) {
      const list = el("ul", "welcome-tour-points");
      for (const [title, text] of [
        ["Describe it, and it is built", "ADCode makes the project, writes the code and shows it running."],
        ["Use the AI you have", "Your Claude, ChatGPT or OpenCode subscription works here, or use the included AI."],
        ["Keep your history", "Conversations from other tools come with you."],
        ["It is free", "A small sponsored card appears now and then, and half of what it earns is yours."],
      ] as const) {
        const item = el("li", "");
        item.append(el("strong", "", title), el("span", "", text));
        list.append(item);
      }
      body.replaceChildren(heading("Two minutes to set up", "Three quick steps, each one optional. Then you build."), list);
      return;
    }
    const list = el("ul", "welcome-tour-points");
    for (const [title, text] of NEW_IN_26) {
      const item = el("li", "");
      item.append(el("strong", "", title), el("span", "", text));
      list.append(item);
    }
    body.replaceChildren(heading("What is new in 2.6", "A lot arrived since you were last welcomed. The next steps set it up."), list);
  }

  /** The model in use now, so a CLI that already is says Connected. */
  let active: string | null = null;

  function cliRow(provider: AiProviderInfo, index: number): HTMLElement {
    const cli = provider.cli!;
    const row = el("li", "welcome-tour-row");
    row.dataset["ready"] = String(cli.installed);
    row.style.setProperty("--order", index.toString());
    const mascot = createAgentMascot({ look: defaultMascotFor(cli.id), mood: cli.installed ? "happy" : "sleepy", size: 46 }).element;
    const text = el("div", "welcome-tour-row-text");
    text.append(el("strong", "", cli.name), el("span", "", !cli.installed ? "Not on this computer yet" : cli.headless ? "Ready - answers in ADCode's chat" : "Ready - runs in a terminal tab"));
    const buttons = el("div", "welcome-tour-row-actions");
    // One button, doing whatever is next for this tool (cliConnect.ts). Connecting a found CLI
    // happens here and the tour carries on; only a terminal step ends it.
    const plan = cliConnectPlan(provider, active);
    const connect = action(plan.label, "welcome-tour-chip is-primary", () => {
      connect.disabled = true;
      void connectCli(plan, cli.name, { write: deps.write, runInTerminal: deps.runInTerminal }).then((message) => {
        if (plan.kind === "terminal") { finish("provider"); return; }
        connect.textContent = "Connected";
        const note = row.querySelector(".welcome-tour-row-text span");
        if (note !== null) note.textContent = message;
      }, () => { connect.disabled = false; });
    });
    connect.disabled = plan.kind === "unavailable" || plan.label === "Connected";
    connect.setAttribute("aria-label", `${plan.label} ${cli.name}`);
    buttons.append(connect);
    row.append(mascot, text, buttons);
    return row;
  }

  async function aiStep(): Promise<void> {
    cast(["claude", "codex", "opencode", "gemini", "freebuff"], "thinking");
    const list = el("ul", "welcome-tour-rows");
    list.append(el("li", "welcome-tour-loading", "Looking for coding tools on this computer…"));
    const included = el("p", "welcome-tour-note", "No subscription? ADCode's included AI works after a free sign-in, and you can add any provider's key later from Connect a Model.");
    body.replaceChildren(heading("Use the AI you already pay for", "Pick one to make it ADCode's model. ADCode never sees its password or key."), list, included);
    field.setMood("working");
    buck.setMood("connecting");
    try {
      const status = await window.adcode.ai.status();
      active = status.activeProvider;
      if (step !== "ai") return;
      const clis = status.providers.filter((provider) => provider.cli !== undefined).sort((a, b) => Number(b.cli!.installed) - Number(a.cli!.installed));
      list.replaceChildren(...(clis.length > 0 ? clis.map(cliRow) : [el("li", "welcome-tour-loading", "Coding tools run in the desktop app.")]));
      const ready = clis.filter((provider) => provider.cli!.installed).length;
      cast(clis.map((provider) => provider.cli!.id), ready > 0 ? "proud" : "sleepy");
      buck.setMood(ready > 0 ? "proud" : "idle");
    } catch {
      list.replaceChildren(el("li", "welcome-tour-loading", "Could not look for coding tools. You can do this later from Move In."));
      if (step === "ai") buck.setMood("idle");
    } finally {
      field.setMood("calm");
    }
  }

  function chatsStep(): void {
    cast(["claude-code", "codex", "opencode"], scan === null ? "alert" : "proud");
    buck.setMood(imported > 0 || (scan !== null && scan.entries.length > 0) ? "proud" : "idle");
    const figure = el("div", "welcome-tour-figure");
    const count = el("strong", "welcome-tour-count", "0");
    const label = el("span", "welcome-tour-count-label", "conversations found");
    figure.append(count, label);
    const status = el("p", "welcome-tour-note");
    status.setAttribute("role", "status");
    const sources = el("div", "welcome-tour-sources");
    const go = action("Scan this computer", "welcome-tour-wide is-primary", () => void run());
    const fileButton = action("Import an exported file instead", "welcome-tour-link", () => void pick());

    const paint = (): void => {
      if (scan === null) return;
      countUp(count, imported > 0 ? imported : scan.entries.length);
      label.textContent = imported > 0 ? (imported === 1 ? "conversation imported" : "conversations imported") : (scan.entries.length === 1 ? "conversation found" : "conversations found");
      const projects = new Set(scan.entries.map((entry) => entry.folder ?? "")).size;
      // Where each one came from: the tool, how many, and the folder on this computer it was read from.
      const reports = (scan.found ?? []).filter((report) => report.conversations > 0);
      sources.replaceChildren(...(reports.length > 0
        ? reports.map((report) => {
          const chip = el("span", "welcome-tour-source", `${report.name} · ${report.conversations.toString()} from ${report.location}`);
          chip.title = `${report.conversations.toString()} conversations across ${report.projects.toString()} projects, read from ${report.location}`;
          return chip;
        })
        : scan.sources.map((name) => el("span", "welcome-tour-source", name))));
      if (imported > 0) {
        figure.dataset["done"] = "true";
        status.textContent = "They are filed under the projects they happened in. Open a project to find them in its conversation list.";
        go.hidden = true;
      } else if (scan.entries.length === 0) {
        status.textContent = "Nothing found from Claude Code, Codex or OpenCode. Claude Desktop and ChatGPT keep conversations online: export them there, then import the file.";
        go.textContent = "Scan again";
      } else {
        status.textContent = `Across ${projects.toLocaleString()} ${projects === 1 ? "project" : "projects"}. Only what you and the assistant said is imported - no tool output.`;
        go.textContent = `Import all ${scan.entries.length.toLocaleString()}`;
      }
    };

    async function run(): Promise<void> {
      go.disabled = true;
      field.setMood("working");
      figure.dataset["busy"] = "true";
      // Only while this step is on screen: a scan that ends after Back must not change his mood there.
      const mood = (next: "searching" | "loading" | "proud" | "idle" | "error"): void => { if (step === "chats") buck.setMood(next); };
      try {
        if (scan === null || scan.entries.length === 0) {
          status.textContent = "Looking in Claude Code, Codex and OpenCode…";
          mood("searching");
          scan = await window.adcode.ai.scanChatImports();
          cast(["claude-code", "codex", "opencode"], scan.entries.length > 0 ? "proud" : "confused");
          mood(scan.entries.length > 0 ? "proud" : "idle");
        } else {
          status.textContent = "Importing…";
          mood("loading");
          const result = await window.adcode.ai.importChats(scan.entries.map((entry) => entry.key), "own-folder");
          imported = result.imported;
          cast(["claude-code", "codex", "opencode"], "happy");
          // A burst of celebration that settles into pride, rather than confetti for as long as the tour is open.
          mood(imported > 0 ? "proud" : "idle");
          if (imported > 0 && step === "chats") buck.play("celebrating");
          if (result.here) deps.showConversations();
        }
        field.setMood("done");
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "That did not finish. Try again.";
        field.setMood("calm");
        mood("error");
      } finally {
        delete figure.dataset["busy"];
        go.disabled = false;
        if (step === "chats") paint();
      }
    }

    async function pick(): Promise<void> {
      try {
        const found = await window.adcode.ai.pickChatImportFile();
        if (found === null) return;
        scan = found;
        imported = 0;
        buck.setMood(found.entries.length > 0 ? "proud" : "idle");
        paint();
      } catch {
        status.textContent = "That file could not be read. Choose a conversations.json exported from Claude or ChatGPT.";
      }
    }

    body.replaceChildren(heading("Bring your conversations", "From Claude Code, Codex and OpenCode on this computer. Nothing is uploaded."), figure, sources, status, go, fileButton);
    paint();
  }

  function appsStep(): void {
    cast(["gmail", "supabase", "cloudflare", "github", "slack", "notion"], "happy");
    buck.setMood("connecting");
    const wall = el("div", "welcome-tour-logos");
    wall.setAttribute("aria-hidden", "true");
    for (const [index, item] of COMPOSIO_APPS.filter((app) => ["gmail", "supabase", "cloudflare", "github", "slack", "notion", "linear", "vercel", "stripe", "figma", "googlecalendar", "discord"].includes(app.slug)).entries()) {
      const tile = el("span", "welcome-tour-logo");
      tile.style.setProperty("--order", index.toString());
      const image = document.createElement("img");
      image.alt = "";
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      image.src = composioLogoUrl(item.slug);
      image.addEventListener("error", () => { tile.textContent = item.name.slice(0, 1); });
      tile.append(image);
      wall.append(tile);
    }
    const open = action("Connect my apps", "welcome-tour-wide", () => { deps.openApps(); finish("apps"); });
    body.replaceChildren(
      heading("Connect the apps you use", `${COMPOSIO_APPS.length.toString()} services and more, through one sign-in in your browser. ADCode never holds a password or key for any of them.`),
      wall,
      el("p", "welcome-tour-note", "Then just ask: \"email this summary to Sam\", \"create an orders table in Supabase\", \"add a DNS record on Cloudflare\"."),
      open,
    );
  }

  function show(which: Step): void {
    step = which;
    const index = STEPS.indexOf(which);
    const [title, text] = HEADLINES[which];
    headline.textContent = title;
    lead.textContent = text;
    hero.dataset["step"] = which;
    // Re-set, so the entrance plays again for the new step's content.
    side.dataset["step"] = "";
    void side.offsetWidth;
    side.dataset["step"] = which;
    back.hidden = index === 0;
    next.textContent = index === STEPS.length - 1 ? (deps.returning ? "Done" : "Start building") : "Continue";
    dots.replaceChildren(...STEPS.map((name, at) => {
      const dot = el("li", "");
      if (at === index) dot.setAttribute("aria-current", "step");
      if (at < index) dot.dataset["done"] = "true";
      dot.setAttribute("aria-label", `Step ${(at + 1).toString()} of ${STEPS.length.toString()}: ${name}`);
      return dot;
    }));
    if (which === "welcome") welcomeStep();
    else if (which === "ai") void aiStep();
    else if (which === "chats") chatsStep();
    else appsStep();
    next.focus({ preventScroll: true });
  }

  dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish("close"); });
  dialog.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === "ArrowRight") next.click();
    else if (event.key === "ArrowLeft" && !back.hidden) back.click();
  });

  return {
    open() {
      if (ended || dialog.open) return;
      document.body.append(dialog);
      dialog.showModal();
      show("welcome");
    },
    isOpen: () => dialog.open,
  };
}
