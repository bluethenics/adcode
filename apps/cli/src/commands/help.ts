import type { AppContext } from "../context.ts";
import { commandHeader, errorPanel, printLines, sectionHeader } from "../tui/components.ts";
import { visibleWidth, wrapPlain } from "../tui/ansi.ts";
import { cliPaths, desktopPaths } from "../util/paths.ts";
import { didYouMean } from "../util/suggest.ts";

/**
 * The reference.
 *
 * It is deliberately a page, not a screen: help is the one thing that should survive a
 * pipe, a narrow terminal and `--json` unchanged. The developer commands that already
 * existed are listed beside the terminal app so the two ways into ADCode read as one tool.
 */

export interface HelpCommand {
  readonly name: string;
  readonly usage: string;
  readonly blurb: string;
  readonly group: "app" | "developer";
  readonly paragraphs: readonly string[];
  readonly options: ReadonlyArray<readonly [string, string]>;
  readonly examples: ReadonlyArray<readonly [string, string]>;
}

export const HELP_COMMANDS: readonly HelpCommand[] = [
  {
    name: "app",
    usage: "adcode app [path] [--force] [--verbose] [--dry-run|--json]",
    blurb: "Open the full desktop editor in this folder",
    group: "app",
    paragraphs: [
      "Opens ADCode Desktop at the current folder, or at the file or folder you give it. Relative paths are resolved from your terminal. A source checkout builds the editor only when needed.",
      "adcode opens the terminal app. adcode app opens the desktop editor. The older adcode open command also works.",
    ],
    options: [["--force", "Rebuild before opening"], ["--verbose", "Show full build output"], ["--dry-run, --json", "Print the launch plan without opening the editor"]],
    examples: [["adcode app", "Open this folder in the editor"], ["adcode app .", "Open the current project"], ['adcode app "../my project"', "Open a folder with spaces in its name"]],
  },
  {
    name: "deck",
    usage: "adcode [--continue|--session <id>] [--theme <name>] [--snapshot] [--json]",
    blurb: "Open the command deck; the home screen of the terminal app",
    group: "app",
    paragraphs: [
      "With no command, adcode opens the deck: a quiet home screen with one prompt. Type a question and press enter to start a continuing conversation, press tab to choose a model, or type / (or press ctrl+p) to open commands. Arrow keys move the palette, enter runs the selected command, and ctrl+c or ctrl+d leaves. Model and theme pickers return here.",
      "When output is piped, the deck prints one still frame instead. adcode --snapshot does that in a terminal too, and adcode --json returns the deck's inventory.",
    ],
    options: [
      ["--snapshot", "Print the still deck instead of opening it"],
      ["--continue, -c", "Open the newest saved conversation directly"],
      ["--session <id>", "Open a specific saved conversation directly"],
      ["--no-motion", "Keep the deck, skip the animation"],
      ["--theme <name>", "Open in a palette for this run"],
      ["--json", "Machine-readable deck inventory"],
    ],
    examples: [
      ["adcode", "Open the deck"],
      ["adcode --snapshot --width 100", "Print a still deck at a chosen width"],
    ],
  },
  {
    name: "chat",
    usage: "adcode chat [message] [--model <id>] [--continue|--session <id>] [--json]",
    blurb: "Talk to a live model, or get one answer and leave",
    group: "app",
    paragraphs: [
      "In a terminal, chat opens a full conversation: streamed replies, a saved transcript, Tab for the model catalogue, and a slash palette for /model, /new, /earn and /status. Type / or press ctrl+p to open it.",
      "With a message it is one-shot: the answer streams to the terminal and the exchange is saved, so adcode chat --continue can pick it up. --json returns the reply, usage and session as one object.",
      "Anything piped in is attached to the message, so git diff | adcode chat \"review this\" asks about the diff, and a piped question alone works too. When the output is redirected to a file or another program, only the reply is written, with no header or footer.",
      "Chat sends the conversation and the working directory to the selected model provider. It does not read project files. Provider credentials stay on this machine.",
    ],
    options: [
      ["--model <id>", "Use a specific model for this conversation"],
      ["--provider <id>", "Choose a provider, then its recommended model"],
      ["--continue, -c", "Resume the newest saved conversation"],
      ["--session <id>", "Resume one saved conversation: an id, its list number, or latest"],
      ["--effort <level>", "low, medium, high or max, when the model supports it"],
      ["--refresh", "Refresh the live model catalogue before answering"],
      ["--no-ads", "Do not schedule sponsored cards for this run"],
      ["--json", "Machine-readable reply, usage and session"],
    ],
    examples: [
      ["adcode chat", "Open the full conversation"],
      ["adcode chat \"explain this repository\"", "One answer, then back to the shell"],
      ["adcode chat --continue", "Resume where you stopped"],
      ["adcode chat --json \"summarise README.md\"", "Pipe a structured answer into another tool"],
      ["git diff | adcode chat \"review this\"", "Ask about whatever you pipe in"],
      ["adcode chat \"write a haiku\" > haiku.md", "Save only the reply"],
    ],
  },
  {
    name: "models",
    usage: "adcode models [list|use <id>|search <text>|refresh] [--all] [--json]",
    blurb: "Browse the catalogue, see what is ready, and choose what answers",
    group: "app",
    paragraphs: [
      "With no argument and a terminal, the picker opens with the providers that can answer now. Enter saves the choice; the next chat uses it. The same catalogue opens inside chat with Tab.",
      "Readiness is honest. Included AI reuses the account signed in to ADCode Desktop. Hosted providers need their key in the environment or the desktop keychain. Ollama is probed on this machine. A provider marked needs setup cannot be selected by accident.",
    ],
    options: [
      ["list", "Print the catalogue without the picker"],
      ["use <id>", "Save a model without opening the picker"],
      ["search <text>", "Filter by provider or model name"],
      ["refresh, --live", "Refresh models.dev and Included AI before listing"],
      ["--all", "Include providers that are not ready"],
      ["--provider <id>", "Show one provider"],
      ["--json", "Machine-readable catalogue and readiness"],
    ],
    examples: [
      ["adcode models", "Open the picker"],
      ["adcode models use tagflow-code-27b", "Save a model directly"],
      ["adcode models --all --json", "See every model and why it is or is not ready"],
    ],
  },
  {
    name: "sessions",
    usage: "adcode sessions [list|open|show|delete|rename|export] [id] [--json]",
    blurb: "Conversations saved on this machine",
    group: "app",
    paragraphs: [
      "Every exchange is written as one JSON file under the CLI data folder. There is no database and no second index: a saved session is a file, and deleting one deletes the file.",
      "In a terminal, adcode sessions opens a picker. Enter resumes, n starts a new chat, d deletes after a second press, and esc leaves without changing anything.",
      "Wherever an id is asked for, you can also give the conversation's number in adcode sessions list (1 is the newest), the word latest, or the first few letters of its id.",
    ],
    options: [
      ["list", "List the saved conversations"],
      ["open <id>", "Resume a conversation in chat"],
      ["show <id>", "Print the whole transcript"],
      ["delete <id>", "Delete one saved conversation"],
      ["rename <id> <title>", "Change the title shown in the list"],
      ["export <id>", "Print the conversation as Markdown"],
      ["--json", "Machine-readable session index or transcript"],
    ],
    examples: [
      ["adcode sessions", "Browse and resume"],
      ["adcode sessions show latest", "Read the newest transcript"],
      ["adcode sessions open 2", "Resume the second newest"],
      ["adcode sessions export s-abc123 > notes.md", "Keep a copy outside the CLI"],
    ],
  },
  {
    name: "earn",
    usage: "adcode earn [--json]",
    blurb: "The real balance, the caps, and what the cadence projects",
    group: "app",
    paragraphs: [
      "The numbers come from the same sponsor server and account as the desktop app. If the server is unreachable, the command says so and chat keeps working.",
      "Projections are the server's estimates, not a promise. The card runtime never blocks typing: ctrl+o opens a sponsor, ctrl+x dismisses the card, and focus reporting keeps impressions honest.",
    ],
    options: [
      ["--no-ads", "Report the account while leaving sponsored cards off"],
      ["--json", "Machine-readable balance, caps and receipts"],
    ],
    examples: [
      ["adcode earn", "Read the live balance"],
      ["adcode earn --json", "Feed the balance into a script"],
    ],
  },
  {
    name: "status",
    usage: "adcode status [--json]",
    blurb: "Account, model, ads, sessions and where state lives",
    group: "app",
    paragraphs: [
      "One screen for the state a terminal session actually uses: the shared identity, the selected model and its readiness, the live ad balance when the server answers, and the paths of the config, sessions and desktop profile.",
      "Every value is read from this machine. Nothing is inferred from a previous run.",
    ],
    options: [
      ["--json", "Machine-readable status"],
    ],
    examples: [
      ["adcode status", "Read the terminal's state"],
      ["adcode status --json", "Check state from a script or CI"],
    ],
  },
  {
    name: "doctor",
    usage: "adcode doctor [--live] [--verbose] [--json]",
    blurb: "Check the machine, account, model, sponsor service and local models",
    group: "app",
    paragraphs: [
      "Doctor checks Node, the terminal, the CLI data folder, the desktop profile, the account token, Included AI, the selected model, the sponsor service, Ollama and saved conversations. A warning carries a fix; a failure sets the exit code to 1.",
      "With --live it also spends one tiny model request proving the selected model answers. Without it, the round trip is reported as skipped so the check stays offline and quick.",
    ],
    options: [
      ["--live", "Make one real request to the selected model"],
      ["--verbose", "Show hints for passing checks too"],
      ["--json", "Machine-readable checks and summary"],
    ],
    examples: [
      ["adcode doctor", "A quick, offline check"],
      ["adcode doctor --live", "Prove the model, account and network end to end"],
    ],
  },
  {
    name: "theme",
    usage: "adcode theme [list|set <name>|show [name]] [--json]",
    blurb: "Preview and choose the terminal palette",
    group: "app",
    paragraphs: [
      "With no argument and a terminal, the picker previews each palette in place. Arrow keys move, enter saves, esc cancels without changing anything.",
      "The five palettes keep the same layout and glyphs; only the colours move. Midnight is the house style, paper is for light terminals, and graphite is the quiet one.",
    ],
    options: [
      ["list", "Print the palettes without the picker"],
      ["set <name>", "Save a palette directly"],
      ["show [name]", "Print a still preview of one palette"],
      ["--theme <name>", "Use a palette for this process only"],
      ["--json", "Machine-readable palette list"],
    ],
    examples: [
      ["adcode theme", "Open the palette picker"],
      ["adcode theme set paper", "Use the light palette from now on"],
    ],
  },
  {
    name: "tour",
    usage: "adcode tour [--no-motion] [--json]",
    blurb: "A short, skippable pass through the terminal app",
    group: "app",
    paragraphs: [
      "The tour opens a full-screen reel: what chat does, where models come from, how real sponsor cards behave, and where the commands live. Each slide is a still frame, so the same content is useful when motion is off or output is piped.",
      "Any key completes the current reveal. Left and right move between slides, enter advances, and q or esc leaves.",
    ],
    options: [
      ["--no-motion", "Keep the tour, remove the reveal"],
      ["--snapshot", "Print every slide as one page"],
      ["--json", "Machine-readable slide outline"],
    ],
    examples: [
      ["adcode tour", "Open the reel"],
      ["adcode tour --no-motion", "Read the slides without animation"],
    ],
  },
  {
    name: "help",
    usage: "adcode help [command] [--json]",
    blurb: "This page, or one command in detail",
    group: "app",
    paragraphs: [
      "With a command name it prints only that command's usage, options and examples. With --json it returns the whole reference for a documentation site or a shell completion generator.",
    ],
    options: [
      ["<command>", "deck, chat, models, sessions, earn, status, doctor, theme, tour, completion, help, version, or a developer command"],
      ["--json", "Machine-readable command reference"],
    ],
    examples: [
      ["adcode help chat", "One command, in full"],
      ["adcode help --json", "Every command as JSON"],
    ],
  },
  {
    name: "completion",
    usage: "adcode completion [bash|zsh|fish|powershell] [--install]",
    blurb: "Tab-complete commands, flags, models and sessions in your shell",
    group: "app",
    paragraphs: [
      "Prints a completion script for your shell. Once loaded, Tab completes adcode's commands, each command's actions, every flag, theme names, model ids from your catalogue and the ids of your saved conversations.",
      "With no shell named it guesses from the environment: PowerShell on Windows, otherwise the shell in $SHELL. With --install it appends one line to your shell's startup file, so new terminals have completion without you editing anything. Running it twice does not add the line twice.",
      "Model and session ids are read when you press Tab, so they stay current without reinstalling.",
    ],
    options: [
      ["bash, zsh, fish, powershell", "Print the script for that shell"],
      ["--install", "Add it to your shell's startup file"],
      ["--json", "The detected shell, the startup file and the script"],
    ],
    examples: [
      ["adcode completion --install", "Set up Tab completion for this shell"],
      ["adcode completion bash > ~/.adcode.bash", "Keep the script somewhere yourself"],
      ["adcode completion powershell | Out-String | Invoke-Expression", "Try it in this PowerShell window only"],
    ],
  },
  {
    name: "version",
    usage: "adcode version",
    blurb: "Print the version and leave",
    group: "app",
    paragraphs: ["Also available as adcode --version or adcode -v. The version is the repository's package version."],
    options: [],
    examples: [["adcode version", "Print 2.4.2 and leave"]],
  },
  {
    name: "open",
    usage: "adcode open [path]",
    blurb: "Build the editor and open it, optionally at a path",
    group: "developer",
    paragraphs: [
      "An alias for adcode app. Opens the current folder, or the file or folder you give it, in the desktop editor. Paths are resolved from your terminal before the launcher enters the source checkout.",
    ],
    options: [],
    examples: [["adcode open .", "Open this folder in the editor"]],
  },
  {
    name: "dev",
    usage: "adcode dev",
    blurb: "Open the editor with reloading, for working on it",
    group: "developer",
    paragraphs: ["Runs the repository's npm dev script. Unchanged."],
    options: [],
    examples: [["adcode dev", "Start the editor in development mode"]],
  },
  {
    name: "site",
    usage: "adcode site",
    blurb: "Run the website on http://localhost:3000",
    group: "developer",
    paragraphs: ["Runs the repository's npm web script. Unchanged."],
    options: [],
    examples: [["adcode site", "Start the website"]],
  },
  {
    name: "build",
    usage: "adcode build",
    blurb: "Build the editor without opening it",
    group: "developer",
    paragraphs: ["Runs the repository's npm desktop:build script. Unchanged."],
    options: [],
    examples: [["adcode build", "Build the desktop app"]],
  },
  {
    name: "installer",
    usage: "adcode installer",
    blurb: "Build an installer into release/",
    group: "developer",
    paragraphs: ["Runs the repository's npm package script. Unchanged."],
    options: [],
    examples: [["adcode installer", "Produce a distributable build"]],
  },
  {
    name: "check",
    usage: "adcode check",
    blurb: "Types, the dependency firewall, and every test",
    group: "developer",
    paragraphs: ["Runs the repository's npm verify script. Unchanged."],
    options: [],
    examples: [["adcode check", "Run the full verification pass"]],
  },
  {
    name: "test",
    usage: "adcode test [path]",
    blurb: "Just the tests",
    group: "developer",
    paragraphs: ["Runs the repository's npm test script. A path after the command is forwarded to Vitest."],
    options: [],
    examples: [["adcode test apps/cli", "Run the CLI tests only"]],
  },
  {
    name: "smoke",
    usage: "adcode smoke",
    blurb: "Drive the built editor and assert what a person would see",
    group: "developer",
    paragraphs: ["Runs the repository's npm smoke script. Unchanged."],
    options: [],
    examples: [["adcode smoke", "Run the editor smoke test"]],
  },
  {
    name: "ship",
    usage: "adcode ship",
    blurb: "Build the site and deploy it to Cloudflare",
    group: "developer",
    paragraphs: ["Runs the repository's npm web:deploy script. Unchanged."],
    options: [],
    examples: [["adcode ship", "Deploy the website"]],
  },
  {
    name: "icons",
    usage: "adcode icons",
    blurb: "Redraw the application icons",
    group: "developer",
    paragraphs: ["Runs the repository's npm icons script. Unchanged."],
    options: [],
    examples: [["adcode icons", "Regenerate icons"]],
  },
];

