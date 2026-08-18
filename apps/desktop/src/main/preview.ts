/**
 * One preview, two engines.
 *
 * `liveServer.ts` serves a folder. `devServer.ts` runs the project's own dev script. This
 * decides which one a given folder wants, keeps exactly one of them alive at a time, and
 * gives the renderer a single status to render regardless of which is behind it.
 *
 * The choice is automatic and overridable, in that order. Automatic because a beginner
 * should not have to know the difference to press play; overridable because the detection
 * is a guess, and a guess the user cannot correct is worse than no guess at all.
 */
import { liveServerStatus, startLiveServer, stopLiveServer } from "./liveServer.ts";
import {
  detectProject,
  devServerLog,
  devServerStatus,
  startDevServer,
  stopDevServer,
} from "./devServer.ts";
import { stripAnsi } from "./devCommand.ts";
import type { PreviewMode, PreviewProject, PreviewStatus } from "../shared/api.ts";

export interface PreviewEvents {
  readonly onStatus: (status: PreviewStatus) => void;
  readonly onOutput: (chunk: string) => void;
}

/** Which engine last started. Read to route `status`, `stop` and `openExternal`. */
let current: PreviewMode = "static";

export function previewStatus(): PreviewStatus {
  return current === "project" ? devServerStatus() : liveServerStatus();
}

/**
 * Colour is stripped here, on the way out.
 *
 * The renderer shows this in a plain `<pre>`, and there is exactly one ANSI implementation
 * in this codebase - a second one in the renderer would drift from this one and the drift
 * would show up as escape codes on screen.
 */
export function previewLog(): string {
  return current === "project" ? stripAnsi(devServerLog()) : "";
}

export async function detectPreviewProject(root: string | null): Promise<PreviewProject | null> {
  const command = await detectProject(root);
  return command === null ? null : { label: command.label };
}

/**
 * Start the preview.
 *
 * With no mode, a **recognised framework** wins and nothing else does. Two failure modes
 * are being balanced, and the line falls between them:
 *
 * - Serving a Vite or Next project as static files shows the user their unbuilt
 *   `index.html` - a shell containing one `<script type="module">` that resolves to
 *   nothing. It renders as a blank page with no error anywhere, which is the worst outcome
 *   available. So when a framework config is present, running the dev server is automatic.
 * - Running whatever a project happens to call `dev` is not the same promise. ADCode's own
 *   `dev` script launches Electron and serves no page; other projects' start databases,
 *   watchers, or full builds. Pressing "preview" must not mean "execute an arbitrary
 *   command", so a bare `dev` script is offered in the bar and never started unasked.
 */
export async function startPreview(
  root: string | null,
  requested: PreviewMode | undefined,
  events: PreviewEvents,
): Promise<PreviewStatus> {
  await stopPreview();

  const detected = requested === undefined ? await detectProject(root) : null;
  const mode = requested ?? (detected?.framework == null ? "static" : "project");
  current = mode;

  if (mode === "project") {
    return startDevServer(root, {
      onOutput: events.onOutput,
      onStatus: events.onStatus,
    });
  }

  return startLiveServer(root);
}

export async function stopPreview(): Promise<PreviewStatus> {
  // Both, unconditionally. `current` says which one should be running, and stopping only
  // that one trusts a variable to be right about a subprocess - which is how a dev server
  // survives a mode switch and keeps the port for the rest of the session.
  await stopDevServer();
  return stopLiveServer();
}
