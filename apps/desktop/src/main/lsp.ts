/**
 * Language servers: spawning them, talking to them, and surviving them.
 *
 * `@adcode/lsp` holds everything that is a pure function - framing, message building,
 * position conversion - and is tested exhaustively without a subprocess. This file holds
 * the part that cannot be: one child process per language, request correlation, document
 * synchronisation, and what to do when a server dies.
 *
 * The design commitments worth knowing before changing anything here:
 *
 * **One server per language, not per file.** That is what the protocol expects, and it is
 * also what makes `rust-analyzer` usable at all - it builds a whole-crate index once.
 *
 * **A dead server is reported once and then left alone.** Brief §11's table says: "Restart
 * with backoff, cap the retries, surface it once in the status bar. Never a modal." A
 * server that crashes on a particular file will crash again on the same file, and a client
 * that keeps restarting it turns one broken feature into a machine that pegs a core.
 *
 * **Nothing here throws into the caller.** Every failure becomes a status the renderer can
 * draw, because the alternative is an unhandled rejection in the main process taking the
 * window with it over a language server that was never essential.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  createMessageReader,
  didChangeParams,
  didCloseParams,
  didOpenParams,
  encodeMessage,
  initializeParams,
  notification,
  pathToUri,
  positionParams,
  request,
  resolveServer,
  toDiagnostic,
  uriToPath,
  type LspCompletionItem,
  type LspDiagnostic,
  type ServerSpec,
} from "@adcode/lsp";
import type { Diagnostic } from "@adcode/diagnostics";
import { findExecutable, launchFor } from "./executables.ts";
import type { LanguageCompletion, LanguageServerState } from "../shared/api.ts";

/** Cap from §11. Three tries is enough to ride out a flake and few enough to notice. */
const MAX_RESTARTS = 3;

/** A request nobody answered must not leak its promise forever. */
const REQUEST_TIMEOUT_MS = 8_000;

export interface LspEvents {
  readonly onDiagnostics: (file: string, diagnostics: readonly Diagnostic[]) => void;
  readonly onState: (states: readonly LanguageServerState[]) => void;
}

interface Session {
  readonly spec: ServerSpec;
  readonly child: ChildProcessWithoutNullStreams;
  readonly pending: Map<number, (result: unknown) => void>;
  /** Documents this server has been told about, so a restart can re-open them. */
  readonly open: Map<string, { languageId: string; version: number; text: string }>;
  ready: boolean;
  nextId: number;
}

const sessions = new Map<string, Session>();
const restarts = new Map<string, number>();

/** Sticky per language: what the renderer shows when intelligence is missing. */
const states = new Map<string, LanguageServerState>();

let events: LspEvents | null = null;
let workspaceRoot: string | null = null;
let customServers: readonly ServerSpec[] = [];
let enabled = true;

export function configureLsp(next: LspEvents): void {
  events = next;
}

export function setLspWorkspace(root: string | null): void {
  if (root === workspaceRoot) return;

  workspaceRoot = root;
  void shutdownAllServers();
}

export function setCustomServers(next: readonly ServerSpec[]): void {
  const changed =
    next.length !== customServers.length ||
    next.some((server, index) => server.command !== customServers[index]?.command);

  customServers = next;

  // A running server was chosen under the old list, so it may now be the wrong program for
  // its language. Restarting is the only way to honour the change; they come back on the
  // next edit, which for a settings screen the user has to close first is imperceptible.
  if (changed) void shutdownAllServers();
}

/**
 * `adcode.language.lspClient`.
 *
 * Off stops everything and refuses to start anything, rather than leaving the subprocesses
 * up and ignoring them - the row says "language server intelligence", and a user who turns
 * it off means the programs too, not just the squiggles.
 */
export function setLspEnabled(next: boolean): void {
  if (enabled === next) return;

  enabled = next;
  if (!enabled) void shutdownAllServers();
}

export function languageServerStates(): LanguageServerState[] {
  return [...states.values()];
}

function publishState(languageId: string, state: LanguageServerState): void {
  states.set(languageId, state);
  events?.onState(languageServerStates());
}

function send(session: Session, payload: unknown): void {
  if (session.child.stdin.destroyed) return;

  try {
    session.child.stdin.write(encodeMessage(payload));
  } catch {
    // The pipe closed between the check and the write. `onExit` is already on its way and
    // will publish the state; there is nothing useful to do here.
  }
}

