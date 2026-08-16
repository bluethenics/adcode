/**
 * Terminal sessions backed by node-pty.
 *
 * Brief §6: "The terminal is a headline feature, not an afterthought." This slice covers
 * real ptys, auto-detected profiles, resize, and clean disposal; shell integration,
 * splits, and link detection come with the terminal slice proper.
 *
 * node-pty ships N-API prebuilds, so it loads under Electron's ABI without a rebuild
 * step - which is what makes it usable here at all.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import pty from "node-pty";
import type { TerminalProfile } from "../shared/api.ts";

interface Session {
  readonly id: string;
  readonly process: pty.IPty;
}

const sessions = new Map<string, Session>();
let nextId = 0;

function windowsProfiles(): TerminalProfile[] {
  const system = process.env["SystemRoot"] ?? "C:\\Windows";
  const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";

  const candidates: TerminalProfile[] = [
    { id: "pwsh", label: "PowerShell", shell: `${programFiles}\\PowerShell\\7\\pwsh.exe`, args: [] },
    {
      id: "powershell",
      label: "Windows PowerShell",
      shell: `${system}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
      args: [],
    },
    { id: "cmd", label: "Command Prompt", shell: `${system}\\System32\\cmd.exe`, args: [] },
    { id: "git-bash", label: "Git Bash", shell: `${programFiles}\\Git\\bin\\bash.exe`, args: ["-i", "-l"] },
  ];

  return candidates.filter((profile) => existsSync(profile.shell));
}

function unixProfiles(): TerminalProfile[] {
  const candidates: TerminalProfile[] = [
    { id: "zsh", label: "zsh", shell: "/bin/zsh", args: ["-l"] },
    { id: "bash", label: "bash", shell: "/bin/bash", args: ["-l"] },
    { id: "fish", label: "fish", shell: "/usr/bin/fish", args: ["-l"] },
    { id: "sh", label: "sh", shell: "/bin/sh", args: [] },
  ];

  return candidates.filter((profile) => existsSync(profile.shell));
}

/** §6: auto-detected profiles. Only shells that actually exist are offered. */
export function detectProfiles(): TerminalProfile[] {
  const detected = process.platform === "win32" ? windowsProfiles() : unixProfiles();
  if (detected.length > 0) return detected;

  // Never return nothing: a terminal that cannot open at all is worse than one running
  // whatever the environment says the shell is.
  const fallback = process.env["SHELL"] ?? (process.platform === "win32" ? "cmd.exe" : "/bin/sh");
  return [{ id: "default", label: "Default Shell", shell: fallback, args: [] }];
}

export interface TerminalEvents {
  onData(id: string, data: string): void;
  onExit(id: string, exitCode: number): void;
}

export function createTerminal(
  options: { profileId?: string; cwd?: string; cols: number; rows: number },
  events: TerminalEvents,
): string {
  const profiles = detectProfiles();
  const profile = profiles.find((p) => p.id === options.profileId) ?? profiles[0];
  if (profile === undefined) throw new Error("no shell available");

  const id = `term-${++nextId}`;

  const child = pty.spawn(profile.shell, [...profile.args], {
    name: "xterm-color",
    cols: Math.max(2, Math.floor(options.cols)),
    rows: Math.max(1, Math.floor(options.rows)),
    cwd: options.cwd ?? homedir(),
    env: { ...process.env } as Record<string, string>,
  });

  child.onData((data) => events.onData(id, data));
  child.onExit(({ exitCode }) => {
    sessions.delete(id);
    events.onExit(id, exitCode);
  });

  sessions.set(id, { id, process: child });
  return id;
}

export function writeTerminal(id: string, data: string): void {
  sessions.get(id)?.process.write(data);
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  const session = sessions.get(id);
  if (session === undefined) return;

  try {
    session.process.resize(Math.max(2, Math.floor(cols)), Math.max(1, Math.floor(rows)));
  } catch {
    // A resize racing a dying pty throws; the exit handler is already cleaning up.
  }
}

export function disposeTerminal(id: string): void {
  const session = sessions.get(id);
  if (session === undefined) return;

  sessions.delete(id);
  try {
    session.process.kill();
  } catch {
    // Already gone.
  }
}

/** Called on quit: orphaned pty children outlive the app otherwise. */
export function disposeAllTerminals(): void {
  for (const id of [...sessions.keys()]) disposeTerminal(id);
}
