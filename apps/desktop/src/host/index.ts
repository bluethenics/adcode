/**
 * adcode-host: ADCode's main process, without Electron, for the web version.
 *
 * This mirrors `main/index.ts`'s start-up, minus everything that is about windows on a desktop:
 * no `BrowserWindow`, no `app://` protocol, no menu, no auto-update, no single-instance lock.
 * What is left registers the same IPC handlers the desktop does, and the socket server routes
 * each browser tab's calls to them. Module order matters for the same reason it does there:
 * `cloudEnv` sets the paths before anything reads them, and `debugLog` wraps `ipcMain.handle`
 * before any handler is registered.
 */
import "./cloudEnv.ts";
import "../main/profileBootstrap.ts";
import { describeDebugContext, registerDebugLogIpc } from "../main/debugLog.ts";
import { registerIpc } from "../main/ipc.ts";
import { closeAssistantControls } from "../main/assistantControls.ts";
import { registerSupportIpc } from "../main/supportIpc.ts";
import { registerActivityIpc } from "../main/activity.ts";
import { registerOnboardingIpc } from "../main/onboarding.ts";
import { registerMilestoneIpc } from "../main/milestones.ts";
import { registerReferralIpc } from "../main/referrals.ts";
import { registerRatingIpc } from "../main/ratingAsk.ts";
import { registerPowerIpc } from "../main/powerAfterTasks.ts";
import { registerPhoneLinkUnsupported } from "../main/phoneLink.ts";
import { registerPinPromptIpc } from "../main/pinPrompt.ts";
import { registerUpdateIpc } from "../main/autoUpdate.ts";
import { startNoticePolling } from "../main/notices.ts";
import { startReleasePolling } from "../main/releases.ts";
import { registerLicenceIpc } from "../main/licences.ts";
import { refreshMcpServer } from "../main/memory.ts";
import { registerAccountIpc } from "../main/accountIpc.ts";
import { loadKeybindings } from "../main/keybindings.ts";
import { disposeAllTerminals } from "../main/terminal.ts";
import { shutdownAllServers } from "../main/lsp.ts";
import { stopPreview } from "../main/preview.ts";
import { aiRuns, aiStopToolProcesses, aiTeamList, refreshModelLists } from "../main/ai.ts";
import { flushModelOutcomes } from "../main/modelOutcomes.ts";
import { flushAiUsage } from "../main/aiUsage.ts";
import { getAdRuntime } from "../main/adRuntime.ts";
import { loadSettings } from "../main/settings.ts";
import { currentWorkspace } from "../main/workspace.ts";
import { useBackendAccount } from "../main/backend.ts";
import { CHANNELS } from "../shared/api.ts";
import { BrowserWindow, app, dispatcher } from "./electronShim.ts";
import { createBrowserAccount } from "./browserAccount.ts";
import { createHostOps } from "./hostOps.ts";
import { createGitHubOps, writeAskpass } from "./githubConnect.ts";
import { chromiumTransportFactory } from "./cdpBrowser.ts";
import { setAgentPageTransport } from "../main/agentBrowser.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startHostServer } from "./server.ts";

/** Calls that run for as long as the work they start: while one is open, the sandbox is busy. */
const LONG_CHANNELS: ReadonlySet<string> = new Set([
  CHANNELS.browserView,
  CHANNELS.aiSend,
  CHANNELS.aiCompact,
  CHANNELS.aiInlineEdit,
  CHANNELS.aiWorkspaceApply,
  CHANNELS.aiTeamStart,
  CHANNELS.gitClone,
  CHANNELS.gitPush,
  CHANNELS.gitPull,
  CHANNELS.gitFetch,
  CHANNELS.workspaceCreateProject,
]);

/** The channel a tab listens on for "send a fresh sign-in token". */
export const TOKEN_NEEDED_CHANNEL = "cloud:token-needed";

/*
 * Whoever is signed in, in the browser, owns this sandbox's earnings and AI allowance. The
 * desktop's anonymous account is never created here.
 */
const account = createBrowserAccount({
  now: () => Date.now(),
  requestToken: () => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(TOKEN_NEEDED_CHANNEL);
  },
  waitMs: 15_000,
});
useBackendAccount(account);

