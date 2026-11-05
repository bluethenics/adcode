import { readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import type { ThemeKind } from "../../../packages/ads/src/types.ts";
import type { UI } from "./tui/ui.ts";
import { createUI } from "./tui/ui.ts";
import { createMotion, type Motion } from "./tui/motion.ts";
import {
  configExists,
  loadConfig,
  saveConfig,
  setModelChoice,
  setTheme,
  type CliConfig,
  type ModelChoiceConfig,
} from "./config.ts";
import { readDesktopSnapshot, desktopTheme, type DesktopSnapshot } from "./desktop.ts";
import { createAccount, type Account } from "./account.ts";
import {
  cachedTagflowConfig,
  fetchTagflowConfig,
  loadCatalogue,
  resolveSelection,
  type CatalogueSnapshot,
  type ModelSelection,
} from "./ai/catalogue.ts";
import { buildProvider, type BuiltProvider } from "./ai/provider.ts";
import { isThemeName } from "./tui/theme.ts";
import { buildSource } from "./util/paths.ts";
import { didYouMean } from "./util/suggest.ts";
import { KNOWN_FLAGS, VALUE_FLAGS } from "./completion/words.ts";
import { writeCompletionCache } from "./completion/complete.ts";

export interface Flags {
  readonly json: boolean;
  readonly snapshot: boolean;
  readonly live: boolean;
  readonly all: boolean;
  readonly width: number | null;
  readonly height: number | null;
  readonly noColor: boolean;
  readonly ascii: boolean;
  readonly noMotion: boolean;
  readonly noAds: boolean;
  readonly provider: string | null;
  readonly model: string | null;
  readonly theme: string | null;
  readonly session: string | null;
  readonly continueSession: boolean;
  readonly effort: string | null;
  readonly verbose: boolean;
  readonly refresh: boolean;
}

export interface ContextOptions {
  readonly flags: Flags;
  readonly cwd?: string;
  readonly stdin?: NodeJS.ReadStream;
  readonly stdout?: NodeJS.WriteStream;
  readonly stderr?: NodeJS.WriteStream;
  readonly env?: NodeJS.ProcessEnv;
}

export class AppContext {
  readonly flags: Flags;
  readonly cwd: string;
  readonly stdin: NodeJS.ReadStream;
  readonly stdout: NodeJS.WriteStream;
  readonly stderr: NodeJS.WriteStream;
  readonly env: NodeJS.ProcessEnv;
  readonly version: string;
  readonly root: string;
  readonly desktop: DesktopSnapshot;
  readonly account: Account;
  readonly isTTY: boolean;
  readonly color: boolean;
  readonly unicode: boolean;
  readonly motion: Motion;
  config: CliConfig;
  catalogue!: CatalogueSnapshot;
  selection!: ModelSelection;
  ui!: UI;
  themeName: string;

  constructor(options: ContextOptions, desktop: DesktopSnapshot, account: Account) {
    this.flags = options.flags;
    this.cwd = options.cwd ?? process.cwd();
    this.stdin = options.stdin ?? process.stdin;
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
    this.env = options.env ?? process.env;
    const source = buildSource();
    this.version = source.version;
    this.root = source.root;
    this.desktop = desktop;
    this.account = account;
    this.isTTY = Boolean(this.stdin.isTTY === true && this.stdout.isTTY === true) && !this.flags.json && !this.flags.snapshot;
    this.color = this.isTTY && !this.flags.noColor && this.env["NO_COLOR"] === undefined && this.env["TERM"] !== "dumb";
    this.unicode = !this.flags.ascii && this.env["ADCODE_CLI_ASCII"] !== "1";
    this.config = loadConfig();
    if (!configExists()) {
      this.config = {
        ...this.config,
        ads: { enabled: this.desktop.settings.adsEnabled, preset: this.desktop.settings.adsPreset },
      };
    }
    this.themeName = this.resolveThemeName();
    this.motion = createMotion({
      enabled: this.config.motion && this.isTTY && !this.flags.noMotion && this.env["TERM"] !== "dumb" && this.env["ADCODE_CLI_REDUCED_MOTION"] !== "1",
      out: this.stdout,
    });
    this.ui = this.makeUI();
  }

  resolveThemeName(): string {
    if (this.flags.theme !== null && isThemeName(this.flags.theme)) return this.flags.theme;
    if (configExists() && isThemeName(this.config.theme)) return this.config.theme;
    const fromDesktop = desktopTheme(this.desktop.settings.theme);
    return isThemeName(fromDesktop) ? fromDesktop : this.config.theme;
  }

  makeUI(overrides: { theme?: string; width?: number; height?: number; color?: boolean; unicode?: boolean } = {}): UI {
    return createUI({
      theme: overrides.theme ?? this.themeName,
      color: overrides.color ?? this.color,
      unicode: overrides.unicode ?? this.unicode,
      width: overrides.width ?? this.flags.width ?? this.stdout.columns ?? 80,
      height: overrides.height ?? this.flags.height ?? this.stdout.rows ?? 30,
    });
  }

  resize(): void {
    this.ui.width = this.stdout.columns ?? this.ui.width;
    this.ui.height = this.stdout.rows ?? this.ui.height;
  }

  async loadInitialCatalogue(): Promise<void> {
    this.catalogue = await loadCatalogue({
      snapshot: this.desktop,
      tagflow: cachedTagflowConfig(),
      tagflowToken: null,
      ollama: { running: false, models: [], detail: "not probed yet" },
    });
    this.selection = resolveSelection(this.catalogue, this.config.model, this.desktop);
    writeCompletionCache(this.catalogue.providers);
  }

  async refreshCatalogue(options: { live?: boolean } = {}): Promise<void> {
    const token = await this.account.token();
    const fresh = options.live === true ? await fetchTagflowConfig(token) : null;
    this.catalogue = await loadCatalogue({
      snapshot: this.desktop,
      tagflowToken: token,
      ...(options.live === true && fresh !== null ? { tagflow: fresh } : {}),
      refresh: options.live === true,
      probeLocal: true,
    });
    this.selection = resolveSelection(this.catalogue, this.config.model, this.desktop);
    writeCompletionCache(this.catalogue.providers);
  }

  async buildSelection(): Promise<BuiltProvider> {
    if (!this.selection.ready) {
      await this.refreshCatalogue();
    }
    if (!this.selection.ready) {
      throw new Error(this.selection.reason ?? `${this.selection.providerName} is not ready.`);
    }
    const provider = this.catalogue.providers.find((one) => one.id === this.selection.providerId);
    if (provider === undefined) throw new Error(`${this.selection.providerName} is no longer available.`);
    return buildProvider(provider, this.selection, {
      desktop: this.desktop,
      token: () => this.account.token(),
      env: this.env,
    });
  }

  chooseModel(providerId: string, modelId: string, persist = true): void {
    const provider = this.catalogue.providers.find((one) => one.id === providerId);
    if (provider === undefined) return;
    const model = provider.models.find((one) => one.id === modelId) ?? provider.models[0];
    if (model === undefined) return;
    const choice: ModelChoiceConfig = { provider: providerId, model: model.id };
    if (persist) this.config = setModelChoice(choice);
    this.selection = {
      providerId,
      providerName: provider.name,
      modelId: model.id,
      modelName: model.name,
      ready: provider.ready,
      reason: provider.ready ? null : provider.note,
      choice,
      included: model.included,
    };
  }

  setTheme(theme: string, persist = true): void {
    if (!isThemeName(theme)) return;
    this.themeName = theme;
    if (persist) this.config = setTheme(theme);
    this.ui = this.makeUI();
  }

  saveConfig(next: CliConfig): void {
    this.config = next;
    saveConfig(next);
  }

  adThemeKind(): ThemeKind {
    return this.ui.theme.isLight ? "light" : "dark";
  }

  /** Vocabulary, never contents: language ids for the ad tagger. */
  workspaceSignals(): { languageIds: string[]; filenames: string[] } {
    const languages = new Set<string>();
    const filenames: string[] = [];
    const extensions: Record<string, string> = {
      ".ts": "typescript",
      ".tsx": "typescriptreact",
      ".js": "javascript",
      ".jsx": "javascriptreact",
      ".mjs": "javascript",
      ".cjs": "javascript",
      ".json": "json",
      ".css": "css",
      ".scss": "scss",
      ".html": "html",
      ".md": "markdown",
      ".py": "python",
      ".rs": "rust",
      ".go": "go",
      ".java": "java",
      ".c": "c",
      ".h": "c",
      ".cpp": "cpp",
      ".cs": "csharp",
      ".rb": "ruby",
      ".php": "php",
      ".swift": "swift",
      ".kt": "kotlin",
      ".sh": "shellscript",
      ".yml": "yaml",
      ".yaml": "yaml",
      ".sql": "sql",
      ".vue": "vue",
      ".svelte": "svelte",
    };
    const walk = (directory: string, depth: number): void => {
      if (depth > 1 || languages.size >= 8) return;
      let entries: string[] = [];
      try {
        entries = readdirSync(directory);
      } catch {
        return;
      }
      for (const name of entries) {
        if (name.startsWith(".") || name === "node_modules" || name === "dist" || name === "out") continue;
        const path = join(directory, name);
        let isDirectory = false;
        try {
          isDirectory = statSync(path).isDirectory();
        } catch {
          continue;
        }
        if (isDirectory) {
          walk(path, depth + 1);
          continue;
        }
        const language = extensions[extname(name).toLowerCase()];
        if (language !== undefined) languages.add(language);
        if (filenames.length < 24) filenames.push(name);
      }
    };
    walk(this.cwd, 0);
    return { languageIds: [...languages], filenames };
  }
}

export async function createContext(options: ContextOptions): Promise<AppContext> {
  const desktop = readDesktopSnapshot();
  const account = await createAccount({ env: options.env ?? process.env });
  const context = new AppContext(options, desktop, account);
  await context.loadInitialCatalogue();
  return context;
}

export { KNOWN_FLAGS };

export function parseFlags(argv: readonly string[]): { flags: Flags; command: string | null; rest: string[] } {
  let json = false;
  let snapshot = false;
  let live = false;
  let all = false;
  let width: number | null = null;
  let height: number | null = null;
  let noColor = false;
  let ascii = false;
  let noMotion = false;
  let noAds = false;
  let provider: string | null = null;
  let model: string | null = null;
  let theme: string | null = null;
  let session: string | null = null;
  let continueSession = false;
  let effort: string | null = null;
  let verbose = false;
  let refresh = false;
  const rest: string[] = [];
  let command: string | null = null;
  let help = false;
  let version = false;
  const invalid = (message: string): never => {
    const error = new Error(message);
    error.name = "CliUsageError";
    throw error;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--") {
      const literal = argv.slice(index + 1);
      if (command === null) command = literal.shift() ?? null;
      rest.push(...literal);
      break;
    }
    if (!argument.startsWith("-")) {
      if (command === null) command = argument;
      else rest.push(argument);
      continue;
    }
    const [name, inline] = argument.includes("=") ? argument.split(/=(.*)/s, 2) : [argument, undefined];
    if (inline !== undefined && !VALUE_FLAGS.includes(name ?? "")) invalid(`${name} does not accept a value.`);
    const value = (): string => {
      const next = inline ?? argv[++index];
      if (next === undefined || next.trim().length === 0 || next.startsWith("--")) invalid(`${name} needs a value. Run adcode help.`);
      return next!;
    };
    const dimension = (minimum: number, maximum: number): number => {
      const raw = value();
      const number = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isInteger(number) || number < minimum || number > maximum) {
        invalid(`${name} must be a whole number from ${minimum} to ${maximum}.`);
      }
      return number;
    };
    switch (name) {
      case "--json":
        json = true;
        break;
      case "--snapshot":
        snapshot = true;
        break;
      case "--live":
        live = true;
        break;
      case "--all":
        all = true;
        break;
      case "--no-color":
        noColor = true;
        break;
      case "--ascii":
        ascii = true;
        break;
      case "--no-motion":
        noMotion = true;
        break;
      case "--no-ads":
        noAds = true;
        break;
      case "--continue":
      case "-c":
        continueSession = true;
        break;
      case "--refresh":
        refresh = true;
        break;
      case "--verbose":
        verbose = true;
        break;
      case "--width":
        width = dimension(20, 500);
        break;
      case "--height":
        height = dimension(10, 300);
        break;
      case "--provider":
        provider = value();
        break;
      case "--model":
        model = value();
        break;
      case "--theme":
        theme = value();
        if (!isThemeName(theme)) invalid(`Unknown theme "${theme}". Run adcode theme list.`);
        break;
      case "--session":
        session = value();
        break;
      case "--effort":
        effort = value();
        if (!["auto", "low", "medium", "high", "max"].includes(effort)) invalid("--effort must be auto, low, medium, high or max.");
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      case "--version":
      case "-v":
        version = true;
        break;
      default: {
        const near = didYouMean(name ?? argument, KNOWN_FLAGS);
        invalid(
          near !== null
            ? `Unknown option "${argument}". ${near}`
            : `Unknown option "${argument}". Run adcode help for the flags; put -- before a message that starts with a dash.`,
        );
        break;
      }
    }
  }

  return {
    flags: { json, snapshot, live, all, width, height, noColor, ascii, noMotion, noAds, provider, model, theme, session, continueSession, effort, verbose, refresh },
    command: version ? "version" : help ? "help" : command,
    rest: help && command !== null && command !== "help" ? [command, ...rest] : rest,
  };
}
