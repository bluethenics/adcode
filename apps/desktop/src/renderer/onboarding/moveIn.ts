/**
 * Move in: bring what you already use into ADCode.
 *
 * Two things stop somebody who already has an AI tool from trying another one: their
 * subscription is over there, and so are months of conversations. This screen answers both.
 *
 *  1. **Your accounts.** The coding CLIs found on this computer - Claude Code, Codex,
 *     OpenCode, Gemini CLI, Freebuff - each with the one next step that applies: use it as
 *     ADCode's model, sign it in, or install it. A CLI answers with its own account and
 *     models; ADCode never sees a password or key for it.
 *  2. **Your conversations.** What those tools keep on this computer, listed by title and
 *     project - no text is read into this window - with a tick beside each. Chosen ones
 *     become ADCode conversations, filed under the project they happened in.
 *
 * It opens from the welcome sheet and any time from the command palette. Nothing here is
 * required, and nothing is imported or started without a press.
 */
import type { AiProviderInfo, ChatImportEntry, ChatImportScan } from "../../shared/api.ts";
import { button, el, openFormModal } from "../dialogs/formDialog.ts";
import { createMascot } from "../ai/mascot.ts";

export interface MoveInDeps {
  /** Open the Connect screen on one provider, e.g. `cli-claude`. */
  readonly selectProvider: (providerId: string) => void;
  /** Run a command in a terminal tab: installing or signing in to a CLI. */
  readonly runInTerminal: (command: string) => void;
  /** Conversations were saved into the open project: refresh its list and show it. */
  readonly showConversations: () => void;
  readonly openApps: () => void;
}

/** Entries grouped by project folder, newest group first; no folder sorts last. */
export function groupImports(entries: readonly ChatImportEntry[]): { readonly folder: string | null; readonly entries: readonly ChatImportEntry[] }[] {
  const groups = new Map<string, ChatImportEntry[]>();
  for (const entry of entries) {
    const key = entry.folder ?? "";
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [entry]); else list.push(entry);
  }
  return [...groups].map(([folder, list]) => ({ folder: folder === "" ? null : folder, entries: list }))
    .sort((a, b) => Number(a.folder === null) - Number(b.folder === null) || (b.entries[0]?.updatedAt ?? 0) - (a.entries[0]?.updatedAt ?? 0));
}

function folderName(folder: string): string {
  const parts = folder.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? folder;
}

