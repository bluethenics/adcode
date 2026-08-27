import type { AiWorkspaceApplySelectionView } from "../shared/api.ts";

const TASK_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const HUNK_ID = /^h\d{1,6}$/;

export function validAiWorkspaceTaskId(value: unknown): value is string {
  return typeof value === "string" && TASK_ID.test(value);
}

function portablePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096) return false;
  if (value.includes("\u0000") || value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return false;
  const parts = value.replaceAll("\\", "/").split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

export function parseAiWorkspaceApply(value: unknown): AiWorkspaceApplySelectionView[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) return null;
  const selections: AiWorkspaceApplySelectionView[] = [];
  const paths = new Set<string>();

  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const candidate = raw as { path?: unknown; acceptedHunkIds?: unknown };
    if (!portablePath(candidate.path) || paths.has(candidate.path)) return null;
    if (
      !Array.isArray(candidate.acceptedHunkIds) ||
      candidate.acceptedHunkIds.length === 0 ||
      candidate.acceptedHunkIds.length > 10_000 ||
      !candidate.acceptedHunkIds.every((id) => typeof id === "string" && HUNK_ID.test(id))
    ) {
      return null;
    }
    paths.add(candidate.path);
    selections.push({ path: candidate.path, acceptedHunkIds: [...candidate.acceptedHunkIds] });
  }
  return selections;
}
