export interface BuildPhase {
  readonly id: string;
  readonly label: string;
  readonly fallbackMs: number;
}

export const PHASES: readonly BuildPhase[];
export const QUIPS: readonly string[];
export const QUIP_MS: number;

export function quipAt(elapsedMs: number): string;

export interface BuildOutput {
  readonly path: string;
  readonly kB: number;
}

export interface BuildSnapshot {
  readonly fraction: number;
  readonly phaseId: string;
  readonly label: string;
  readonly modules: number;
  readonly moduleTotal: number;
  readonly outputs: readonly BuildOutput[];
  readonly warnings: number;
  readonly done: boolean;
  readonly elapsedMs: number;
}

export interface BuildLearned {
  readonly durations: Readonly<Record<string, number>>;
  readonly modules: Readonly<Record<string, number>>;
  readonly total: number;
}

export interface BuildProgressOptions {
  /** Milliseconds each phase took last time, by phase id. */
  readonly durations?: Readonly<Record<string, number>>;
  /** Modules each phase transformed last time, by phase id. */
  readonly modules?: Readonly<Record<string, number>>;
  /** Injectable clock, for tests. */
  readonly now?: () => number;
}

export interface BuildProgress {
  push(line: string): void;
  snapshot(): BuildSnapshot;
  learned(): BuildLearned;
}

export function createBuildProgress(options?: BuildProgressOptions): BuildProgress;

export function formatDuration(ms: number): string;
export function formatSize(kB: number): string;

export interface FrameInput {
  readonly fraction: number;
  readonly label: string;
  readonly quip: string;
  readonly elapsedMs: number;
  readonly columns?: number;
  readonly colour?: boolean;
}

export function renderFrame(input: FrameInput): readonly string[];
export function renderSummary(state: BuildSnapshot, colour?: boolean): string;
