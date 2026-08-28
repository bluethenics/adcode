/** Pure path, file, and symbol models for the interactive breadcrumb controller. */

export type LocationCrumb =
  | { readonly kind: "workspace" | "directory" | "file"; readonly label: string; readonly path: string }
  | { readonly kind: "symbol"; readonly label: string; readonly line: number };

export interface DirectoryEntryLike {
  readonly name: string;
  readonly path: string;
  readonly isDirectory: boolean;
}

export type BreadcrumbChoice =
  | {
      readonly kind: "directory";
      readonly group: string;
      readonly label: string;
      readonly path: string;
      readonly detail?: string;
    }
  | {
      readonly kind: "file";
      readonly group: string;
      readonly label: string;
      readonly path: string;
      readonly detail?: string;
    }
  | {
      readonly kind: "symbol";
      readonly depth: number;
      readonly label: string;
      readonly detail: string;
      readonly line: number;
    }
  | {
      readonly kind: "action";
      readonly group: string;
      readonly label: string;
      readonly action: string;
      readonly detail?: string;
    };

export interface OutlineLike {
  readonly name: string;
  readonly kind: string;
  readonly line: number;
  readonly endLine?: number;
  readonly children: readonly OutlineLike[];
}

const normal = (value: string): string => value.replace(/\\/g, "/").replace(/\/+$/, "");
const basename = (value: string): string => normal(value).split("/").at(-1) ?? value;

function samePath(left: string, right: string): boolean {
  const a = normal(left);
  const b = normal(right);
  return /^[a-z]:/i.test(a) || /^[a-z]:/i.test(b) ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function inside(root: string, path: string): string | null {
  const base = normal(root);
  const target = normal(path);
  const insensitive = /^[a-z]:/i.test(base);
  const comparedBase = insensitive ? base.toLowerCase() : base;
  const comparedTarget = insensitive ? target.toLowerCase() : target;
  if (comparedTarget === comparedBase) return "";
  if (!comparedTarget.startsWith(`${comparedBase}/`)) return null;
  return target.slice(base.length + 1);
}

function join(root: string, parts: readonly string[]): string {
  const separator = root.includes("\\") ? "\\" : "/";
  return [root.replace(/[\\/]+$/, ""), ...parts].join(separator);
}

/** Build the visible path trail without ever inventing a relative path outside the workspace. */
export function buildLocationCrumbs(workspaceRoot: string | null, path: string): LocationCrumb[] {
  if (workspaceRoot === null) return [{ kind: "file", label: basename(path), path }];

  const relative = inside(workspaceRoot, path);
  if (relative === null || relative.length === 0) {
    return [{ kind: "file", label: basename(path), path }];
  }

  const parts = relative.split("/").filter(Boolean);
  const crumbs: LocationCrumb[] = [
    { kind: "workspace", label: basename(workspaceRoot), path: workspaceRoot },
  ];
  for (let index = 0; index < parts.length; index += 1) {
    crumbs.push({
      kind: index === parts.length - 1 ? "file" : "directory",
      label: parts[index]!,
      path: join(workspaceRoot, parts.slice(0, index + 1)),
    });
  }
  return crumbs;
}

/** Sibling files first, then open/recent files that are not duplicates of them. */
export function buildFileChoices(
  currentPath: string,
  siblings: readonly DirectoryEntryLike[],
  recentPaths: readonly string[],
): BreadcrumbChoice[] {
  const choices: BreadcrumbChoice[] = [];
  const seen = new Set<string>();
  const key = (path: string): string => (/^[a-z]:/i.test(path) ? normal(path).toLowerCase() : normal(path));
  seen.add(key(currentPath));

  for (const entry of [...siblings].sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory || seen.has(key(entry.path))) continue;
    seen.add(key(entry.path));
    choices.push({ kind: "file", group: "In this folder", label: entry.name, path: entry.path });
  }

  for (const path of recentPaths) {
    if (seen.has(key(path))) continue;
    seen.add(key(path));
    choices.push({ kind: "file", group: "Recent", label: basename(path), path });
  }
  return choices;
}

/** Flatten the same outline tree the Structure view uses, preserving nesting as indentation. */
export function buildSymbolChoices(nodes: readonly OutlineLike[]): BreadcrumbChoice[] {
  const choices: BreadcrumbChoice[] = [];
  const visit = (level: readonly OutlineLike[], depth: number): void => {
    for (const node of level) {
      choices.push({
        kind: "symbol",
        depth,
        label: node.name,
        detail: `${node.kind} · line ${String(node.line)}`,
        line: node.line,
      });
      visit(node.children, depth + 1);
    }
  };
  visit(nodes, 0);
  return choices;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let at = 0;
  for (const char of haystack) {
    if (char === needle[at]) at += 1;
    if (at === needle.length) return true;
  }
  return needle.length === 0;
}

/** Fast local filtering; no filesystem or AI work ever runs on a breadcrumb keystroke. */
export function filterBreadcrumbChoices(
  choices: readonly BreadcrumbChoice[],
  query: string,
): BreadcrumbChoice[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0) return [...choices];

  return choices.filter((choice) => {
    const group = "group" in choice ? choice.group : "Symbols";
    const detail = choice.detail ?? "";
    return isSubsequence(needle, `${choice.label} ${detail} ${group}`.toLocaleLowerCase());
  });
}

export function parentPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const cut = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return cut <= 0 ? normalized : normalized.slice(0, cut);
}

export function directoryChoices(
  currentDirectory: string,
  children: readonly DirectoryEntryLike[],
  siblingDirectories: readonly DirectoryEntryLike[],
): BreadcrumbChoice[] {
  const result: BreadcrumbChoice[] = [];
  for (const entry of [...children].sort((a, b) => Number(a.isDirectory) * -1 - Number(b.isDirectory) * -1 || a.name.localeCompare(b.name))) {
    result.push({
      kind: entry.isDirectory ? "directory" : "file",
      group: "Inside",
      label: entry.name,
      path: entry.path,
    });
  }
  for (const entry of [...siblingDirectories].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory || samePath(entry.path, currentDirectory)) continue;
    result.push({ kind: "directory", group: "Sibling folders", label: entry.name, path: entry.path });
  }
  return result;
}
