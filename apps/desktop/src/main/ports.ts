/**
 * What is listening, and stopping it.
 *
 * The panel this feeds answers a question a beginner hits constantly and has no tool for:
 * "something is already using 3000, what is it?" Until now the only honest answer ADCode
 * could give was the error message from whatever failed to start.
 *
 * Everything shaped like parsing lives in `portsParse.ts`, which is pure and tested. This
 * file runs the commands, decides which ports ADCode itself owns, and kills things.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  browsableHost,
  mergeListeners,
  parseLsof,
  parseNetstat,
  parseTasklist,
} from "./portsParse.ts";
import type { ListeningPort } from "../shared/api.ts";

const run = promisify(execFile);

/**
 * Long enough for a loaded machine, short enough that the panel does not appear to hang.
 *
 * `netstat` on a busy Windows box is genuinely slow - seconds, not milliseconds - which is
 * also why the panel polls only while it is visible.
 */
const COMMAND_TIMEOUT_MS = 5_000;

/** Plenty for thousands of sockets; guards against an unbounded buffer on a weird box. */
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

const options = { timeout: COMMAND_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true };

/**
 * Ports ADCode started, by port number.
 *
 * Injected rather than imported from `preview.ts` so this module has no opinion about
 * where a label comes from, and so the labelling can be tested without a running server.
 */
export type OwnedPorts = ReadonlyMap<number, string>;

async function windowsListeners(): Promise<ListeningPort[]> {
  const [netstat, tasklist] = await Promise.all([
    run("netstat", ["-ano", "-p", "TCP"], options).then((r) => r.stdout),
    // Names are a nicety: if tasklist fails the table still lists ports and pids, which is
    // most of the value. So this failure is swallowed and the other one is not.
    run("tasklist", ["/FO", "CSV", "/NH"], options)
      .then((r) => r.stdout)
      .catch(() => ""),
  ]);

  return mergeListeners(parseNetstat(netstat), parseTasklist(tasklist)).map(toPort);
}

async function unixListeners(): Promise<ListeningPort[]> {
  // lsof exits non-zero when it finds nothing, which is not an error - it is the answer.
  const { stdout } = await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], options).catch(
    (error: unknown) => ({ stdout: readStdout(error) }),
  );

  return mergeListeners(parseLsof(stdout)).map(toPort);
}

/** execFile rejects with an error that still carries whatever the command managed to print. */
function readStdout(error: unknown): string {
  if (typeof error === "object" && error !== null && "stdout" in error) {
    const { stdout } = error as { stdout?: unknown };
    if (typeof stdout === "string") return stdout;
  }
  return "";
}

function toPort(raw: {
  port: number;
  pid: number | null;
  address: string;
  process: string | null;
}): ListeningPort {
  return {
    port: raw.port,
    pid: raw.pid,
    process: raw.process,
    address: raw.address,
    url: `http://${browsableHost(raw.address)}:${raw.port}`,
    label: null,
    own: false,
  };
}

/**
 * Everything listening on TCP right now.
 *
 * Never throws: a missing `lsof`, a locked-down `netstat`, or a machine that answers
 * neither produces an empty list. The panel then says nothing is listening, which is
 * wrong but harmless, where an exception would break the whole bottom panel.
 */
export async function listListeningPorts(owned: OwnedPorts = new Map()): Promise<ListeningPort[]> {
  let found: ListeningPort[];
  try {
    found = process.platform === "win32" ? await windowsListeners() : await unixListeners();
  } catch {
    return [];
  }

  return found.map((port) => {
    const label = owned.get(port.port);
    // `own` drives the confirm prompt in the renderer: stopping our own live server is
    // routine, stopping an unrelated process is not.
    return label === undefined ? port : { ...port, label, own: true };
  });
}

/**
 * Stop whatever holds a port.
 *
 * Two guards, both of which have a real failure behind them:
 *
 * - **Never the editor itself.** ADCode's own main process listens (the live server, the
 *   LSP bridge), and its pid appears in this table like any other. A "stop" button that
 *   can close the window it is drawn in is not a button.
 * - **Never pid 0 or a negative pid.** On POSIX `kill(0)` signals the caller's entire
 *   process group and `kill(-n)` signals a group by id; either would take out far more
 *   than the row that was clicked.
 */
export async function stopPort(pid: number): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isInteger(pid) || pid <= 0) return { ok: false, error: "Not a process id." };
  if (pid === process.pid || pid === process.ppid) {
    return { ok: false, error: "That is ADCode itself." };
  }

  try {
    if (process.platform === "win32") {
      // `/T` takes the children too: a dev server is usually a shell wrapping the real
      // process, and killing only the wrapper leaves the port held by an orphan.
      await run("taskkill", ["/PID", String(pid), "/T", "/F"], options);
    } else {
      process.kill(pid, "SIGTERM");
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not stop it." };
  }
}
