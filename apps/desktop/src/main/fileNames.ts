/**
 * Validate a single filesystem name, and derive copy names.
 *
 * A name arriving from the renderer is one path segment and nothing else. Brief §1 treats
 * the renderer as hostile, and the AI layer makes that literal rather than theoretical:
 * model output reaches the same IPC handlers a person's typing does.
 *
 * Three separate things are being refused here, and it is worth keeping them apart:
 *
 *   - names that can *traverse* (`..`, separators), which turn "create a file in this
 *     folder" into "write anywhere the process can reach";
 *   - names the filesystem *reinterprets* (trailing dots and spaces, reserved devices),
 *     where the file that appears is not the file that was asked for - a mismatch that
 *     silently breaks every later lookup by the requested name;
 *   - names that cannot be *stored* (control characters, over-long).
 *
 * Pure and dependency-free, so the whole rule is exhaustively testable in milliseconds
 * without launching Electron - the same posture as `pathSafety.ts`.
 *
 * The Windows rules are applied on every platform on purpose. A repository created on
 * Linux with a file called `aux.h` cannot be checked out on Windows at all, so permitting
 * it here would only move the failure somewhere less explicable.
 */

export type NameCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const MAX_LENGTH = 255;

/** `CON.txt` addresses the console as surely as `CON` does, so the extension is stripped. */
const RESERVED = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

const FORBIDDEN = new Set(["<", ">", ":", '"', "|", "?", "*"]);

export function validateFileName(name: unknown): NameCheck {
  if (typeof name !== "string") return { ok: false, reason: "A name is required." };

  if (name.length === 0) return { ok: false, reason: "The name cannot be empty." };
  if (name.trim().length === 0) return { ok: false, reason: "The name cannot be only spaces." };

  if (name.length > MAX_LENGTH) {
    return { ok: false, reason: `The name is too long (${name.length} of ${MAX_LENGTH} characters).` };
  }

  if (name === "." || name === "..") {
    return { ok: false, reason: "“.” and “..” refer to directories that already exist." };
  }

  if (name.includes("/") || name.includes("\\")) {
    return { ok: false, reason: "A name cannot contain a path separator. Create the folder first." };
  }

  for (const character of name) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return { ok: false, reason: "The name contains a control character." };
    }
    if (FORBIDDEN.has(character)) {
      return { ok: false, reason: `A name cannot contain ${character}` };
    }
  }

  // Checked after the separator rule so the clearer message wins for `folder/name `.
  if (name.endsWith(" ") || name.endsWith(".")) {
    return { ok: false, reason: "A name cannot end with a space or a dot - Windows removes them." };
  }

  const device = deviceStem(name);
  if (RESERVED.has(device.toLowerCase())) {
    return { ok: false, reason: `“${device}” is a reserved device name on Windows.` };
  }

  return { ok: true };
}

/**
 * The part before the *first* dot, which is what the reservation applies to.
 *
 * `COM1.tar.gz` addresses the serial port just as `COM1` does, so splitting on the last
 * dot here would let every reserved name through behind a double extension. A leading dot
 * makes the name an ordinary dotfile - `.con` is a file, not the console - and yields an
 * empty stem, which matches nothing.
 */
function deviceStem(name: string): string {
  const dot = name.indexOf(".");
  return dot === -1 ? name : name.slice(0, dot);
}

/**
 * Split a name into the part a copy suffix attaches to and the extension it keeps.
 *
 * The split is on the *last* dot, unlike `deviceStem`: the point is that the copy stays
 * the same kind of file, so `index.test.ts` has to remain a `.ts`. A leading dot belongs
 * to the name rather than to an extension, so `.gitignore` splits as a whole - otherwise
 * a copy of it would come out as `. copy gitignore`.
 */
function splitName(name: string): readonly [base: string, extension: string] {
  const leadingDot = name.startsWith(".");
  const body = leadingDot ? name.slice(1) : name;

  const dot = body.lastIndexOf(".");
  if (dot <= 0) return [name, ""];

  const base = body.slice(0, dot);
  return [leadingDot ? `.${base}` : base, body.slice(dot)];
}

/**
 * `notes.md` → `notes copy.md` → `notes copy 2.md`.
 *
 * The suffix goes before the extension so the copy opens in the same editor and is picked
 * up by the same glob as the original.
 */
export function suffixedName(name: string, index: number): string {
  const [base, ext] = splitName(name);
  const suffix = index <= 1 ? " copy" : ` copy ${index}`;
  return `${base}${suffix}${ext}`;
}
