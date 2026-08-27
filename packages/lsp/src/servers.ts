/**
 * The language servers ADCode knows how to talk to.
 *
 * **None of these ship inside the binary.** The brief asks for bundled servers, and that is
 * the right end state, but it is a packaging job measured in hundreds of megabytes -
 * `rust-analyzer` alone is about 70 MB per platform - and it has to happen in the installer,
 * not in a TypeScript file. What this table does is the other half of the work: know how to
 * start each one, know which languages it serves, and know what to tell the user when it is
 * not there.
 *
 * That last part is why `installHint` is a required field rather than a nicety. A beginner
 * who opens a Python file and gets nothing has no way to discover that a separate program
 * was supposed to be running. One line telling them the exact command turns a dead end into
 * a two-minute fix, and it is the entire difference between "this editor has no Python
 * support" and "this editor needs one more install".
 *
 * Pure data. `main/lsp.ts` does the looking-up and the spawning.
 */

export interface ServerSpec {
  readonly id: string;
  readonly label: string;
  /** Monaco language ids this server should be started for. */
  readonly languages: readonly string[];
  /** Executable name, resolved against PATH. Never an absolute path: that is the OS's job. */
  readonly command: string;
  readonly args: readonly string[];
  /** Shown once, as an `info` row, when the command is not on PATH. */
  readonly installHint: string;
}

/**
 * TypeScript and JavaScript are deliberately absent.
 *
 * Monaco's own worker already type-checks them, in-process, with no install step - and
 * running `typescript-language-server` alongside it would produce two diagnostics for every
 * error, differing slightly, in a panel whose whole value is that everything in it is worth
 * acting on. The worker is the right answer for those two languages until it stops being.
 */
export const SERVERS: readonly ServerSpec[] = [
  {
    id: "pyright",
    label: "Pyright",
    languages: ["python"],
    command: "pyright-langserver",
    args: ["--stdio"],
    installHint: "npm install -g pyright",
  },
  {
    id: "rust-analyzer",
    label: "rust-analyzer",
    languages: ["rust"],
    command: "rust-analyzer",
    args: [],
    installHint: "rustup component add rust-analyzer",
  },
  {
    id: "gopls",
    label: "gopls",
    languages: ["go"],
    command: "gopls",
    args: [],
    installHint: "go install golang.org/x/tools/gopls@latest",
  },
  {
    id: "clangd",
    label: "clangd",
    languages: ["c", "cpp", "objective-c"],
    command: "clangd",
    args: ["--background-index"],
    installHint: "Install LLVM, or your platform's clangd package",
  },
  {
    id: "lua-language-server",
    label: "Lua Language Server",
    languages: ["lua"],
    command: "lua-language-server",
    args: [],
    installHint: "Install lua-language-server from your package manager",
  },
  {
    id: "solargraph",
    label: "Solargraph",
    languages: ["ruby"],
    command: "solargraph",
    args: ["stdio"],
    installHint: "gem install solargraph",
  },
  {
    id: "intelephense",
    label: "Intelephense",
    languages: ["php"],
    command: "intelephense",
    args: ["--stdio"],
    installHint: "npm install -g intelephense",
  },
  {
    id: "bash-language-server",
    label: "Bash Language Server",
    languages: ["shell"],
    command: "bash-language-server",
    args: ["start"],
    installHint: "npm install -g bash-language-server",
  },
  {
    id: "yaml-language-server",
    label: "YAML Language Server",
    languages: ["yaml"],
    command: "yaml-language-server",
    args: ["--stdio"],
    installHint: "npm install -g yaml-language-server",
  },
  {
    id: "marksman",
    label: "Marksman",
    languages: ["markdown"],
    command: "marksman",
    args: ["server"],
    installHint: "Download marksman from its GitHub releases",
  },
];

export function serverFor(languageId: string): ServerSpec | null {
  return SERVERS.find((server) => server.languages.includes(languageId)) ?? null;
}

export function languagesWithServers(): string[] {
  return [...new Set(SERVERS.flatMap((server) => [...server.languages]))];
}

/**
 * A server the user registered themselves.
 *
 * §4's escape hatch, and the thing that replaces an extension system for languages nobody
 * bundled. The settings value is a line per server, `languageId: command arg arg`, because
 * a text field someone can paste into beats a JSON blob they have to get exactly right.
 */
export function parseCustomServers(value: string): ServerSpec[] {
  const out: ServerSpec[] = [];

  for (const raw of value.split(/[\n;]/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const colon = line.indexOf(":");
    if (colon <= 0) continue;

    const languageId = line.slice(0, colon).trim().toLowerCase();
    const parts = line
      .slice(colon + 1)
      .trim()
      .split(/\s+/)
      .filter((part) => part.length > 0);

    const command = parts[0];
    if (languageId.length === 0 || command === undefined) continue;

    out.push({
      id: `custom:${languageId}`,
      label: `${command} (custom)`,
      languages: [languageId],
      command,
      args: parts.slice(1),
      installHint: `Check that \`${command}\` is on your PATH`,
    });
  }

  return out;
}

/**
 * Custom entries win.
 *
 * Someone who has written a line in settings has expressed a preference about that
 * language, and a built-in default that silently overrode it would be unfixable from the
 * only place the user has to say anything.
 */
export function resolveServer(
  languageId: string,
  custom: readonly ServerSpec[],
): ServerSpec | null {
  return custom.find((server) => server.languages.includes(languageId)) ?? serverFor(languageId);
}