function when(at: number): string {
  if (at <= 0) return "";
  const days = Math.floor((Date.now() - at) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 30 ? `${days.toString()} days ago` : new Date(at).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function openMoveIn(deps: MoveInDeps): void {
  const modal = openFormModal("move-in", "Move in", () => undefined);
  const { card } = modal;
  const lead = el("div", "move-in-lead");
  const mascot = createMascot({ mood: "idle", label: "ADCode mascot" });
  lead.append(mascot.element, el("p", "result-summary", "Bring the AI accounts and conversations you already have. Nothing is connected, started or imported until you press its button."));
  card.append(lead);

  /* ── Accounts ── */
  const accounts = el("section", "move-in-section");
  accounts.append(el("h3", "move-in-heading", "Your AI accounts"), el("p", "move-in-note", "Coding CLIs on this computer answer in ADCode's chat with their own subscription and models."));
  const cliList = el("ul", "move-in-clis");
  cliList.setAttribute("role", "list");
  accounts.append(cliList);
  const recheck = button("Check again", "ad-btn", () => void paintClis(true));
  const appsDoor = button("Connect apps (Gmail, Supabase, Cloudflare…)", "ad-btn", () => { modal.finish(); deps.openApps(); });
  const accountActions = el("div", "move-in-actions");
  accountActions.append(recheck, appsDoor);
  accounts.append(accountActions);
  card.append(accounts);

  function cliRow(provider: AiProviderInfo): HTMLElement {
    const cli = provider.cli!;
    const row = el("li", "move-in-cli");
    row.dataset["installed"] = String(cli.installed);
    const text = el("div", "move-in-cli-text");
    text.append(el("strong", "", cli.name), el("span", "", !cli.installed ? "Not installed" : cli.headless ? `Installed${cli.version ? ` · ${cli.version.slice(0, 40)}` : ""}` : "Installed · runs in a terminal tab"));
    const actions = el("div", "move-in-cli-actions");
    if (!cli.installed) {
      actions.append(button("Install", "ad-btn", () => { deps.runInTerminal(cli.install); modal.finish(); }));
    } else {
      actions.append(button("Sign in", "ad-btn", () => { deps.runInTerminal(cli.signIn); modal.finish(); }));
      const use = button(cli.headless ? "Use in ADCode" : "Open", "ad-btn ad-btn-primary", () => { modal.finish(); deps.selectProvider(provider.id); });
      use.setAttribute("aria-label", `${cli.headless ? "Use" : "Open"} ${cli.name}`);
      actions.append(use);
    }
    row.append(text, actions);
    return row;
  }

  async function paintClis(fresh: boolean): Promise<void> {
    recheck.disabled = true;
    try {
      const status = await (fresh ? window.adcode.ai.refreshCliAgents() : window.adcode.ai.status());
      const clis = status.providers.filter((provider) => provider.cli !== undefined)
        .sort((a, b) => Number(b.cli!.installed) - Number(a.cli!.installed));
      cliList.replaceChildren(...(clis.length > 0 ? clis.map(cliRow) : [el("li", "move-in-empty", "Coding CLIs run in the desktop app.")]));
    } catch {
      cliList.replaceChildren(el("li", "move-in-empty", "Could not look for coding CLIs. Try Check again."));
    } finally {
      recheck.disabled = false;
    }
  }

  /* ── Conversations ── */
  const chats = el("section", "move-in-section");
  chats.append(el("h3", "move-in-heading", "Your conversations"), el("p", "move-in-note", "From Claude Code, Codex and OpenCode on this computer. Only titles are shown here; the conversations stay on this computer."));
  const status = el("p", "move-in-status");
  status.setAttribute("role", "status");
  const results = el("div", "move-in-results");
  const scan = button("Scan this computer", "ad-btn ad-btn-primary", () => void runScan());
  const pick = button("Import an exported file…", "ad-btn", () => void runPick());
  pick.title = "A conversations.json exported from Claude or ChatGPT, or a conversation exported from ADCode";
  const chatActions = el("div", "move-in-actions");
  chatActions.append(scan, pick);
  const target = el("label", "move-in-target");
  const here = document.createElement("input");
  here.type = "checkbox";
  target.append(here, document.createTextNode(" Put them all in the project open now, instead of each under its own folder"));
  const importButton = button("Import selected", "ad-btn ad-btn-primary", () => void runImport());
  const footer = el("div", "move-in-footer");
  footer.append(target, importButton);
  footer.hidden = true;
  chats.append(chatActions, status, results, footer);
  card.append(chats);

  const close = el("div", "result-actions");
  close.append(button("Done", "ad-btn", () => modal.finish()));
  card.append(close);

  const chosen = new Set<string>();
  let current: ChatImportScan | null = null;

  function paintResults(): void {
    results.replaceChildren();
    const entries = current?.entries ?? [];
    footer.hidden = entries.length === 0;
    importButton.disabled = chosen.size === 0;
    importButton.textContent = chosen.size === 0 ? "Import selected" : `Import ${chosen.size.toString()} conversation${chosen.size === 1 ? "" : "s"}`;
    for (const group of groupImports(entries)) {
      const box = el("fieldset", "move-in-group");
      const legend = el("legend", "");
      const all = document.createElement("input");
      all.type = "checkbox";
      all.checked = group.entries.every((entry) => chosen.has(entry.key));
      all.setAttribute("aria-label", `Select everything in ${group.folder === null ? "no project" : folderName(group.folder)}`);
      all.addEventListener("change", () => {
        for (const entry of group.entries) if (all.checked) chosen.add(entry.key); else chosen.delete(entry.key);
        paintResults();
      });
      const name = el("span", "", group.folder === null ? "No project folder" : folderName(group.folder));
      if (group.folder !== null) name.title = group.folder;
      legend.append(all, name, el("small", "", `${group.entries.length.toString()}`));
      box.append(legend);
      for (const entry of group.entries) {
        const row = el("label", "move-in-chat");
        const tick = document.createElement("input");
        tick.type = "checkbox";
        tick.checked = chosen.has(entry.key);
        tick.addEventListener("change", () => {
          if (tick.checked) chosen.add(entry.key); else chosen.delete(entry.key);
          paintResults();
        });
        const title = el("span", "move-in-chat-title", entry.title);
        row.append(tick, title, el("small", "", [entry.sourceName, `${entry.messages.toString()} messages`, when(entry.updatedAt)].filter(Boolean).join(" · ")));
        box.append(row);
      }
      results.append(box);
    }
  }

  function show(found: ChatImportScan, empty: string): void {
    current = found;
    chosen.clear();
    // Everything starts ticked: the person came here to bring it over, and unticking is one press.
    for (const entry of found.entries) chosen.add(entry.key);
    status.textContent = found.entries.length === 0 ? empty
      : `Found ${found.entries.length.toString()} conversation${found.entries.length === 1 ? "" : "s"} from ${found.sources.join(", ")}.${found.skipped > 0 ? ` ${found.skipped.toString()} very large session file${found.skipped === 1 ? " was" : "s were"} skipped.` : ""}`;
    mascot.setMood(found.entries.length === 0 ? "idle" : "done");
    paintResults();
  }

  async function runScan(): Promise<void> {
    scan.disabled = true;
    status.textContent = "Looking in Claude Code, Codex and OpenCode…";
    mascot.setMood("working");
    try {
      show(await window.adcode.ai.scanChatImports(), "No conversations from Claude Code, Codex or OpenCode were found on this computer. Claude Desktop and ChatGPT keep theirs online: export them there, then use Import an exported file.");
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "The scan did not finish. Try again.";
      mascot.setMood("error");
    } finally {
      scan.disabled = false;
    }
  }

  async function runPick(): Promise<void> {
    try {
      const found = await window.adcode.ai.pickChatImportFile();
      if (found !== null) show(found, "That file holds no conversations.");
    } catch (error) {
      status.textContent = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "That file could not be read.";
      mascot.setMood("error");
    }
  }

  async function runImport(): Promise<void> {
    if (chosen.size === 0) return;
    importButton.disabled = true;
    mascot.setMood("working");
    try {
      const result = await window.adcode.ai.importChats([...chosen], here.checked ? "current" : "own-folder");
      const where = result.here ? " They are in this project's conversation list now." : result.folders.length > 0 ? ` Open ${result.folders.length === 1 ? folderName(result.folders[0]!) : "each project"} to see ${result.imported === 1 ? "it" : "them"} in its conversation list.` : " Open a project folder to see them.";
      status.textContent = `Imported ${result.imported.toString()} conversation${result.imported === 1 ? "" : "s"}.${result.failed > 0 ? ` ${result.failed.toString()} could not be read.` : ""}${where}`;
      mascot.setMood(result.imported > 0 ? "done" : "error");
      if (result.here) deps.showConversations();
    } catch {
      status.textContent = "The import did not finish. Try again.";
      mascot.setMood("error");
    } finally {
      importButton.disabled = chosen.size === 0;
    }
  }

  void paintClis(false);
  modal.dialog.showModal();
}
