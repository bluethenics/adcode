/**
 * The live preview, as the assistant reaches it.
 *
 * Two things used to stop the model from using the preview it could start. It could not
 * name a page - `open_preview` took no arguments, so "open the pricing page" opened the home
 * page - and in a framework project it got an answer before there was anything to see: the
 * dev server had been started but had not printed its address yet, so the result said
 * `starting` with no URL and the model had nowhere to go. Now it waits for the address (a
 * Vite or Next server takes seconds; a first compile can take a minute) and answers with the
 * exact page it opened.
 */
import { CHANNELS, type PreviewStatus } from "../shared/api.ts";
import { startPreview, previewStatus } from "./preview.ts";
import { recordMilestone } from "./milestones.ts";
import { currentWorkspace } from "./workspace.ts";
import { appendOutput, appendOutputEvent } from "./output.ts";
import { resolvePreviewPage } from "./agentBrowserModel.ts";

/** Longest the assistant waits for a dev server to announce where it is. */
const ADDRESS_WAIT_MS = 75_000;

type Broadcast = (channel: string, ...args: unknown[]) => void;

export interface AiPreviewOpened {
  readonly status: PreviewStatus;
  /** The page asked for, on the preview's own address; null when there is no address. */
  readonly page: string | null;
}

function waitForAddress(timeoutMs: number): Promise<PreviewStatus> {
  return new Promise((resolve) => {
    const until = Date.now() + timeoutMs;
    const check = (): void => {
      const status = previewStatus();
      if (!status.starting || status.url !== null || status.error !== null || Date.now() >= until) {
        resolve(status);
        return;
      }
      setTimeout(check, 250);
    };
    check();
  });
}

/**
 * The preview for the open folder: the one running, or a new one - once it has an address.
 *
 * A preview already serving this folder is reused, whatever started it; restarting it
 * would reload the page the user is looking at.
 */
export async function ensureAiPreview(broadcast: Broadcast): Promise<PreviewStatus> {
  const root = currentWorkspace()?.root ?? null;
  if (root === null) throw new Error("Open a project folder in ADCode before starting its live preview.");
  const publish = (status: PreviewStatus): void => {
    broadcast(CHANNELS.previewChanged, status);
    if (status.error) appendOutputEvent(status.mode === "project" ? "dev-server" : "live-server", status.error);
  };
  const existing = previewStatus();
  if (existing.root !== root || !(existing.running || existing.starting)) {
    publish(await startPreview(root, undefined, {
      onStatus: publish,
      onOutput: text => { broadcast(CHANNELS.previewOutput, text); appendOutput("dev-server", text); },
    }));
  }
  const status = await waitForAddress(ADDRESS_WAIT_MS);
  publish(status);
  if (status.url !== null) recordMilestone("preview_opened");
  return status;
}

/** Start or reuse the preview and work out the page to show. */
export async function openAiPreview(broadcast: Broadcast, path: string | null = null): Promise<AiPreviewOpened> {
  const status = await ensureAiPreview(broadcast);
  if (status.url === null) return { status, page: null };
  const page = resolvePreviewPage(status.url, path ?? "/");
  if (page === null) throw new Error(`"${path}" is not a page on the preview at ${status.url}. Pass a path such as about.html or /docs/.`);
  return { status, page };
}

/** The preview's address for `view_page`, or a sentence saying why there is none. */
export async function aiPreviewUrl(broadcast: Broadcast): Promise<string> {
  const status = await ensureAiPreview(broadcast);
  if (status.url !== null && status.running) return status.url;
  throw new Error(status.error ?? (status.starting
    ? "The project's dev server is still starting and has not printed an address. Read its output in the preview, or start it yourself with run_command background: true and pass view_page a url."
    : "The live preview is not running."));
}

/** One line for the host context: whether there is a preview and where, so the model never has to guess. */
export function describePreviewForAi(): string {
  const root = currentWorkspace()?.root ?? null;
  const status = previewStatus();
  if (root === null || status.root !== root || !(status.running || status.starting)) {
    return "Live preview: not running. open_preview or view_page starts it.";
  }
  const engine = status.mode === "project" ? `the project's dev server${status.label ? ` (${status.label})` : ""}` : "ADCode's static file server";
  if (status.url === null) return `Live preview: ${engine} is starting and has no address yet.`;
  return `Live preview: running at ${status.url} - ${engine}. Pages are relative to it: view_page {"path": "about.html"} looks at one, open_preview {"path": "about.html"} shows it to the user.`;
}
