/**
 * Getting projects into and out of the web version's sandbox.
 *
 * Upload a folder or a .zip from this computer (GitHub repositories open through
 * githubRepoPicker.ts). The rules - what is left behind, which
 * paths are allowed - live in `upload.ts`, `unzip.ts` and the host's `hostOps.ts`; this is the
 * part with buttons.
 */
import type { HostSocket } from "./socket.ts";
import { readZip } from "./unzip.ts";
import { planUpload, UPLOAD_LIMIT_BYTES } from "./upload.ts";

/** One frame carries one file; base64 makes it a third bigger, and the socket takes 64 MB. */
const FILE_LIMIT_BYTES = 40 * 1024 * 1024;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A small modal with a title, a body, and a promise that settles when it closes. */
function modal(title: string): { dialog: HTMLDialogElement; body: HTMLElement; footer: HTMLElement; close: () => void; closed: Promise<void> } {
  const dialog = el("dialog", "web-picker");
  const header = el("header", "web-picker-header");
  const heading = el("h2", undefined, title);
  const dismiss = el("button", "web-picker-close", "×");
  dismiss.type = "button";
  dismiss.setAttribute("aria-label", "Close");
  header.append(heading, dismiss);
  const body = el("div", "web-action-body");
  const footer = el("footer", "web-picker-footer");
  dialog.append(header, body, footer);
  document.body.append(dialog);
  let done: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => { done = resolve; });
  const close = (): void => {
    if (!dialog.open) return;
    dialog.close();
    dialog.remove();
    done();
  };
  dismiss.addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.showModal();
  return { dialog, body, footer, close, closed };
}

/** Opens the browser's file picker: a folder, or one .zip. */
function pickFiles(folder: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = el("input");
    input.type = "file";
    if (folder) {
      input.setAttribute("webkitdirectory", "");
      input.multiple = true;
    } else {
      input.accept = ".zip,application/zip";
    }
    input.addEventListener("change", () => resolve([...(input.files ?? [])]));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

interface Pending {
  readonly path: string;
  readonly size: number;
  readonly bytes: () => Promise<Uint8Array>;
}

/** Uploads files the person chose into a new project; reports progress, resolves with the project path. */
export async function uploadProject(socket: HostSocket, files: readonly File[], progress: (done: number, total: number, note?: string) => void): Promise<string | null> {
  if (files.length === 0) return null;
  let entries: Pending[];
  let zipName: string | null = null;
  if (files.length === 1 && /\.zip$/i.test(files[0]!.name)) {
    zipName = files[0]!.name.replace(/\.zip$/i, "");
    const unpacked = await readZip(new Uint8Array(await files[0]!.arrayBuffer()));
    entries = unpacked.map((file) => ({ path: file.path, size: file.data.length, bytes: async () => file.data }));
  } else {
    entries = files.map((file) => ({ path: file.webkitRelativePath || file.name, size: file.size, bytes: async () => new Uint8Array(await file.arrayBuffer()) }));
  }

  const plan = planUpload(entries);
  if (plan.tooLarge) throw new Error(`That's more than ${UPLOAD_LIMIT_BYTES / 1024 / 1024} MB without node_modules and .git. Push it to GitHub and import it instead.`);
  if (plan.files.length === 0) throw new Error("There was nothing to upload in that.");

  const projectName = plan.project === "upload" && zipName !== null ? zipName : plan.project;
  const root = (await socket.op("createProjectFolder", [projectName])) as string;
  let skippedLarge = 0;
  let done = 0;
  for (const file of plan.files) {
    if (file.size > FILE_LIMIT_BYTES) {
      skippedLarge += 1;
      continue;
    }
    await socket.op("writeFile", [root, file.path, await entries[file.index]!.bytes()]);
    done += 1;
    progress(done, plan.files.length);
  }
  const notes = [
    plan.skipped > 0 ? `${plan.skipped} left out (node_modules, .git and the like)` : null,
    skippedLarge > 0 ? `${skippedLarge} over 40 MB left out` : null,
  ].filter((note): note is string => note !== null);
  progress(done, plan.files.length, notes.length > 0 ? notes.join("; ") : undefined);
  return root;
}

/** The upload dialog: choose a folder or a .zip, watch it go up. Resolves with the project path, or null. */
export function uploadDialog(socket: HostSocket): Promise<string | null> {
  return new Promise((resolve) => {
    const { body, footer, close, closed } = modal("Upload a project");
    let result: string | null = null;
    void closed.then(() => resolve(result));
    const lead = el("p", "web-gate-lead", "Choose a folder or a .zip from this computer. node_modules and .git stay behind - ADCode reinstalls packages when it needs them.");
    const status = el("p", "web-action-status");
    status.setAttribute("role", "status");
    const error = el("p", "web-gate-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    body.append(lead, status, error);
    const start = (folder: boolean): void => {
      void pickFiles(folder).then(async (files) => {
        if (files.length === 0) return;
        for (const button of footer.querySelectorAll("button")) button.disabled = true;
        error.hidden = true;
        try {
          result = await uploadProject(socket, files, (done, total, note) => {
            status.textContent = note === undefined ? `Uploading ${done} of ${total} files…` : `Uploaded ${done} files. ${note}.`;
          });
          close();
        } catch (failure) {
          error.textContent = failure instanceof Error ? failure.message : "The upload didn't finish. Try again.";
          error.hidden = false;
          for (const button of footer.querySelectorAll("button")) button.disabled = false;
        }
      });
    };
    const folder = el("button", "web-gate-button web-gate-primary", "Choose a folder");
    folder.type = "button";
    folder.addEventListener("click", () => start(true));
    const zip = el("button", "web-gate-button", "Choose a .zip");
    zip.type = "button";
    zip.addEventListener("click", () => start(false));
    footer.append(folder, zip);
  });
}
