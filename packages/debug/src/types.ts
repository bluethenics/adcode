/**
 * What a debugger shows you.
 *
 * These are the shapes the editor renders, deliberately not the shapes the protocol sends.
 * The inspector speaks in script ids, remote object handles and zero-based positions; an
 * editor speaks in file paths and line numbers. Translating once, at the edge, is what
 * keeps `scriptId` from leaking into a panel.
 */

export type DebugState =
  | { readonly state: "idle" }
  /** The process is starting and the inspector has not answered yet. */
  | { readonly state: "starting" }
  | { readonly state: "running" }
  | { readonly state: "paused"; readonly reason: PauseReason; readonly frames: readonly StackFrame[] }
  /** Ended, with the exit code where there was one. */
  | { readonly state: "stopped"; readonly exitCode: number | null }
  /** Could not start, with something a person can act on. */
  | { readonly state: "failed"; readonly message: string };

export type PauseReason = "breakpoint" | "step" | "exception" | "entry" | "pause" | "other";

export interface StackFrame {
  readonly id: string;
  /** The function, or `(anonymous)`. */
  readonly name: string;
  /** Absolute path, or null for a frame inside Node's own internals. */
  readonly path: string | null;
  /** One-based, as the editor counts. */
  readonly line: number;
  readonly column: number;
}

export interface Scope {
  readonly name: string;
  /** `local`, `closure`, `global`, and the rest. Used to order and to dim the noisy ones. */
  readonly kind: string;
  /** Handle the runtime uses to expand this scope's contents. */
  readonly objectId: string | null;
}

export interface Variable {
  readonly name: string;
  /** Already rendered for display - the panel never formats a value itself. */
  readonly value: string;
  readonly type: string;
  /** Present when the value can be opened up; absent for primitives. */
  readonly objectId?: string;
}

/** A breakpoint the user placed, in editor coordinates. */
export interface Breakpoint {
  readonly path: string;
  readonly line: number;
}
