/**
 * Confine every renderer-supplied path to the opened workspace.
 *
 * Brief §1: "The renderer opens untrusted content (repo files, model output, ad
 * creatives) and must be treated as hostile." Every IPC handler that touches the disk
 * runs its argument through here first.
 *
 * Pure and dependency-free apart from `node:path`, so the rule is exhaustively testable
 * without launching Electron.
 */
import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Windows and macOS are case-insensitive by default; Linux is not. Comparing paths
 * case-insensitively on Linux would let `/Work/Secrets` masquerade as `/work/secrets`,
 * and comparing case-sensitively on Windows would reject paths that are genuinely the
 * same file.
 */
export function normalizeForCompare(input: string): string {
  const resolved = resolve(input);
  return process.platform === "linux" ? resolved : resolved.toLowerCase();
}

export function isInsideWorkspace(root: string | null, candidate: string): boolean {
  if (root === null) return false;
  if (typeof candidate !== "string" || candidate.length === 0) return false;

  // A NUL byte can truncate a path inside a native syscall, so `ok.ts\0.png` may open
  // `ok.ts` while passing any check that only looked at the whole string.
  if (candidate.includes("\u0000") || root.includes("\u0000")) return false;

  // Only absolute paths are accepted: a relative path would resolve against the main
  // process's cwd, which has nothing to do with the workspace.
  if (!isAbsolute(candidate)) return false;

  const normalizedRoot = normalizeForCompare(root);
  const normalizedCandidate = normalizeForCompare(candidate);

  if (normalizedCandidate === normalizedRoot) return true;

  // `relative` rather than `startsWith`: a prefix test would accept a sibling directory
  // whose name merely begins with the root, which is the path-shaped version of the
  // hostname-suffix bug the ad client's validator guards against.
  const rel = relative(normalizedRoot, normalizedCandidate);

  if (rel.length === 0) return true;
  if (isAbsolute(rel)) return false;
  if (rel === ".." || rel.startsWith(`..${sep}`)) return false;

  return true;
}