async function busy(): Promise<boolean> {
  if (dispatcher.inFlight(LONG_CHANNELS) > 0) return true;
  // A chat keeps working with no call open: going on by itself after a step limit, or after
  // the tab that started it was closed. The sandbox stays up for it.
  if (aiRuns().length > 0) return true;
  const teams = await aiTeamList();
  return teams.some((team) => team.state === "preparing" || team.state === "running" || team.state === "merging");
}

registerIpc(() => undefined);
registerSupportIpc();
registerDebugLogIpc();
describeDebugContext({ projectRoot: () => currentWorkspace()?.root ?? null });
registerActivityIpc();
registerOnboardingIpc();
registerMilestoneIpc();
registerReferralIpc();
registerRatingIpc();
// Both report themselves unavailable here: the sandbox is not the person's computer.
registerPowerIpc();
registerPhoneLinkUnsupported();
registerPinPromptIpc();
registerUpdateIpc();
registerAccountIpc();
// The desktop listens for this to deliver launch intents; a browser tab has none, so it is only acknowledged.
dispatcher.on(CHANNELS.windowRendererReady, () => undefined);

startNoticePolling();
startReleasePolling();
registerLicenceIpc();
void refreshMcpServer().catch(() => undefined);
void refreshModelLists().catch(() => undefined);
void loadKeybindings().catch(() => undefined);
void loadSettings()
  .then(() => getAdRuntime().start())
  .catch(() => undefined);

/*
 * Git in the sandbox asks this program for GitHub credentials (the token from "Connect GitHub"),
 * and never prompts on a terminal nobody is watching. On a Windows development machine git
 * keeps using the computer's own credential manager.
 */
const userDataDir = process.env["ADCODE_USER_DATA_DIR"] ?? "";
if (process.platform !== "win32") {
  process.env["GIT_ASKPASS"] = await writeAskpass(userDataDir);
  process.env["GIT_TERMINAL_PROMPT"] = "0";
}

/*
 * The agent's own browser (`view_page`): headless Chromium in the sandbox image, or Edge on a
 * Windows development machine, in place of the desktop's offscreen Electron window.
 */
setAgentPageTransport(chromiumTransportFactory(
  process.env["CHROMIUM_PATH"] ?? (process.platform === "win32" ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : "/usr/bin/chromium"),
));

const run = promisify(execFile);
async function setIdentityIfMissing(name: string, email: string): Promise<void> {
  const existing = await run("git", ["config", "--global", "--get", "user.email"]).then((result) => result.stdout.trim(), () => "");
  if (existing.length > 0) return;
  await run("git", ["config", "--global", "user.name", name]);
  await run("git", ["config", "--global", "user.email", email]);
}

const port = Number(process.env["ADCODE_HOST_PORT"] ?? "7300");
const secret = process.env["ADCODE_HOST_SECRET"] ?? null;

const server = await startHostServer({
  port,
  host: process.env["ADCODE_HOST_BIND"] ?? (secret === null ? "127.0.0.1" : "0.0.0.0"),
  secret,
  hello: () => ({ version: app.getVersion(), surface: "web", projectsHome: process.env["ADCODE_PROJECTS_HOME"] ?? "" }),
  busy,
  onAuth: (token) => account.accept(token),
  onFocusChange: (anyFocused) => getAdRuntime().setWindowFocused(anyFocused),
  ops: {
    ...createHostOps({ projectsHome: process.env["ADCODE_PROJECTS_HOME"] ?? "" }),
    ...createGitHubOps({
      userDataDir,
      sealKey: () => process.env["ADCODE_SEAL_KEY"] ?? "",
      fetcher: fetch,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      setIdentity: setIdentityIfMissing,
    }),
  },
});

console.log(`adcode-host ${app.getVersion()} listening on ${server.port}`);

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await Promise.allSettled([flushModelOutcomes(), flushAiUsage(), closeAssistantControls(), shutdownAllServers(), stopPreview()]);
  disposeAllTerminals();
  aiStopToolProcesses();
  await server.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