const GLOBAL_FLAGS: ReadonlyArray<readonly [string, string]> = [
  ["--json", "Machine-readable output for every reporting command"],
  ["--snapshot", "A still frame instead of a full-screen view"],
  ["--no-motion", "Keep every screen, remove the animation"],
  ["--no-color", "No ANSI colour; NO_COLOR also works"],
  ["--ascii", "Plain glyphs; ADCODE_CLI_ASCII=1 also works"],
  ["--width <n>", "Force a snapshot width"],
  ["--height <n>", "Force a snapshot height"],
  ["--no-ads", "Do not schedule sponsored cards for this run"],
  ["--provider <id>", "Choose a provider for this run"],
  ["--model <id>", "Choose a model for this run"],
  ["--effort <level>", "low, medium, high or max"],
  ["--session <id>", "Resume a conversation by id, list number or latest"],
  ["--continue, -c", "Resume the newest conversation"],
  ["--refresh", "Refresh the live catalogue where it applies"],
  ["--live", "Spend one real request in doctor"],
  ["--all", "Include models that are not ready"],
  ["--verbose", "More detail, including passing check hints"],
  ["--theme <name>", "Use a palette for this process only"],
];

const ENVIRONMENT: ReadonlyArray<readonly [string, string]> = [
  ["ADCODE_CLI_DATA_DIR", "Where the CLI keeps config, sessions, ads and cache"],
  ["ADCODE_DESKTOP_DATA_DIR", "Where to find the desktop profile"],
  ["ADCODE_AD_SERVER", "Point the ad client at a local server"],
  ["ADCODE_ASSET_HOST", "Asset host for local ad development"],
  ["ADCODE_SETTLE_MS", "Ad settlement window in milliseconds"],
  ["ADCODE_AD_TICK_MS", "How often the terminal checks for a sponsored card"],
  ["ADCODE_FIREBASE_API_KEY", "Override the public Firebase web key"],
  ["ADCODE_AUTH_EMULATOR", "Use the Firebase auth emulator"],
  ["NO_COLOR", "Standard no-colour switch"],
  ["ADCODE_CLI_ASCII", "Set to 1 for ASCII glyphs"],
  ["ADCODE_CLI_REDUCED_MOTION", "Set to 1 to disable animation"],
  ["OPENAI_API_KEY", "One example of a hosted provider key"],
  ["OLLAMA_HOST", "Point at a non-default Ollama server"],
];

