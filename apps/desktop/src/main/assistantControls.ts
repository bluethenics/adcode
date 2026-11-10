import { app, BrowserWindow } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { ToolRunner } from "@adcode/ai";
import { CHANNELS } from "../shared/api.ts";
import { currentWorkspace, onWorkspaceRootChanged } from "./workspace.ts";
import { connectAssistantMcp } from "./assistantMcp.ts";
import { createOpenApiSession } from "./openapiSession.ts";
import { installedSkillRoots } from "./assistantSkills.ts";
import { createAssistantControlsService, ASSISTANT_EXTENSION_TOOLS, type AssistantConnectRequest } from "./assistantControlsService.ts";
import { createConnectorSecrets } from "./connectorSecrets.ts";
import { createConnectorSources, type PendingDraft } from "./connectorImport.ts";
import { extensionRoot, installArchive, installFolder, pluginRoot, removeInstalled } from "./connectorInstall.ts";
import { confirmInWindow } from "./themedConfirm.ts";
import { forgetMcpSignIn, signInToMcp } from "./mcpOAuth.ts";
import { setFeatureSurface } from "@adcode/help";
import { ADCODE_APP_TOOLS, createAdcodeAppTools } from "./adcodeAppTools.ts";
import { currentSettings, writeSetting } from "./settings.ts";
import { runRoomTool } from "./liveRoom.ts";

export { ASSISTANT_EXTENSION_TOOLS, ADCODE_APP_TOOLS };
/** The "Ask before connector tools" setting, read fresh so a change applies to the next call. */
export const askBeforeConnectorTools = (): boolean => currentSettings()["adcode.ai.askBeforeConnectorTools"] === true;
let service: ReturnType<typeof createAssistantControlsService> | null = null;
function announce(): void {
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(CHANNELS.aiControlsChanged);
}

/** Everything ADCode installs lives under one folder, so removal can stay contained. */
const adcodeRoot = (): string => join(homedir(), ".adcode");

/** An MCP server (or extension/plugin server), or an API description - one decision, one place. */
function connect(request: AssistantConnectRequest, onClose: () => void) {
  return request.server.kind === "openapi"
    ? Promise.resolve(createOpenApiSession({ server: request.server, values: request.values }))
    : connectAssistantMcp(request, onClose);
}

/** Put an extension's or plugin's files where ADCode keeps them, and answer with the folder. */
async function install(pending: PendingDraft): Promise<string> {
  const plan = pending.install;
  if (plan === null) throw new Error("That import has no files to install.");
  const root = plan.kind === "extension" ? extensionRoot(homedir()) : pluginRoot(homedir());
  if (plan.from === "folder") return (await installFolder(plan.path, root, plan.slug)).directory;
  if (plan.from === "archive") return (await installArchive(await readFile(plan.path), root, plan.slug)).directory;
  return (await installArchive(plan.bytes, root, plan.slug)).directory;
}

export function assistantControls() {
  if (!service) {
    const workspace = (): string | null => currentWorkspace()?.root ?? null;
    service = createAssistantControlsService({
      directory: app.getPath("userData"),
      workspace,
      // Read fresh on every use: a plugin installed just now brings its skills with it.
      installedSkills: () => installedSkillRoots(homedir(), process.env["CODEX_HOME"]),
      connect,
      changed: announce,
      // An external tool call waits for the user's yes, asked in the app's themed dialog.
      confirm: (message, detail, signal) =>
        confirmInWindow(BrowserWindow.getFocusedWindow(), { title: message, body: detail, confirmLabel: "Allow once", cancelLabel: "Cancel" }, signal),
      // Off by default: enabled connector tools run without a dialog on every call.
      askBeforeCalls: askBeforeConnectorTools,
      oauth: {
        signIn: (request) => signInToMcp(request.server.id, request.server.endpoint, request.values),
        forget: forgetMcpSignIn,
      },
      secrets: createConnectorSecrets(),
      sources: createConnectorSources({ home: homedir(), appData: app.getPath("appData"), workspace }),
      install,
      removeInstall: (directory) => removeInstalled(directory, adcodeRoot()),
    });
    onWorkspaceRootChanged(() => { announce(); });
  }
  return service;
}
/** The web host runs this same code with no desktop; its features and connectors are the web's. */
const onWeb = process.env["ADCODE_PLATFORM"] === "web";
if (onWeb) setFeatureSurface("web");

let appTools: ToolRunner | null = null;
/** ADCode itself as tools: its features, its settings, its connectors. */
function adcodeAppTools(): ToolRunner {
  appTools ??= createAdcodeAppTools({
    controls: assistantControls(),
    askBeforeConnectorTools,
    confirm: (title, detail, signal) =>
      confirmInWindow(BrowserWindow.getFocusedWindow(), { title, body: detail, confirmLabel: "Allow", cancelLabel: "Cancel" }, signal),
    platform: onWeb ? "linux" : process.platform,
    settings: currentSettings,
    writeSetting,
    room: runRoomTool,
    ...(onWeb ? {} : { browser: async (input: Record<string, unknown>, signal: AbortSignal) => (await import("./liveBrowser.ts")).runLiveBrowser(input, signal) }),
    // The window the person is using; the menu's own channel, so it runs like a menu choice.
    runCommand: (command) => {
      const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null;
      if (target === null || target.isDestroyed()) return false;
      target.webContents.send(CHANNELS.menuCommand, command);
      return true;
    },
  });
  return appTools;
}

export function withAssistantExtensions(base: ToolRunner): ToolRunner {
  const names = new Set(ASSISTANT_EXTENSION_TOOLS.map(tool => tool.name));
  const appNames = new Set(ADCODE_APP_TOOLS.map(tool => tool.name));
  return {
    run: (call, signal) => names.has(call.name) ? assistantControls().runner.run(call, signal)
      : appNames.has(call.name) ? adcodeAppTools().run(call, signal)
      : base.run(call, signal),
  };
}
export async function closeAssistantControls(): Promise<void> { await service?.close(); }
