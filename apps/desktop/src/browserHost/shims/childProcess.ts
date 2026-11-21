/**
 * `node:child_process` for the browser host: there is no computer to run a program on.
 *
 * Every spawn fails the way a missing program fails on a computer - an `error` event with
 * `ENOENT`, then `close` - so each caller's existing "this tool is not installed" path runs,
 * rather than an exception at the call site. execFile and exec call back with that error.
 */
import { EventEmitter } from "./events.ts";

export const UNAVAILABLE_MESSAGE = "Running programs needs the ADCode desktop app. The web version works on your GitHub files without a computer of its own.";

function unavailable(command: string): Error & { code: string } {
  const error = new Error(`spawn ${command} ENOENT: ${UNAVAILABLE_MESSAGE}`) as Error & { code: string; path: string; syscall: string };
  error.code = "ENOENT";
  error.path = command;
  error.syscall = `spawn ${command}`;
  return error;
}

class Stream extends EventEmitter {
  readonly readable = true;
  readonly writable = true;
  setEncoding(): this { return this; }
  write(): boolean { return false; }
  end(): void {}
  destroy(): void {}
  pipe<T>(target: T): T { return target; }
  resume(): this { return this; }
  pause(): this { return this; }
}

export class ChildProcess extends EventEmitter {
  readonly pid = undefined;
  readonly stdin = new Stream();
  readonly stdout = new Stream();
  readonly stderr = new Stream();
  exitCode: number | null = null;
  signalCode: string | null = null;
  killed = false;
  constructor(command: string) {
    super();
    setTimeout(() => {
      this.emit("error", unavailable(command));
      this.exitCode = -2;
      this.emit("exit", -2, null);
      this.emit("close", -2, null);
    }, 0);
  }
  kill(): boolean { this.killed = true; return false; }
  ref(): void {}
  unref(): void {}
  disconnect(): void {}
  override emit(name: string | symbol, ...args: unknown[]): boolean {
    // A caller that never listens for errors must not crash the host.
    if (name === "error" && this.listenerCount("error") === 0) return false;
    return super.emit(name, ...args);
  }
}

export type ChildProcessByStdio = ChildProcess;
export type ChildProcessWithoutNullStreams = ChildProcess;

export const spawn = (command: string): ChildProcess => new ChildProcess(command);
export const fork = spawn;

type Callback = (error: Error | null, stdout: string, stderr: string) => void;
export function execFile(command: string, ...rest: unknown[]): ChildProcess {
  const callback = rest.reverse().find((value): value is Callback => typeof value === "function");
  const child = new ChildProcess(command);
  child.on("error", (error: Error) => callback?.(error, "", ""));
  return child;
}
export function exec(command: string, ...rest: unknown[]): ChildProcess {
  return execFile(command.split(/\s+/)[0] ?? command, ...rest);
}
export function execSync(command: string): never {
  throw unavailable(command);
}
export const execFileSync = execSync;
export function spawnSync(command: string) {
  return { pid: 0, status: null, signal: null, output: [], stdout: "", stderr: "", error: unavailable(command) };
}

// util.promisify(execFile) rejects with the same error.
(execFile as unknown as Record<symbol, unknown>)[Symbol.for("nodejs.util.promisify.custom")] = (command: string) =>
  Promise.reject(unavailable(command));
(exec as unknown as Record<symbol, unknown>)[Symbol.for("nodejs.util.promisify.custom")] = (command: string) =>
  Promise.reject(unavailable(command.split(/\s+/)[0] ?? command));

export default { spawn, fork, execFile, exec, execSync, execFileSync, spawnSync, ChildProcess };