const KEYS: ReadonlyArray<readonly [string, string]> = [
  ["↑ ↓", "move the palette, scroll a transcript"],
  ["enter", "run, send or resume"],
  ["tab", "model picker inside chat"],
  ["esc", "clear, close or cancel"],
  ["/", "open the chat command palette"],
  ["ctrl+p", "open the command palette"],
  ["ctrl+c", "stop a reply, then leave"],
  ["ctrl+d", "leave the deck or an empty prompt"],
  ["ctrl+n", "new conversation inside chat"],
  ["ctrl+o", "open the sponsored card"],
  ["ctrl+x", "dismiss the sponsored card"],
  ["ctrl+l", "redraw the screen"],
];

function rowLines(
  ui: AppContext["ui"],
  rows: ReadonlyArray<readonly [string, string]>,
  width: number,
  options: { pad?: number; tone?: string; bold?: boolean; rightTone?: string } = {},
): string[] {
  const lines: string[] = [];
  const pad = options.pad ?? 24;
  const tone = options.tone ?? "ink";
  const bold = options.bold ?? true;
  const rightTone = options.rightTone ?? "muted";
  const indent = " ".repeat(2 + pad);
  // Two columns while the description column keeps a readable width; below that the
  // label sits on its own line and the description wraps underneath it.
  const room = width - 2 - pad;
  const columns = room >= 24;
  for (const [left, right] of rows) {
    const label = String(left);
    const detail = String(right);
    if (columns && visibleWidth(label) <= pad - 2) {
      const parts = wrapPlain(detail, room);
      lines.push(`  ${ui.paint(label.padEnd(pad), tone, { bold })}${ui.paint(parts[0] ?? "", rightTone)}`);
      for (const part of parts.slice(1)) lines.push(`${indent}${ui.paint(part, rightTone)}`);
      continue;
    }
    for (const line of wrapPlain(label, Math.max(4, width - 2))) {
      lines.push(`  ${ui.paint(ui.truncate(line, Math.max(4, width - 2)), tone, { bold })}`);
    }
    const under = columns ? indent : "    ";
    for (const part of wrapPlain(detail, Math.max(4, width - under.length))) {
      lines.push(`${under}${ui.paint(part, rightTone)}`);
    }
  }
  return lines;
}

