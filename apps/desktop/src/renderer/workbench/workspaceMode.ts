/** Presentation preferences only. Project services never belong to a mode. */
export type WorkspaceMode = "vibe" | "code";
export const MODE_STORAGE_KEY = "adcode.workspace.mode";
export function workspaceMode(value: string | null): WorkspaceMode {
  return value === "code" ? "code" : "vibe";
}
export const MODE_DESCRIPTION: Record<WorkspaceMode, string> = {
  vibe: "Build and change your project through conversation.",
  code: "Work directly with files, code, terminal and debugging tools.",
};
