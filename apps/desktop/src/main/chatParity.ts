/**
 * Can the chat do it? Every feature in the catalogue, and the route the in-app assistant has to it.
 *
 * Asked for 20 November 2026: the chat should be able to do anything a person can do in ADCode.
 * This is the audit, generated from the same catalogue the Feature library reads
 * (`@adcode/help`) and the same rules `adcode_action` enforces, so it cannot drift from what the
 * assistant can really do: `apps/desktop/test/chatParity.test.ts` regenerates
 * `docs/chat-agent-parity.md` and fails when the committed copy differs.
 *
 * Plain TypeScript: no Electron, no I/O.
 */
import { featureRecords, type FeatureRecord } from "@adcode/help";
import { ARG_COMMANDS, chatCanRunCommand, chatSettingRoute } from "./adcodeAppTools.ts";

/** Features with a tool of their own, or work the chat does with its general tools. */
export const DEDICATED_ROUTES: Readonly<Record<string, string>> = {
  "workbench.agentFlow": "`manage_agent_flow`: create, edit, rename, delete, turn on or off for all or chosen chats, share, import. Every change is confirmed.",
  "ai.chatBuildsFlows": "`manage_agent_flow` (see Agent flow).",
  "workbench.mods": "`customize_adcode`: apply or adjust a mod (confirmed), list, on, off, remove (confirmed).",
  "ai.taskAgents": "`create_agent`: create or update a task agent on any connected model (confirmed); `delegate_task` hands it work.",
  "ai.team": "`create_agent` saves the agents; `ai.team` opens the setup.",
  "workbench.agentsBoard": "`create_agent` and `delegate_task`; `agents.newTask`, `agents.editAgent` (arg: agent id) open the board.",
  "ai.subagents": "`delegate_task` starts helpers.",
  "ai.chatForks": "`fork_chats`, `send_chat_message`, `read_chat_messages`, `stop_chat`.",
  "ai.sessions": "`adcode_chats` reads and searches past conversations.",
  "ai.memoryEditor": "`memory_search`, `memory_write`.",
  "workbench.toolsPage": "`adcode_connectors`: list, add (preset or custom), connect, enable tools, disconnect, remove (confirmed).",
  "community.apps": "`adcode_connectors` adds and connects them; signing in to the app stays with the person.",
  "ai.mcpSignIn": "`adcode_connectors` connects; the sign-in page is the person's (credentials).",
  "workbench.browser": "`adcode_browser` drives the Browser panel; passwords and card numbers stay with the person.",
  "workbench.preview": "`view_page`, `audit_page` and the preview the chat starts; `preview.*` commands for the panel.",
  "ai.seesYourApp": "`view_page` and `audit_page`.",
  "workbench.terminal": "`run_command` runs commands and background servers; `terminal.*` commands work the panel.",
  "workbench.run": "`run_command`, or `run.file`.",
  "adcode.git.stageCommitUi": "`run_command` with git (stage, commit with a message, push, pull); the `git.*` commands open the views.",
  "adcode.git.branchSwitcher": "`run_command` with git (switch, create branches); `git.checkout` opens the picker.",
  "adcode.git.identity": "`run_command` with git config; `git.setIdentity` opens the form.",
  "workbench.projectWindows": "`adcode_action` app: projects lists open and recent folders; `workspace.openRecentAt` (arg: path) opens one, in a new window when a project is open.",
  "account.earnings": "`adcode_action` app: earnings reads ad earnings and AI credits; `view.earnings` opens the card.",
  "ads.convertEarnings": "`adcode_action` app: convert_earnings with an amount, confirmed with both balances before and after.",
  "community.roomContext": "`adcode_room`: read, say, note, shared plan.",
  "workbench.collab": "`adcode_room` inside a room; joining or sharing is started by the person (`collab.liveRoom`, `community.shareProject`).",
};

/** What stays with the person on purpose, or is not built yet. Read before closing a gap. */
export const KNOWN_GAPS: readonly { readonly what: string; readonly why: string }[] = [
  { what: "Full access mode", why: "By design. The setting and its warning card are refused, so the assistant can never remove its own guard rails." },
  { what: "Withdrawing earnings", why: "By design. Payouts happen on the website; the chat can open the page (`ads.withdrawEarnings`) and nothing more." },
  { what: "Buying credits or changing plan", why: "By design. The chat opens the pages (`ai.buyTokens`, `ai.upgradePlan`); paying is the person's." },
  { what: "Signing in, API keys, connector sign-ins", why: "By design. Credentials are typed by the person (`account.open`, `ai.connect`)." },
  { what: "Ads, updates, edit approval, provider and connections", why: "Guarded settings: the chat can change them only after the person confirms in a dialog." },
  { what: "Reading usage numbers", why: "Not built. The chat opens the usage views (`ai.showUsage`, `ai.chatUsage`) but cannot read the figures back." },
  { what: "Deleting a task agent", why: "Not built as an action. `create_agent` creates and updates; removing one is done on the Agents board (or as a confirmed raw edit of the guarded setting)." },
  { what: "Results of window commands", why: "The window runs a command without answering, so for commands that open a view the chat knows it was sent, not what the view shows." },
  { what: "Starting a live room or joining one", why: "Started by the person: invite codes and who joins are theirs to decide." },
  { what: "Editor gestures (multi-cursor, selections, go to definition)", why: "Commands exist and run in the focused editor, but they act on the person's cursor; the chat edits files with its own tools instead." },
];

