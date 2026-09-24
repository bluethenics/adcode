import type { ToolDefinition } from "@adcode/ai";
import { CHANNELS } from "../shared/api.ts";
import { startPreview, previewStatus } from "./preview.ts";
import { currentWorkspace } from "./workspace.ts";
import { appendOutput, appendOutputEvent } from "./output.ts";

export const OPEN_PREVIEW: ToolDefinition = {
  name: "open_preview",
  description: "Show the open web project's live server in a box in chat. Starts the detected web framework dev server or static server, or reuses the running preview. Only saved/applied files are served; ask the user to apply pending proposals first. Desktop GUI programs cannot run here.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  mutating: false,
};

export async function openAiPreview(broadcast: (channel: string, ...args: unknown[]) => void) {
  const root = currentWorkspace()?.root ?? null;
  if (root === null) throw new Error("Open a project folder in ADCode before starting its live preview.");
  const publish = (status: ReturnType<typeof previewStatus>): void => {
    broadcast(CHANNELS.previewChanged, status);
    if (status.error) appendOutputEvent(status.mode === "project" ? "dev-server" : "live-server", status.error);
  };
  const existing = previewStatus();
  const status = existing.root === root && (existing.running || existing.starting)
    ? existing
    : await startPreview(root, undefined, {
      onStatus: publish,
      onOutput: text => { broadcast(CHANNELS.previewOutput, text); appendOutput("dev-server", text); },
    });
  publish(status);
  return status;
}
