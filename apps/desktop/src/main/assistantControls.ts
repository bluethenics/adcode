import { app, BrowserWindow, dialog } from "electron";
import { homedir } from "node:os";
import type { ToolRunner } from "@adcode/ai";
import { CHANNELS } from "../shared/api.ts";
import { currentWorkspace, onWorkspaceRootChanged } from "./workspace.ts";
import { connectAssistantMcp } from "./assistantMcp.ts";
import { installedSkillRoots } from "./assistantSkills.ts";
import { createAssistantControlsService, ASSISTANT_EXTENSION_TOOLS } from "./assistantControlsService.ts";

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
      confirm: async (message, detail, signal) => {
        const options = { type: "question" as const, message, detail, buttons: ["Cancel", "Allow once"], defaultId: 0, cancelId: 0, noLink: true, ...(signal ? { signal } : {}) };
        const parent = BrowserWindow.getFocusedWindow();
        const answer = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
        return answer.response === 1;
      },
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