function pathLine(ui: AppContext["ui"], label: string, value: string, width: number): string[] {
  const inline = `  ${ui.paint(label.padEnd(9), "faint")}${ui.paint(ui.truncateMiddle(value, Math.max(4, width - 11)), "muted")}`;
  if (visibleWidth(inline) <= width) return [inline];
  return [
    `  ${ui.paint(label, "faint")}`,
    `  ${ui.paint(ui.truncateMiddle(value, Math.max(4, width - 2)), "muted")}`,
  ];
}

function overview(ctx: AppContext): string[] {
  const ui = ctx.ui;
  const width = Math.max(20, Math.min(ui.width - 4, 108));
  const lines = commandHeader(ui, {
    title: "ADCODE HELP",
    subtitle: "A terminal app for talking to live models, with real sponsor cards paying for the free tier.",
    note: `v${ctx.version} ${ui.glyphs.dot} ${ctx.isTTY ? "interactive terminal" : "plain output"} ${ui.glyphs.dot} ${ui.theme.label}`,
  });
  lines.push(`  ${ui.paint("Usage", "faint")}    ${ui.paint("adcode [command] [flags]", "accent")}`);
  lines.push("");

  lines.push(...sectionHeader(ui, "01", "TERMINAL APP", width));
  lines.push(...rowLines(ui, HELP_COMMANDS.filter((entry) => entry.group === "app").map((entry) => [entry.name, entry.blurb] as const), width, { pad: 12 }));
  lines.push("");
  lines.push(...sectionHeader(ui, "02", "DEVELOPER COMMANDS", width, "The original npm-script commands, unchanged."));
  lines.push(...rowLines(ui, HELP_COMMANDS.filter((entry) => entry.group === "developer").map((entry) => [entry.name, entry.blurb] as const), width, { pad: 12 }));
  lines.push("");
  lines.push(...sectionHeader(ui, "03", "GLOBAL FLAGS", width));
  lines.push(...rowLines(ui, GLOBAL_FLAGS, width, { pad: 22, tone: "accent", bold: false }));
  lines.push("");
  lines.push(...sectionHeader(ui, "04", "EXAMPLES", width));
  lines.push(...rowLines(ui, [
    ["adcode", "Open the deck"],
    ["adcode chat", "Talk to the selected live model"],
    ["adcode chat \"explain adcode open\"", "One answer and leave"],
    ["adcode models --all", "See every provider and what it needs"],
    ["adcode earn", "Read the real balance"],
    ["adcode doctor --live", "Prove the account, model and network"],
    ["git diff | adcode chat \"review\"", "Ask about anything you pipe in"],
    ["adcode sessions show latest", "Read the newest conversation"],
    ["adcode theme set paper", "Set a palette directly"],
    ["adcode completion --install", "Tab completion for your shell"],
    ["adcode app .", "Open the editor in this folder"],
  ], width, { pad: 34 }));
  lines.push("");
  lines.push(...sectionHeader(ui, "05", "ENVIRONMENT", width));
  lines.push(...rowLines(ui, ENVIRONMENT, width, { pad: 26, tone: "accent", bold: false }));
  lines.push("");
  lines.push(...sectionHeader(ui, "06", "KEYS", width));
  lines.push(...rowLines(ui, KEYS, width, { pad: 16, tone: "accent", bold: false }));
  lines.push("");
  lines.push(...pathLine(ui, "Config", cliPaths.config(), width));
  lines.push(...pathLine(ui, "Sessions", cliPaths.sessions(), width));
  lines.push(...pathLine(ui, "Desktop", desktopPaths.settings().replace(/[\\/]settings\.json$/, ""), width));
  lines.push("");
  for (const line of wrapPlain("Run adcode help <command> for one command in full. The deck also opens this page.", Math.max(8, width - 2))) {
    lines.push(`  ${ui.paint(line, "faint")}`);
  }
  lines.push("");
  return lines;
}

