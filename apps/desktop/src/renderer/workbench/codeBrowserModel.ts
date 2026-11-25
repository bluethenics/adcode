/**
 * The rules behind the Code view (`codeBrowser.ts`): how the tree is ordered, which folders
 * start folded away, and what the reader can show. Plain functions, tested without a DOM.
 */

export interface TreeEntry {
  readonly name: string;
  readonly path: string;
  readonly isDirectory: boolean;
}

/** Folders that are big, generated or private: listed, dimmed, never opened by themselves. */
const HEAVY = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".turbo", ".cache", "coverage",
  "target", "vendor", "__pycache__", ".venv", "venv", ".gradle", ".idea", ".vscode", "bin", "obj",
]);

export function isHeavyFolder(name: string): boolean {
  return HEAVY.has(name);
}

/** Folders first, then files, each by name the way a person reads it (2 before 10, any case). */
export function sortTree<T extends TreeEntry>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) =>
    Number(b.isDirectory) - Number(a.isDirectory) ||
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
  );
}

/** `src/app.ts` under the project root; the path itself when it is elsewhere. */
export function relativeTo(root: string | null, path: string): string {
  if (root === null) return path;
  const base = root.replace(/[\\/]+$/, "");
  if (path.length > base.length && path.slice(0, base.length).toLowerCase() === base.toLowerCase() && /[\\/]/.test(path[base.length] ?? "")) {
    return path.slice(base.length + 1).replace(/\\/g, "/");
  }
  return path.replace(/\\/g, "/");
}

/** The folders between the root and `path`, outermost first: what to open to reveal it. */
export function ancestorsOf(root: string, path: string): string[] {
  const relative = relativeTo(root, path);
  if (relative === path.replace(/\\/g, "/")) return [];
  const separator = root.includes("\\") ? "\\" : "/";
  const parts = relative.split("/").slice(0, -1);
  const base = root.replace(/[\\/]+$/, "");
  const out: string[] = [];
  let current = base;
  for (const part of parts) {
    current = `${current}${separator}${part}`;
    out.push(current);
  }
  return out;
}

const IMAGE = /\.(?:png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i;

export function isImageFile(path: string): boolean {
  return IMAGE.test(path);
}

/** Beyond these the reader says so and offers the editor, rather than freezing the panel. */
export const MAX_VIEW_CHARS = 600_000;
export const MAX_VIEW_LINES = 20_000;

export type ViewPlan =
  | { readonly kind: "text"; readonly lines: number }
  | { readonly kind: "binary" }
  | { readonly kind: "too-large"; readonly lines: number; readonly chars: number };

/** What the reader can do with a file's text. */
export function viewPlan(text: string): ViewPlan {
  // A NUL in the first stretch means bytes, not text.
  if (text.slice(0, 8_000).includes("\u0000")) return { kind: "binary" };
  let lines = 1;
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) lines += 1;
  if (text.length > MAX_VIEW_CHARS || lines > MAX_VIEW_LINES) return { kind: "too-large", lines, chars: text.length };
  return { kind: "text", lines };
}

/** Rows a filter keeps: those whose name matches, and every folder on the way to one. */
export function filterTree(
  entries: ReadonlyMap<string, readonly TreeEntry[]>,
  root: string,
  query: string,
): Set<string> {
  const wanted = query.trim().toLowerCase();
  const keep = new Set<string>();
  if (wanted.length === 0) return keep;
  const visit = (dir: string, trail: readonly string[]): void => {
    for (const entry of entries.get(dir) ?? []) {
      if (entry.name.toLowerCase().includes(wanted)) {
        keep.add(entry.path);
        for (const folder of trail) keep.add(folder);
      }
      if (entry.isDirectory) visit(entry.path, [...trail, entry.path]);
    }
  };
  visit(root, []);
  return keep;
}
