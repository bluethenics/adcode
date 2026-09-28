/**
 * Proof of work for an agent run: the checks it actually ran, and what its change puts at risk.
 *
 * Built from the run's recorded traces and its diff, never from the agent's own summary - a
 * sentence saying "all tests pass" proves nothing, a recorded `npm test` that completed does.
 * Pure and dependency-free: the main process uses it to decide whether a finished run may be
 * applied automatically, and the renderer to draw the evidence chips on its box.
 */

export interface RunCheck {
  readonly command: string;
  readonly ok: boolean;
}

export type RiskKind = "secret" | "sensitive" | "tests-removed" | "dependencies" | "large";

export interface RiskFlag {
  readonly kind: RiskKind;
  readonly path: string | null;
  readonly text: string;
}

interface TraceLike {
  readonly kind: string;
  readonly summary: string;
  readonly detail: string;
  readonly outcome: string;
  readonly at: number;
}

interface ChangeLike {
  readonly path: string;
  readonly isNew: boolean;
  readonly hunks: readonly { readonly original: readonly string[]; readonly replacement: readonly string[] }[];
}

/** Commands that check the work rather than change it or look around. */
const CHECK = /\b(test|tests|vitest|jest|mocha|pytest|tsc|typecheck|type-check|lint|eslint|ruff|mypy|build|check|vet)\b/i;

export function checksFromTraces(traces: readonly TraceLike[]): RunCheck[] {
  const ordered = [...traces].sort((a, b) => a.at - b.at);
  const pending: string[] = [];
  const latest = new Map<string, boolean>();
  for (const trace of ordered) {
    if (trace.kind === "tool-call" && trace.summary === "Called run_command") {
      pending.push(trace.detail.trim());
    } else if (trace.kind === "tool-result" && trace.summary.startsWith("run_command ")) {
      const command = pending.shift();
      if (command === undefined || !CHECK.test(command)) continue;
      // Re-inserting moves it to the end: the order shown is the order last run.
      latest.delete(command);
      latest.set(command, trace.outcome === "ok");
    }
  }
  return [...latest].map(([command, ok]) => ({ command, ok }));
}

/*
 * Secrets: well-known key shapes, private key headers, and an assignment of a long opaque
 * string to a name that says it is a credential. Tuned to stay quiet on ordinary code that
 * merely mentions tokens or keys.
 */
const SECRET_SHAPES: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(sk|pk|rk)[-_](live|test|proj)[-_][A-Za-z0-9]{16,}/,
  /\bsk-[A-Za-z0-9_-]{24,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /(api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token)\s*[:=]\s*["'][^"'\s]{16,}["']/i,
  /:\/\/[^\s:/@]+:[^\s@/]+@/,
];
const ENV_FILE = /(^|\/)\.env(\.[\w-]+)?$/i;
const ENV_EXAMPLE = /\.(example|sample|template)$/i;
const SENSITIVE = /(^|[/._-])(auth|login|logout|signin|sign-in|session|password|oauth|jwt|permission|permissions|acl|payment|payments|billing|checkout|stripe|invoice|wallet)([/._-]|$)/i;
const TEST_FILE = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.(go|py)$/i;
const TEST_CASE = /^\s*(it|test|describe)(\.\w+)?\s*\(|^\s*def test_|#\[test\]|^\s*func Test/;
const MANIFEST = /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|Cargo\.(toml|lock)|go\.(mod|sum)|Gemfile(\.lock)?|composer\.(json|lock))$/;
const LARGE = 25;

export function riskFlags(changes: readonly ChangeLike[]): RiskFlag[] {
  const flags: RiskFlag[] = [];
  let dependencies = false;
  for (const change of changes) {
    const added = change.hunks.flatMap((hunk) => hunk.replacement);
    const removed = change.hunks.flatMap((hunk) => hunk.original);
    const envFile = ENV_FILE.test(change.path) && !ENV_EXAMPLE.test(change.path);
    if ((envFile && added.length > 0) || added.some((line) => SECRET_SHAPES.some((shape) => shape.test(line)))) {
      flags.push({ kind: "secret", path: change.path, text: `Possible secret added in ${change.path}` });
    }
    if (SENSITIVE.test(change.path)) {
      flags.push({ kind: "sensitive", path: change.path, text: `Touches sign-in, payment or permission code: ${change.path}` });
    }
    if (TEST_FILE.test(change.path)) {
      const lost = removed.filter((line) => TEST_CASE.test(line)).length - added.filter((line) => TEST_CASE.test(line)).length;
      if (lost > 0) flags.push({ kind: "tests-removed", path: change.path, text: `Removes tests from ${change.path}` });
    }
    if (MANIFEST.test(change.path)) dependencies = true;
  }
  if (dependencies) flags.push({ kind: "dependencies", path: null, text: "Changes dependencies" });
  if (changes.length >= LARGE) flags.push({ kind: "large", path: null, text: `Large change: ${changes.length} files` });
  return flags;
}

/**
 * Why a finished run should wait for a person even with Apply automatically on, or null.
 *
 * Only two things hold a run: a check that failed, and a possible secret. Sensitive areas,
 * dependency changes and size are shown, not enforced - they are normal work.
 */
export function holdReason(checks: readonly RunCheck[], risks: readonly RiskFlag[]): string | null {
  const failed = checks.find((check) => !check.ok);
  if (failed !== undefined) return `a check failed: ${failed.command}`;
  const secret = risks.find((risk) => risk.kind === "secret");
  return secret === undefined ? null : secret.text;
}
