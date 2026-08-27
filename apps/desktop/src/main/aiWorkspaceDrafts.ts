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