export type ChatAccess = "dedicated tool" | "adcode_action" | "adcode_action, asks first" | "refused" | "explained only";

export interface ParityRow {
  readonly id: string;
  readonly title: string;
  readonly group: string;
  readonly access: ChatAccess;
  readonly route: string;
}

function routeFor(record: FeatureRecord): ParityRow {
  const { entry } = record;
  const commands = record.actions.filter((action) => action.kind === "command").map((action) => action.command);
  const runnable = commands.filter(chatCanRunCommand);
  const refusedCommands = commands.filter((command) => !chatCanRunCommand(command));
  const settings = entry.settingIds.map((id) => ({ id, route: chatSettingRoute(id) })).filter((one) => one.route !== "unavailable");
  const direct = settings.filter((one) => one.route === "direct");
  const asks = settings.filter((one) => one.route === "asks");
  const refused = settings.filter((one) => one.route === "refused");
  const parts: string[] = [];
  if (runnable.length > 0) parts.push(`commands ${runnable.map((command) => `\`${command}\`${ARG_COMMANDS[command] === undefined ? "" : ` (arg: ${ARG_COMMANDS[command]})`}`).join(", ")}`);
  if (direct.length > 0) parts.push(`settings ${direct.map((one) => `\`${one.id}\``).join(", ")}`);
  if (asks.length > 0) parts.push(`after confirming: ${asks.map((one) => `\`${one.id}\``).join(", ")}`);
  if (refused.length > 0 || refusedCommands.length > 0) parts.push(`refused: ${[...refused.map((one) => one.id), ...refusedCommands].map((id) => `\`${id}\``).join(", ")}`);
  const dedicated = DEDICATED_ROUTES[entry.id];
  const access: ChatAccess = dedicated !== undefined ? "dedicated tool"
    : runnable.length > 0 || direct.length > 0 ? "adcode_action"
    : asks.length > 0 ? "adcode_action, asks first"
    : refused.length > 0 || refusedCommands.length > 0 ? "refused"
    : "explained only";
  const route = [dedicated, parts.length === 0 ? null : `adcode_action: ${parts.join("; ")}`].filter((one): one is string => one !== null && one !== undefined).join(" Also ");
  return { id: entry.id, title: entry.title, group: entry.group, access, route: route !== "" ? route : entry.settingIds.length > 0 ? "Paused in this version: its setting is not available, in the chat or in Settings." : "`adcode_features` explains it; there is nothing to switch or run." };
}

/** Every feature this surface offers, with the chat's route to it. */
export function parityRows(): readonly ParityRow[] {
  return featureRecords().map(routeFor);
}

const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The audit as Markdown: docs/chat-agent-parity.md. */
export function parityMarkdown(): string {
  const rows = parityRows();
  const count = (access: ChatAccess): number => rows.filter((row) => row.access === access).length;
  return [
    "# What the chat can do in ADCode",
    "",
    "<!-- Generated by apps/desktop/src/main/chatParity.ts. Do not edit by hand: run",
    "     ADCODE_WRITE_PARITY=1 npx vitest run apps/desktop/test/chatParity.test.ts -->",
    "",
    "Every feature in the catalogue (`packages/help`), and how the in-app chat reaches it. The chat",
    "finds features with `adcode_features`, runs their commands and changes their settings with",
    "`adcode_action`, and has dedicated tools where a feature needs more than a button.",
    "",
    `- ${String(rows.length)} features: ${String(count("dedicated tool"))} with a dedicated tool, ${String(count("adcode_action"))} through \`adcode_action\`, ${String(count("adcode_action, asks first"))} only after the person confirms, ${String(count("refused"))} refused by design, ${String(count("explained only"))} with nothing to run (explained by \`adcode_features\`).`,
    "- Every command the window registers belongs to a feature (`featureCommandCoverage.test.ts`), so every command except `ai.fullAccess` and `app.quit` is runnable.",
    "- Guarded settings (ads, updates, edit approval, Full access, connector approvals, AI file tools, custom endpoint, provider, connections, agent profiles, language servers) and every text setting ask in the app's dialog first. Full access is refused outright.",
    "- Every change the chat makes through these tools is written to the debug log.",
    "",
    "## Actions that take an argument or give an answer",
    "",
    "| `adcode_action` | What it does | Confirmed |",
    "| --- | --- | --- |",
    ...Object.entries(ARG_COMMANDS).map(([command, arg]) => `| \`command: ${command}\`, \`arg\` | Runs it with ${arg} | No - opens a view |`),
    "| `app: projects` | Lists folders open in a window and recent folders | Read only |",
    "| `app: earnings` | Reads ad earnings, AI credits and what can be converted | Read only |",
    "| `app: convert_earnings`, `amount` | Converts that many dollars of earnings to AI credits | Yes, with both balances before and after |",
    "",
    "## Remaining gaps",
    "",
    "| Gap | Why |",
    "| --- | --- |",
    ...KNOWN_GAPS.map((gap) => `| ${cell(gap.what)} | ${cell(gap.why)} |`),
    "",
    "## Every feature",
    "",
    "| Feature | Id | Chat can | Route |",
    "| --- | --- | --- | --- |",
    ...rows.map((row) => `| ${cell(row.title)} | \`${row.id}\` | ${row.access} | ${cell(row.route)} |`),
    "",
  ].join("\n");
}
