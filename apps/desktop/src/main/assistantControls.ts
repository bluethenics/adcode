import { app, BrowserWindow } from "electron";
import { homedir } from "node:os";
import type { ToolRunner } from "@adcode/ai";
import { CHANNELS } from "../shared/api.ts";
import { currentWorkspace, onWorkspaceRootChanged } from "./workspace.ts";
import { connectAssistantMcp } from "./assistantMcp.ts";
import { installedSkillRoots } from "./assistantSkills.ts";
import { createAssistantControlsService, ASSISTANT_EXTENSION_TOOLS } from "./assistantControlsService.ts";
import { confirmInWindow } from "./themedConfirm.ts";

export { ASSISTANT_EXTENSION_TOOLS };
let service: ReturnType<typeof createAssistantControlsService> | null = null;
function announce(): void {
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(CHANNELS.aiControlsChanged);
}
export function assistantControls() {
  if (!service) {
    service = createAssistantControlsService({
      directory: app.getPath("userData"),
      workspace: () => currentWorkspace()?.root ?? null,
      installedSkills: installedSkillRoots(homedir(), process.env["CODEX_HOME"]),
      connect: connectAssistantMcp,
      changed: announce,
      // An external tool call waits for the user's yes, asked in the app's themed dialog.
      confirm: (message, detail, signal) =>
        confirmInWindow(BrowserWindow.getFocusedWindow(), { title: message, body: detail, confirmLabel: "Allow once", cancelLabel: "Cancel" }, signal),
    });
    onWorkspaceRootChanged(() => { announce(); });
  }
  return service;
}
export function withAssistantExtensions(base: ToolRunner): ToolRunner {
  const names = new Set(ASSISTANT_EXTENSION_TOOLS.map(tool => tool.name));
  return { run: (call, signal) => names.has(call.name) ? assistantControls().runner.run(call, signal) : base.run(call, signal) };
}
export async function closeAssistantControls(): Promise<void> { await service?.close(); }