function ask(session: Session, method: string, params: unknown): Promise<unknown> {
  const id = session.nextId;
  session.nextId += 1;

  return new Promise<unknown>((settle) => {
    const timer = setTimeout(() => {
      session.pending.delete(id);
      // `null` rather than a rejection: every caller of this treats "no answer" and "no
      // result" identically, and a rejection would only be somewhere else to write a catch.
      settle(null);
    }, REQUEST_TIMEOUT_MS);

    session.pending.set(id, (result) => {
      clearTimeout(timer);
      settle(result);
    });

    send(session, request(id, method, params));
  });
}

function handleMessage(session: Session, body: string): void {
  let message: {
    id?: number;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: { message?: string };
  };

  try {
    message = JSON.parse(body);
  } catch {
    return;
  }

  if (typeof message.id === "number" && message.method === undefined) {
    const settle = session.pending.get(message.id);
    session.pending.delete(message.id);
    settle?.(message.error === undefined ? message.result : null);
    return;
  }

  if (message.method === "textDocument/publishDiagnostics") {
    const params = message.params as { uri?: string; diagnostics?: LspDiagnostic[] } | undefined;
    if (params?.uri === undefined) return;

    const file = uriToPath(params.uri);
    const list = (params.diagnostics ?? []).map((item) =>
      toDiagnostic(item, file, session.spec.id),
    );

    events?.onDiagnostics(file, list);
    return;
  }

  /*
   * A server request we do not implement still needs an answer.
   *
   * Several servers block on these - `client/registerCapability` in particular - and a
   * client that ignores them presents as a server that stops responding partway through
   * startup, with nothing anywhere indicating a reply was expected.
   */
  if (typeof message.id === "number" && message.method !== undefined) {
    send(session, { jsonrpc: "2.0", id: message.id, result: null });
  }
}

