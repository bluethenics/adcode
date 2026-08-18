/**
 * Finding a program on PATH, and working out how to launch what we found.
 *
 * This exists because two Windows details make `spawn("pyright-langserver")` fail in ways
 * that look like the program is missing when it is installed and working.
 *
 * **npm-installed tools are `.cmd` shims, not executables.** `PATHEXT` is what makes them
 * runnable from a prompt, and `spawn` without a shell does not consult it - so the lookup
 * has to. Node also refuses to execute `.cmd` directly since CVE-2024-27980, so a shim has
 * to be launched through `cmd.exe` explicitly, with its arguments still passed as separate
 * argv entries rather than pasted into a command string.
 *
 * The resolution is a pure function of PATH, PATHEXT and an existence predicate, which is
 * what makes it testable on a machine where none of these programs are installed - and this
 * repository is one, so the alternative was no test at all.
 */
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

export interface Launch {
  readonly file: string;
  readonly args: readonly string[];
}

/**
 * The absolute path of `command`, or `null`.
 *
 * `exists` is injected so the search order can be asserted directly rather than inferred
 * from whatever happens to be installed on the machine running the tests.
 */
export function resolveExecutable(
  command: string,
  pathValue: string,
  pathExt: string,
  exists: (candidate: string) => boolean,
): string | null {
  // A command with a separator in it is a path, not a name to look up. Searching PATH for
  // it would be wrong, and finding something would be worse than finding nothing.
  if (/[\\/]/.test(command)) return exists(command) ? command : null;

  const directories = pathValue.split(delimiter).filter((entry) => entry.length > 0);

  // The empty string first: on POSIX the name is already complete, and on Windows a
  // command given with its extension should not have another one appended.
  const extensions = ["", ...pathExt.split(delimiter).filter((entry) => entry.length > 0)];

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`);
      if (exists(candidate)) return candidate;
    }
  }

  return null;
}

export function findExecutable(command: string, platform: NodeJS.Platform): string | null {
  const pathValue = process.env["PATH"] ?? process.env["Path"] ?? "";
  const pathExt = platform === "win32" ? process.env["PATHEXT"] ?? ".EXE;.CMD;.BAT" : "";

  return resolveExecutable(command, pathValue, pathExt, existsSync);
}

/**
 * How to actually start it.
 *
 * A `.cmd` or `.bat` is a script for the command interpreter, not an image the OS can
 * execute. `cmd.exe /d /s /c` runs it, and the arguments stay separate argv entries so
 * nothing in them is re-parsed as syntax - which matters because the custom-server setting
 * lets the user supply those arguments.
 */
export function launchFor(resolved: string, args: readonly string[], platform: NodeJS.Platform): Launch {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(resolved)) {
    const system = process.env["SystemRoot"] ?? "C:\\Windows";
    return {
      file: `${system}\\System32\\cmd.exe`,
      args: ["/d", "/s", "/c", resolved, ...args],
    };
  }

  return { file: resolved, args: [...args] };
}