function detail(ctx: AppContext, command: HelpCommand): string[] {
  const ui = ctx.ui;
  const width = Math.max(20, Math.min(ui.width - 4, 108));
  const lines = commandHeader(ui, {
    title: `ADCODE ${command.name.toUpperCase()}`,
    subtitle: command.blurb,
    note: command.group === "developer" ? "developer command, unchanged" : "terminal app command",
  });
  const usage = `  ${ui.paint("Usage", "faint")}   ${ui.paint(command.usage, "accent")}`;
  if (visibleWidth(usage) <= width) {
    lines.push(usage);
  } else {
    lines.push(`  ${ui.paint("Usage", "faint")}`);
    for (const line of wrapPlain(command.usage, Math.max(8, width - 4))) {
      lines.push(`    ${ui.paint(line, "accent")}`);
    }
  }
  lines.push("");
  for (const paragraph of command.paragraphs) {
    for (const line of wrapPlain(paragraph, Math.max(8, width - 2))) lines.push(`  ${ui.paint(line, "muted")}`);
    lines.push("");
  }
  if (command.options.length > 0) {
    lines.push(...sectionHeader(ui, "", "OPTIONS", width));
    lines.push(...rowLines(ui, command.options, width, { pad: 22, tone: "accent", bold: false }));
    lines.push("");
  }
  if (command.examples.length > 0) {
    lines.push(...sectionHeader(ui, "", "EXAMPLES", width));
    lines.push(...rowLines(ui, command.examples, width, { pad: 34 }));
    lines.push("");
  }
  lines.push(`  ${ui.paint("Back", "faint")}    ${ui.paint("adcode help", "accent")}  ${ui.paint(ui.glyphs.dot, "borderSoft")}  ${ui.paint("the deck", "faint")}  ${ui.paint("adcode", "accent")}`);
  lines.push("");
  return lines;
}

