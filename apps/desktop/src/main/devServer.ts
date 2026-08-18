/**
 * Running the project's own dev server, and watching for the address it prints.
 *
 * The static server in `liveServer.ts` answers "show me this folder". This answers "run
 * this project", which is a different job with a different failure mode: the command is the
 * project's, the output is the project's, and when it goes wrong the useful thing to show
 * is not an error we invented but the toolchain's own words.
 *
 * So the output is kept and surfaced. A dev server that fails to start is the single most
 * common thing a beginner gets stuck on, and "Preview failed" tells them nothing while
 * `Error: Cannot find module 'vite'` tells them exactly what to do.
 *
 * Spawned through node-pty rather than `child_process`: it is already a dependency, it
 * gives us a real terminal so tools print their normal banner instead of their piped-output
 * fallback, and on Windows it takes the whole process tree down on kill - which plain
 * `spawn` does not, leaving an orphaned dev server holding the port.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import pty from "node-pty";
import { detectDevCommand, parseServerUrl, shellInvocation, stripAnsi } from "./devCommand.ts";
import type { DevCommand } from "./devCommand.ts";
import type { PreviewStatus } from "../shared/api.ts";

/**
 * How long to wait for an address before saying so.
 *
 * Generous on purpose: a cold `next dev` on a large project, or a first run that has to
 * compile, genuinely takes this long. The server is not killed when it expires - it may
 * still be working - the status just stops claiming to be starting, so the user gets the
 * log instead of a spinner that never resolves.
 */
const ADDRESS_TIMEOUT_MS = 90_000;

/** Enough output to see a stack trace, little enough to keep in memory without thought. */
const LOG_LINES = 300;

export interface DevServerEvents {
  readonly onOutput: (chunk: string) => void;
  readonly onStatus: (status: PreviewStatus) => void;
}

const STOPPED: PreviewStatus = {
  running: false,
  url: null,
  root: null,
  error: null,
  mode: "project",
  label: null,
  starting: false,
};

let child: pty.IPty | null = null;
let status: PreviewStatus = STOPPED;
let log: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Set while we are the ones killing it.
 *
 * Without this, closing the preview reports "exited with code 1" a moment later - because
 * `onExit` cannot tell a crash from the kill we just issued, and a shell terminated by a
 * signal exits non-zero. Telling the user their dev server crashed immediately after they
 * asked it to stop is the kind of small lie that makes an error message worthless.
 */
let stoppingDeliberately = false;

export function devServerStatus(): PreviewStatus {
  return status;
}

export function devServerLog(): string {
  return log.join("");
}

/**
 * What starting this project would run, or `null` if there is nothing to run.
 *
 * Only the workspace root is read, never a subtree: a dev server is started from the folder
 * the user opened, and walking the tree looking for a `package.json` to run would mean
 * running something they did not point at.
 */
export async function detectProject(root: string | null): Promise<DevCommand | null> {
  if (root === null) return null;

  let files: string[];
  try {
    files = await readdir(root);
  } catch {
    return null;
  }

  if (!files.includes("package.json")) return null;

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  } catch {
    // A package.json that is missing or malformed is not an error worth reporting here.
    // It means "no dev command", and the static server is the honest fallback.
    return null;
  }

  return detectDevCommand(files, parsed);
}

function publish(next: PreviewStatus, events: DevServerEvents): void {
  status = next;
  events.onStatus(next);
}

export async function startDevServer(
  root: string | null,
  events: DevServerEvents,
): Promise<PreviewStatus> {
  await stopDevServer();

  const command = await detectProject(root);
  if (root === null || command === null) {
    status = { ...STOPPED, error: "No dev script found in this folder." };
    return status;
  }

  const { file, args } = shellInvocation(command, process.platform);

  try {
    child = pty.spawn(file, [...args], {
      name: "xterm-256color",
      cols: 100,
      rows: 30,
      cwd: root,
      env: {
        ...process.env,
        // Colour is stripped before parsing anyway, and keeping it makes the log readable
        // in the drawer. `CI` would make several tools disable the watcher entirely.
        FORCE_COLOR: "1",
        BROWSER: "none",
      },
    });
  } catch (error) {
    status = {
      ...STOPPED,
      error: `Could not start ${command.label}: ${error instanceof Error ? error.message : String(error)}`,
    };
    return status;
  }

  log = [];

  status = {
    running: true,
    url: null,
    root,
    error: null,
    mode: "project",
    label: command.label,
    starting: true,
  };

  child.onData((chunk) => {
    log.push(chunk);
    if (log.length > LOG_LINES) log = log.slice(-LOG_LINES);
    events.onOutput(chunk);

    // Only while starting: a dev server prints URLs in ordinary log lines long after it
    // has an address, and repointing the frame at one of those would navigate the user
    // away from whatever page they were looking at.
    if (!status.starting) return;

    const url = parseServerUrl(stripAnsi(log.join("")));
    if (url === null) return;

    publish({ ...status, url, starting: false, error: null }, events);
  });

  child.onExit(({ exitCode }) => {
    child = null;
    if (stoppingDeliberately) return;

    // Exit code 0 while we were still waiting is not success: the command ran and stopped
    // without ever serving anything, which for a dev server means it failed to be one.
    publish(
      {
        ...STOPPED,
        error:
          exitCode === 0
            ? `${command.label} exited without starting a server.`
            : `${command.label} exited with code ${exitCode}.`,
      },
      events,
    );
  });

  timer = setTimeout(() => {
    timer = null;
    if (!status.starting) return;

    publish(
      {
        ...status,
        starting: false,
        error: "Started, but no address was printed. The output below is what it said.",
      },
      events,
    );
  }, ADDRESS_TIMEOUT_MS);

  return status;
}

export async function stopDevServer(): Promise<PreviewStatus> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }

  const running = child;
  child = null;
  status = STOPPED;

  if (running === null) return status;

  stoppingDeliberately = true;
  try {
    running.kill();
  } catch {
    // Already gone. The only thing that matters is that we stop claiming it is running.
  } finally {
    // Cleared on a later turn of the loop, because `onExit` arrives after this returns.
    setTimeout(() => {
      stoppingDeliberately = false;
    }, 0);
  }

  return status;
}