export function startServerFor(languageId: string): Session | null {
  const existing = sessions.get(languageId);
  if (existing !== undefined) return existing;

  if (!enabled || workspaceRoot === null) return null;

  const spec = resolveServer(languageId, customServers);
  if (spec === null) return null;

  if ((restarts.get(languageId) ?? 0) > MAX_RESTARTS) return null;

  const resolved = findExecutable(spec.command, process.platform);
  if (resolved === null) {
    // Not an error - most people have not installed a Rust toolchain, and saying so as a
    // failure would be scolding them for a choice. It is a fact plus the command that
    // changes it, which is the difference between a dead end and a two-minute fix.
    publishState(languageId, {
      languageId,
      label: spec.label,
      status: "missing",
      detail: spec.installHint,
    });
    return null;
  }

  const launch = launchFor(resolved, spec.args, process.platform);

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(launch.file, [...launch.args], {
      cwd: workspaceRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    publishState(languageId, {
      languageId,
      label: spec.label,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const session: Session = {
    spec,
    child,
    pending: new Map(),
    open: new Map(),
    ready: false,
    nextId: 1,
  };

  sessions.set(languageId, session);
  publishState(languageId, { languageId, label: spec.label, status: "starting", detail: null });

  const reader = createMessageReader();
  child.stdout.on("data", (chunk: Buffer) => {
    for (const body of reader.push(new Uint8Array(chunk))) handleMessage(session, body);
  });

  // Read and discard: a full stderr pipe blocks the child, and a language server that
  // hangs at 40% of startup because nobody drained its logs is a very confusing bug.
  child.stderr.on("data", () => {});

  child.on("error", (error) => {
    sessions.delete(languageId);
    publishState(languageId, {
      languageId,
      label: spec.label,
      status: "failed",
      detail: error.message,
    });
  });

  child.on("exit", () => {
    sessions.delete(languageId);

    const count = (restarts.get(languageId) ?? 0) + 1;
    restarts.set(languageId, count);

    if (count > MAX_RESTARTS) {
      publishState(languageId, {
        languageId,
        label: spec.label,
        status: "failed",
        detail: `Stopped responding ${count} times, so ADCode has given up on it.`,
      });
      return;
    }

    publishState(languageId, {
      languageId,
      label: spec.label,
      status: "failed",
      detail: "Stopped unexpectedly. It will restart when you next edit this kind of file.",
    });
  });

  void handshake(session, languageId);
  return session;
}

async function handshake(session: Session, languageId: string): Promise<void> {
  const root = workspaceRoot;
  if (root === null) return;

  await ask(session, "initialize", initializeParams(root, process.pid));

  send(session, notification("initialized", {}));
  session.ready = true;

  publishState(languageId, {
    languageId,
    label: session.spec.label,
    status: "running",
    detail: null,
  });

  // Anything opened while the handshake was in flight. A server that never hears about a
  // document reports nothing for it, which looks exactly like a server that is not working.
  for (const [path, document] of session.open) {
    send(
      session,
      notification("textDocument/didOpen", didOpenParams(pathToUri(path), document.languageId, document.version, document.text)),
    );
  }
}

export function documentOpened(path: string, languageId: string, text: string): void {
  const session = startServerFor(languageId);
  if (session === null) return;

  session.open.set(path, { languageId, version: 1, text });
  if (!session.ready) return;

  send(
    session,
    notification("textDocument/didOpen", didOpenParams(pathToUri(path), languageId, 1, text)),
  );
}

export function documentChanged(path: string, languageId: string, text: string): void {
  const session = sessions.get(languageId);
  if (session === undefined) return;

  const document = session.open.get(path);
  if (document === undefined) {
    documentOpened(path, languageId, text);
    return;
  }

  document.version += 1;
  document.text = text;

  if (!session.ready) return;
  send(
    session,
    notification("textDocument/didChange", didChangeParams(pathToUri(path), document.version, text)),
  );
}

export function documentClosed(path: string, languageId: string): void {
  const session = sessions.get(languageId);
  if (session === undefined) return;

  session.open.delete(path);
  if (!session.ready) return;

  send(session, notification("textDocument/didClose", didCloseParams(pathToUri(path))));

  // The server will not publish an empty set for a document it no longer tracks, so the
  // panel would keep showing errors for a file the user closed.
  events?.onDiagnostics(path, []);
}

export async function completionAt(
  path: string,
  languageId: string,
  line: number,
  column: number,
): Promise<LspCompletionItem[]> {
  const session = sessions.get(languageId);
  if (session === undefined || !session.ready) return [];

  const result = await ask(
    session,
    "textDocument/completion",
    positionParams(pathToUri(path), line, column),
  );

  // The reply is either a bare list or `{ items }` depending on the server, and both are
  // valid. A client that handles only one of them works with half the ecosystem.
  if (Array.isArray(result)) return result as LspCompletionItem[];

  const items = (result as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as LspCompletionItem[]) : [];
}

/**
 * Reduce a server's completion to the fields the suggest widget reads.
 *
 * The reply is arbitrary JSON from a subprocess. Forwarding it whole would hand the
 * renderer a shape nothing has checked, which is exactly the posture §1 rules out - and
 * every field here is one the widget would otherwise read off an unvalidated object.
 *
 * `insertTextFormat: 2` is the protocol's "this is a snippet". Anything else is literal
 * text, and marking literal text as a snippet is how a completion containing `$` or `}`
 * silently loses characters on the way in.
 */
export function toWireCompletion(item: LspCompletionItem): LanguageCompletion | null {
  if (typeof item?.label !== "string" || item.label.length === 0) return null;

  const insert = item.textEdit?.newText ?? item.insertText ?? item.label;
  const documentation =
    typeof item.documentation === "string"
      ? item.documentation
      : typeof item.documentation?.value === "string"
        ? item.documentation.value
        : null;

  return {
    label: item.label,
    kind: typeof item.kind === "number" ? item.kind : null,
    detail: typeof item.detail === "string" ? item.detail : null,
    documentation,
    insertText: typeof insert === "string" ? insert : item.label,
    isSnippet: item.insertTextFormat === 2,
    sortText: typeof item.sortText === "string" ? item.sortText : null,
  };
}

export async function hoverAt(
  path: string,
  languageId: string,
  line: number,
  column: number,
): Promise<string | null> {
  const session = sessions.get(languageId);
  if (session === undefined || !session.ready) return null;

  const result = (await ask(
    session,
    "textDocument/hover",
    positionParams(pathToUri(path), line, column),
  )) as { contents?: unknown } | null;

  return readHoverContents(result?.contents);
}

/**
 * Hover contents have four shapes across three protocol versions, and servers in the wild
 * still send all of them.
 */
function readHoverContents(contents: unknown): string | null {
  if (typeof contents === "string") return contents.trim() === "" ? null : contents;

  if (Array.isArray(contents)) {
    const parts = contents.map((item) => readHoverContents(item)).filter((part) => part !== null);
    return parts.length === 0 ? null : parts.join("\n\n");
  }

  if (typeof contents === "object" && contents !== null) {
    const value = (contents as { value?: unknown }).value;
    if (typeof value === "string") return value.trim() === "" ? null : value;
  }

  return null;
}

export async function shutdownAllServers(): Promise<void> {
  const running = [...sessions.values()];
  sessions.clear();
  states.clear();
  restarts.clear();
  events?.onState([]);

  for (const session of running) {
    try {
      send(session, request(session.nextId, "shutdown", null));
      send(session, notification("exit", null));
    } catch {
      // Already gone.
    }

    // A server that ignores `exit` still has to stop: it holds an index of the workspace
    // the user has just closed, and on Windows it holds file handles that block a rename.
    setTimeout(() => {
      if (!session.child.killed) session.child.kill();
    }, 1000);
  }
}
