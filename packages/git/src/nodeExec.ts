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

          /*
           * Two completely different failures arrive through this one callback, and telling
           * them apart is what decides whether the user sees git's words or Node's.
           *
           * When git **ran** and exited non-zero, `error.code` is that numeric exit code and
           * `error.message` is Node's own construction - the string "Command failed: git
           * commit -m ..." followed by stderr. It contains nothing git did not already say.
           *
           * When git **could not be run at all** - not installed, not on PATH, killed by the
           * timeout - `error.code` is a string like `ENOENT` and `error.message` is the only
           * description of what happened, because there is no output to have.
           *
           * This used to be `stderr || error.message`, which looks harmless and is not: a
           * `git commit` with nothing staged writes its entire explanation to **stdout** and
           * leaves stderr empty, so the fallback fired and replaced git's "no changes added
           * to commit" with "Command failed: git commit -m ood". Callers prefer stderr over
           * stdout, so the real reason was then discarded in favour of a string that says
           * only that something went wrong. That is the exact opposite of this repository's
           * rule that the toolchain's own words are the useful thing.
           */
          const raw = (error as { code?: unknown }).code;
          const ranAndFailed = typeof raw === "number";

          resolve({
            stdout,
            // Only speak for git when git could not speak for itself.
            stderr: ranAndFailed ? stderr : stderr || error.message,
            code: ranAndFailed ? raw : 1,
          });
        },
      );
    });
  },
};