function commandJson(entry: HelpCommand): Record<string, unknown> {
  return {
    name: entry.name,
    usage: entry.usage,
    blurb: entry.blurb,
    group: entry.group,
    paragraphs: entry.paragraphs,
    options: entry.options.map(([flag, description]) => ({ flag, description })),
    examples: entry.examples.map(([example, description]) => ({ example, description })),
  };
}

function payload(ctx: AppContext): Record<string, unknown> {
  return {
    generatedAt: new Date().toISOString(),
    command: "help",
    version: ctx.version,
    interactive: ctx.isTTY,
    theme: ctx.themeName,
    commands: HELP_COMMANDS.map(commandJson),
    flags: GLOBAL_FLAGS.map(([flag, description]) => ({ flag, description })),
    environment: ENVIRONMENT.map(([name, description]) => ({ name, description })),
    keys: KEYS.map(([key, action]) => ({ key, action })),
    paths: {
      config: cliPaths.config(),
      sessions: cliPaths.sessions(),
      desktop: desktopPaths.settings(),
    },
  };
}

export function runHelp(ctx: AppContext, args: readonly string[]): number {
  const requested = args[0]?.trim().toLowerCase() ?? "";
  if (ctx.flags.json) {
    if (requested.length > 0) {
      const command = HELP_COMMANDS.find((entry) => entry.name === requested);
      if (command === undefined) {
        ctx.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), command: "help", error: { message: `There is no "${requested}" command.` }, names: HELP_COMMANDS.map((entry) => entry.name) }, null, 2)}\n`);
        return 2;
      }
      ctx.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), command: "help", requested, commandDetail: commandJson(command) }, null, 2)}\n`);
      return 0;
    }
    ctx.stdout.write(`${JSON.stringify(payload(ctx), null, 2)}\n`);
    return 0;
  }

  if (requested.length > 0) {
    const command = HELP_COMMANDS.find((entry) => entry.name === requested);
    if (command === undefined) {
      const near = didYouMean(requested, HELP_COMMANDS.map((entry) => entry.name), (name) => `adcode help ${name}`);
      ctx.stderr.write(`${errorPanel(ctx.ui, {
        title: "No such command",
        message: `"${requested}" is not a command in this build.`,
        hint: near ?? `Try one of: ${HELP_COMMANDS.map((entry) => entry.name).join(", ")}.`,
      }).join("\n")}\n`);
      return 2;
    }
    printLines(detail(ctx, command), ctx.stdout);
    return 0;
  }

  printLines(overview(ctx), ctx.stdout);
  return 0;
}
