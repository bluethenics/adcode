/**
 * Noticing that an AI agent is running in the terminal.
 *
 * The point is not surveillance, it is that two assistants working on one project should
 * not each be starting from nothing. ADCode already keeps a shared project memory and
 * already knows the one command that connects an external agent to it; what it has been
 * missing is the moment to offer it. That moment is when somebody starts an agent.
 *
 * **Detection is from the command line the user typed, not from the process table.**
 * Enumerating a pty's descendants is platform-specific, needs elevated access on some
 * systems, and would be a genuinely invasive thing for an editor to do. What the user typed
 * into the terminal is already passing through this process on its way to the shell.
 *
 * Pure, so the parsing is tested against strings rather than by starting subprocesses.
 */

export type AgentId = "claude" | "codex" | "gemini" | "aider" | "opencode" | "cursor" | "copilot";

export interface DetectedAgent {
  readonly id: AgentId;
  /** What to call it in the strip. */
  readonly name: string;
}

/**
 * The programs worth recognising, by the word that starts them.
 *
 * Matched against the command *name* only. A substring match would fire on `git commit -m
 * "ask claude about this"`, which is somebody talking about an agent rather than running
 * one - and an offer that appears when you mention a word is the kind of thing people
 * switch off within a day.
 */
const AGENTS = new Map<string, DetectedAgent>(
  Object.entries({
    claude: { id: "claude", name: "Claude Code" },
    codex: { id: "codex", name: "Codex" },
    gemini: { id: "gemini", name: "Gemini CLI" },
    aider: { id: "aider", name: "Aider" },
    opencode: { id: "opencode", name: "OpenCode" },
    "cursor-agent": { id: "cursor", name: "Cursor Agent" },
    copilot: { id: "copilot", name: "GitHub Copilot CLI" },
  }) as [string, DetectedAgent][],
);

/** Runners that put the real command one word later. */
const RUNNERS = new Set(["npx", "pnpm", "bunx", "yarn", "uvx", "uv", "pipx", "sudo", "time", "env"]);

/**
 * The agent a command line starts, or `null`.
 *
 * Handles the shapes people actually type: a bare name, a runner in front of it, a path to
 * the binary, and leading environment assignments.
 */
export function detectAgent(commandLine: string): DetectedAgent | null {
  const trimmed = commandLine.trim();
  if (trimmed.length === 0) return null;

  // Anything after a pipe or a chain is a separate command; only the first is being started
  // here, and guessing at the rest would fire on `echo hi && claude` twice.
  const first = trimmed.split(/[|;&]/)[0] ?? "";

  const words = first.split(/\s+/).filter((word) => word.length > 0);

  for (const word of words) {
    // `API_KEY=x claude` - an assignment is not the command.
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue;
    if (RUNNERS.has(word)) continue;

    // A path to the binary counts: `./node_modules/.bin/claude` is still Claude Code.
    const name = (word.split(/[\\/]/).pop() ?? word).replace(/\.(exe|cmd|bat|ps1)$/i, "");

    const found = AGENTS.get(name.toLowerCase());
    return found ?? null;
  }

  return null;
}

/**
 * Keep track of what has been typed at a prompt, so a line can be tested when it is run.
 *
 * A terminal delivers keystrokes, not lines. This is the small state machine that turns one
 * into the other: printable characters accumulate, backspace removes, Ctrl+C abandons, and
 * a carriage return hands over whatever was built and starts again.
 *
 * It deliberately understands very little. Arrow keys, history recall and tab completion
 * all arrive as escape sequences, and a line assembled from them will not match - which
 * costs an offer that would have been nice to make, and never produces a wrong one.
 */
export interface CommandLineReader {
  /** Feed raw terminal input. Returns a completed command line when one is submitted. */
  push(data: string): string | null;
  reset(): void;
}

export function createCommandLineReader(): CommandLineReader {
  let buffer = "";

  return {
    push(data: string): string | null {
      let submitted: string | null = null;

      for (const character of data) {
        const code = character.codePointAt(0) ?? 0;

        if (character === "\r" || character === "\n") {
          submitted = buffer;
          buffer = "";
          continue;
        }

        // Backspace and delete.
        if (code === 8 || code === 127) {
          buffer = buffer.slice(0, -1);
          continue;
        }

        /*
         * Ctrl+C and Ctrl+U abandon the line. Escape does not.
         *
         * Escape is the first byte of every arrow key and every other cursor sequence, so
         * treating it as "abandon" wiped the line on any edit. It is dropped as an ordinary
         * control character below instead, which leaves the `[D` of an arrow key behind as
         * text - the line comes out mangled and matches nothing, which is the safe way to
         * be wrong.
         */
        if (code === 3 || code === 21) {
          buffer = "";
          continue;
        }

        // Everything else non-printable is a control or the start of an escape sequence,
        // and including it would only corrupt the line.
        if (code < 32) continue;

        buffer += character;
      }

      return submitted;
    },

    reset(): void {
      buffer = "";
    },
  };
}
