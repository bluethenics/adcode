import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { AppContext } from "../context.ts";
import { commandHeader, errorPanel, printLines, successPanel } from "../tui/components.ts";
import { cliDataDir } from "../util/paths.ts";
import { didYouMean } from "../util/suggest.ts";
import { completionScript, scriptExtension } from "../completion/scripts.ts";
import { SHELLS, type ShellName } from "../completion/words.ts";

/**
 * `adcode completion`: Tab completion for the shell a person already uses.
 *
 * Install writes the script into the CLI data folder and adds one guarded line to the
 * shell's startup file, so the startup file never runs adcode itself (that would cost a
 * Node start on every new terminal). Fish loads its completions folder on its own, so it
 * gets the file there and no startup line at all.
 */

const MARKER = "# adcode completion";

function isShell(value: string): value is ShellName {
  return (SHELLS as readonly string[]).includes(value);
}

export function detectShell(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): ShellName {
  const shell = basename(env["SHELL"] ?? "").replace(/\.exe$/i, "").toLowerCase();
  if (shell === "zsh" || shell === "fish" || shell === "bash") return shell;
  if (platform === "win32") return "powershell";
  if (env["PSModulePath"] !== undefined && env["SHELL"] === undefined) return "powershell";
  return "bash";
}

interface InstallPlan {
  readonly shell: ShellName;
  readonly scriptFile: string;
  /** The startup file that sources the script, or null when the shell finds it on its own. */
  readonly startupFile: string | null;
  readonly line: string | null;
}

function powershellProfile(env: NodeJS.ProcessEnv): string | null {
  // PowerShell 7 puts its own module folder on PSModulePath; Windows PowerShell 5.1 does not.
  const modern = /powershell[\\/]7/i.test(env["PSModulePath"] ?? "");
  for (const executable of modern ? ["pwsh", "powershell"] : ["powershell", "pwsh"]) {
    const result = spawnSync(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$PROFILE.CurrentUserCurrentHost"], {
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    });
    const path = result.status === 0 ? result.stdout.trim() : "";
    if (path.length > 0) return path;
  }
  return null;
}

