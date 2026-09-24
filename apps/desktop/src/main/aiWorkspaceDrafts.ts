import { relative, sep } from "node:path";
import { isInsideWorkspace } from "./pathSafety.ts";

export interface WorkspaceDraft {
  readonly path: string;
  readonly text: string;
}

/** Draft text is deliberately ignored; only containment decides whether isolation is stale. */
export function workspaceHasUnsavedDraft(
  workspaceRoot: string,
  drafts: readonly WorkspaceDraft[],
): boolean {
  return drafts.some((draft) => isInsideWorkspace(workspaceRoot, draft.path));
}

/**
 * The unsaved files, as one message-ready fragment.
 *
 * A blocker that names no names sends the user hunting through tabs. Sorted,
 * de-duplicated, and capped so the message stays one line: "a.ts", or
 * "a.ts, b.ts, and 2 more". Empty when nothing inside the workspace is dirty.
 */
export function summarizeUnsavedDrafts(
  workspaceRoot: string,
  drafts: readonly { readonly path: string }[],
  limit = 3,
): string {
  const names = [
    ...new Set(
      drafts
        .map((draft) => draft.path)
        .filter((path) => isInsideWorkspace(workspaceRoot, path))
        .map((path) => relative(workspaceRoot, path).split(sep).join("/")),
    ),
  ].sort();
  if (names.length === 0) return "";
  const shown = names.slice(0, Math.max(1, Math.floor(limit)));
  return names.length > shown.length
    ? `${shown.join(", ")}, and ${String(names.length - shown.length)} more`
    : shown.join(", ");
}

/** "a.ts, b.ts" or "a.ts, b.ts, and 2 more" - never an empty string. */
export function formatUnsavedDraftList(names: readonly string[], total: number): string {
  if (names.length === 0 || total <= 0) return "unsaved files";
  const shown = names.join(", ");
  return total > names.length ? `${shown}, and ${String(total - names.length)} more` : shown;
}
