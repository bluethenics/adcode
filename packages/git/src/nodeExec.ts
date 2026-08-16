/**
 * Running `git`, via `execFile`.
 *
 * `execFile` and not `exec`: the latter goes through a shell, which would put every
 * branch name and path one metacharacter away from arbitrary command execution.
 * Arguments here are always an array, and `shell` is never enabled.
 */
import { execFile } from "node:child_process";
import type { GitExec, GitExecResult } from "./types.ts";

/** Generous enough for a clone over a slow link, bounded so a hung git cannot wedge the UI. */
const TIMEOUT_MS = 120_000;
const MAX_BUFFER = 32 * 1024 * 1024;

export const nodeGitExec: GitExec = {
  run(args: readonly string[], options: { cwd: string }): Promise<GitExecResult> {
    return new Promise((resolve) => {
      execFile(
        "git",
        [...args],
        {
          cwd: options.cwd,
          timeout: TIMEOUT_MS,
          maxBuffer: MAX_BUFFER,
          windowsHide: true,
          env: {
            ...process.env,
            // Git must never stop to ask. Without this a credential prompt or an
            // unknown host key blocks the child forever and the UI just hangs.
            GIT_TERMINAL_PROMPT: "0",
            GIT_ASKPASS: "",
            GIT_OPTIONAL_LOCKS: "0",
          },
        },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve({ stdout, stderr, code: 0 });
            return;
          }

          const code = typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : 1;

          // A failed git command is data, not an exception - the caller decides what to
          // show. `git` itself uses exit codes for ordinary answers ("not a repository",
          // "nothing to commit"), so throwing here would turn answers into crashes.
          resolve({ stdout, stderr: stderr || error.message, code });
        },
      );
    });
  },
};