function profileOverride(env: NodeJS.ProcessEnv): string | undefined {
  const value = env["ADCODE_SHELL_PROFILE"]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

export function scriptFileFor(shell: ShellName, env: NodeJS.ProcessEnv): string {
  if (shell === "fish") {
    return profileOverride(env) ?? join(env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"), "fish", "completions", "adcode.fish");
  }
  return join(cliDataDir(env), "completion", `adcode.${scriptExtension(shell)}`);
}

function installPlan(shell: ShellName, env: NodeJS.ProcessEnv): InstallPlan {
  const override = profileOverride(env);
  const home = homedir();
  const scriptFile = scriptFileFor(shell, env);
  if (shell === "fish") return { shell, scriptFile, startupFile: null, line: null };
  if (shell === "powershell") {
    const startupFile = override ?? powershellProfile(env);
    const quoted = scriptFile.replace(/'/g, "''");
    return { shell, scriptFile, startupFile, line: `if (Test-Path '${quoted}') { . '${quoted}' } ${MARKER}` };
  }
  const startupFile = override ?? (shell === "zsh" ? join(env["ZDOTDIR"] ?? home, ".zshrc") : join(home, ".bashrc"));
  // Git Bash and zsh on Windows read forward slashes; a backslash path would be an escape.
  const posixPath = (process.platform === "win32" ? scriptFile.replace(/\\/g, "/") : scriptFile).replace(/'/g, "'\\''");
  return { shell, scriptFile, startupFile, line: `[ -f '${posixPath}' ] && . '${posixPath}' ${MARKER}` };
}

function install(ctx: AppContext, shell: ShellName): number {
  const plan = installPlan(shell, ctx.env);
  if (plan.line !== null && plan.startupFile === null) {
    const message = "Could not find your PowerShell profile.";
    if (ctx.flags.json) {
      ctx.stdout.write(`${JSON.stringify({ command: "completion", action: "install", shell, error: { message } }, null, 2)}\n`);
    } else {
      ctx.stderr.write(`${errorPanel(ctx.ui, {
        title: "Not installed",
        message,
        hint: "Add this to the file $PROFILE names, then open a new window: adcode completion powershell | Out-String | Invoke-Expression",
      }).join("\n")}\n`);
    }
    return 1;
  }

  mkdirSync(dirname(plan.scriptFile), { recursive: true });
  writeFileSync(plan.scriptFile, completionScript(shell), "utf8");

  let added = false;
  if (plan.startupFile !== null && plan.line !== null) {
    const existing = existsSync(plan.startupFile) ? readFileSync(plan.startupFile, "utf8") : "";
    if (!existing.includes(MARKER)) {
      mkdirSync(dirname(plan.startupFile), { recursive: true });
      const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
      appendFileSync(plan.startupFile, `${separator}${plan.line}\n`, "utf8");
      added = true;
    }
  }

  if (ctx.flags.json) {
    ctx.stdout.write(`${JSON.stringify({
      command: "completion",
      action: "install",
      shell,
      scriptFile: plan.scriptFile,
      startupFile: plan.startupFile,
      startupLineAdded: added,
    }, null, 2)}\n`);
    return 0;
  }
  const details = plan.startupFile === null
    ? `Wrote ${plan.scriptFile}. Fish loads it by itself.`
    : added
      ? `Wrote ${plan.scriptFile} and added one line to ${plan.startupFile}.`
      : `Refreshed ${plan.scriptFile}. ${plan.startupFile} already loads it, so nothing else changed.`;
  printLines([
    "",
    ...successPanel(ctx.ui, {
      title: `Tab completion for ${shell}`,
      message: "Open a new terminal, type adcode and press Tab.",
      details,
    }),
    "",
  ], ctx.stdout);
  return 0;
}

function guide(ctx: AppContext, shell: ShellName): number {
  const ui = ctx.ui;
  const lines = commandHeader(ui, {
    title: "ADCODE COMPLETION",
    subtitle: "Tab-complete commands, flags, models and saved sessions.",
    note: `your shell looks like ${shell}`,
  });
  const row = (command: string, what: string): string => `  ${ui.paint(command.padEnd(36), "accent")}${ui.paint(what, "muted")}`;
  lines.push(row("adcode completion install", "set it up for this shell, once"));
  lines.push(row(`adcode completion ${shell}`, "print the script yourself"));
  lines.push(row("adcode completion install zsh", "set it up for another shell"));
  lines.push("");
  lines.push(`  ${ui.paint("Supported: bash, zsh, fish and PowerShell. Installing twice changes nothing.", "faint")}`);
  lines.push("");
  printLines(lines, ctx.stdout);
  return 0;
}

export function runCompletion(ctx: AppContext, args: readonly string[]): number {
  const action = args[0]?.toLowerCase() ?? null;
  const detected = detectShell(ctx.env);

  if (action === "install") {
    const requested = args[1]?.toLowerCase() ?? detected;
    if (!isShell(requested)) return unknownShell(ctx, requested);
    return install(ctx, requested);
  }

  if (action !== null && !isShell(action)) return unknownShell(ctx, action);
  const shell = action ?? detected;

  if (ctx.flags.json) {
    ctx.stdout.write(`${JSON.stringify({
      command: "completion",
      shell,
      detected,
      shells: SHELLS,
      scriptFile: scriptFileFor(shell, ctx.env),
      script: completionScript(shell),
    }, null, 2)}\n`);
    return 0;
  }

  // In a terminal with no shell named, explain; otherwise print the script so it can be
  // redirected, piped into Invoke-Expression, or sourced.
  if (action === null && ctx.stdout.isTTY === true) return guide(ctx, shell);
  ctx.stdout.write(completionScript(shell));
  return 0;
}

function unknownShell(ctx: AppContext, name: string): number {
  const near = didYouMean(name, [...SHELLS, "install"]);
  const message = `"${name}" is not a shell adcode can complete in.`;
  if (ctx.flags.json) {
    ctx.stdout.write(`${JSON.stringify({ command: "completion", error: { message }, shells: SHELLS }, null, 2)}\n`);
    return 2;
  }
  ctx.stderr.write(`${errorPanel(ctx.ui, {
    title: "Unknown shell",
    message,
    hint: `${near === null ? "" : `${near} `}Supported: bash, zsh, fish, powershell.`,
  }).join("\n")}\n`);
  return 2;
}
