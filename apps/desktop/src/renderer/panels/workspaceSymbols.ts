import { declarationOn, type SymbolKind } from "@adcode/structure";
import type { SearchHitView } from "../../shared/api.ts";

export interface WorkspaceSymbolHit {
  readonly kind: SymbolKind;
  readonly name: string;
  readonly path: string;
  readonly line: number;
  readonly column: number;
}

function rank(name: string, query: string): number {
  const lower = name.toLowerCase();
  if (lower === query) return 0;
  if (lower.startsWith(query)) return 1;
  return 2;
}

/** Parse, deduplicate, rank, and cap declaration hits for every symbol-search surface. */
export function findWorkspaceSymbols(
  hits: readonly SearchHitView[],
  query: string,
  languageFor: (path: string) => string,
  limit = 40,
): readonly WorkspaceSymbolHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const found: WorkspaceSymbolHit[] = [];
  const seen = new Set<string>();

  for (const hit of hits) {
    const declaration = declarationOn(languageFor(hit.path), hit.text);
    if (declaration === null || !declaration.name.toLowerCase().includes(needle)) continue;
    const key = `${hit.path}:${String(hit.line)}:${declaration.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({
      kind: declaration.kind,
      name: declaration.name,
      path: hit.path,
      line: hit.line,
      column: hit.column,
    });
  }

  found.sort(
    (a, b) =>
      rank(a.name, needle) - rank(b.name, needle) ||
      a.name.length - b.name.length ||
      a.name.localeCompare(b.name),
  );
  return found.slice(0, limit);
}
