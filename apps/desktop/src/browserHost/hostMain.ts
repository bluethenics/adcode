/**
 * The browser host's registrations: host/index.ts without what needs a machine (its HTTP
 * server, git credentials over askpass, a Chromium for the agent's own browser, signals).
 * Loaded by worker.ts once the saved files are back in memory.
 */
import "../main/profileBootstrap.ts";
import { describeDebugContext, registerDebugLogIpc } from "../main/debugLog.ts";
import { registerIpc } from "../main/ipc.ts";
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
import { registerAccountIpc } from "../main/accountIpc.ts";
import { loadKeybindings } from "../main/keybindings.ts";
import { refreshModelLists } from "../main/ai.ts";
import { getAdRuntime } from "../main/adRuntime.ts";
import { loadSettings } from "../main/settings.ts";
import { currentWorkspace } from "../main/workspace.ts";
import { useBackendAccount } from "../main/backend.ts";
import { CHANNELS } from "../shared/api.ts";
import { BrowserWindow, app, dispatcher } from "../host/electronShim.ts";
import { createBrowserAccount } from "../host/browserAccount.ts";
import { createHostOps } from "../host/hostOps.ts";
import type { HostHello } from "../web/wire.ts";
import { createGitHubProjectOps } from "./githubProjects.ts";
import { createGitHubApi } from "./githubApi.ts";
import { useGitHubApi } from "./git.ts";

/** The channel a tab listens on for "send a fresh sign-in token" (host/index.ts). */
const TOKEN_NEEDED_CHANNEL = "cloud:token-needed";
const PROJECTS_HOME = process.env["ADCODE_PROJECTS_HOME"] ?? "/home/adcode/projects";

/* Whoever is signed in, in the browser, owns this tab's earnings and AI allowance. */
export const account = createBrowserAccount({
  now: () => Date.now(),
  requestToken: () => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(TOKEN_NEEDED_CHANNEL);
  },
  waitMs: 15_000,
});
useBackendAccount(account);

registerIpc(() => undefined, () => false);
registerSupportIpc();
registerDebugLogIpc();
describeDebugContext({ projectRoot: () => currentWorkspace()?.root ?? null });
registerActivityIpc();
registerOnboardingIpc();
registerMilestoneIpc();
registerReferralIpc();
registerRatingIpc();
registerPowerIpc();
registerPhoneLinkUnsupported();
registerPinPromptIpc();
registerUpdateIpc();
registerAccountIpc();
dispatcher.on(CHANNELS.windowRendererReady, () => undefined);

startNoticePolling();
startReleasePolling();
registerLicenceIpc();
void refreshModelLists().catch(() => undefined);
void loadKeybindings().catch(() => undefined);
void loadSettings()
  .then(() => getAdRuntime().start())
  .catch(() => undefined);

export const hello = (): HostHello => ({ version: app.getVersion(), surface: "web", projectsHome: PROJECTS_HOME });
export const onFocusChange = (focused: boolean): void => getAdRuntime().setWindowFocused(focused);

/* GitHub, through the cloud Worker on this page's own origin, as the signed-in person. */
const github = createGitHubApi({
  origin: location.origin,
  token: async () => {
    const token = await account.getToken();
    return token.ok ? token.value : null;
  },
});
useGitHubApi(github);

const hostOps = createHostOps({ projectsHome: PROJECTS_HOME });
export const ops: Readonly<Record<string, (...args: unknown[]) => Promise<unknown>>> = {
  projects: hostOps["projects"]!,
  createProjectFolder: hostOps["createProjectFolder"]!,
  writeFile: hostOps["writeFile"]!,
  ...createGitHubProjectOps({ projectsHome: PROJECTS_HOME, api: github }),
};
