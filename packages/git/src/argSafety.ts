/**
 * Validation for values that become `git` arguments.
 *
 * Passing arguments as an array (never a shell string) removes shell injection, but git
 * has its own attack surface that array arguments do nothing about:
 *
 * - Any argument beginning with `-` is parsed as an option. A branch named `--exec=…`
 *   is not a branch.
 * - The `ext::` transport hands git a command line to execute. It is a documented
 *   remote-code-execution vector and has no legitimate use in an IDE's clone box.
 * - `--upload-pack` / `--receive-pack` do the same thing by a different route.
 *
 * These values arrive from the branch switcher, from the renderer, and - once the AI
 * layer can drive source control - from model output that has read the repository. All
 * three are untrusted.
 *
 * Pure: no I/O.
 */

const MAX_REF_LENGTH = 255;
const MAX_URL_LENGTH = 2048;

/** Whitespace, shell metacharacters, and git's own revision syntax. */
const REF_FORBIDDEN = /[\s~^:?*[\]\\;|&$`<>(){}'"]/;

/**
 * A branch, tag, or other ref name.
 *
 * Deliberately stricter than `git check-ref-format`: this is the set of names an IDE's
 * branch switcher needs to create and switch between, not the full space of names git
 * will tolerate. Refusing a legal-but-strange name costs a user very little; accepting
 * an argument that turns out to be an option costs them a great deal.
 */
export function isSafeRef(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_REF_LENGTH) return false;

  if (value.startsWith("-")) return false;
  if (value.includes("\u0000")) return false;
  if (REF_FORBIDDEN.test(value)) return false;

  if (value.startsWith("/") || value.endsWith("/")) return false;
  if (value.includes("//")) return false;
  if (value.includes("..")) return false;
  if (value.endsWith(".lock")) return false;
  if (value === "." || value === "..") return false;

  return true;
}

/**
 * A path passed to git.
 *
 * Spaces are fine - array arguments handle those - but a leading dash is not, and
 * neither is a NUL byte, which can truncate the path inside a syscall.
 */
export function isSafePathArg(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.length === 0) return false;
  if (value.startsWith("-")) return false;
  if (value.includes("\u0000")) return false;

  return true;
}

/** Transports an IDE has any business cloning from. */
const ALLOWED_SCHEMES = ["https://", "ssh://", "git://"];
/** `git@host:owner/repo.git` - scp-like syntax, the form GitHub shows by default. */
const SCP_LIKE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._\-/]+$/;

export function isSafeCloneUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;

  const url = value.trim();
  if (url.length === 0 || url.length > MAX_URL_LENGTH) return false;
  if (url.startsWith("-")) return false;
  if (/[\u0000-\u001f]/.test(url)) return false;

  // Checked before the scheme allowlist and case-insensitively: `ext::` is the one that
  // turns a clone box into a command prompt.
  const lower = url.toLowerCase();
  if (lower.startsWith("ext::")) return false;
  if (lower.includes("--upload-pack") || lower.includes("--receive-pack")) return false;

  // `file://` is refused deliberately. It is legitimate git, but in an IDE it means a
  // pasted URL can reach into the local filesystem, which is not what a clone box is for.
  if (lower.startsWith("file://")) return false;

  if (ALLOWED_SCHEMES.some((scheme) => lower.startsWith(scheme))) return true;
  return SCP_LIKE.test(url);
}
