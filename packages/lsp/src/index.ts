/**
 * @adcode/lsp - Language Server Protocol, as far as it can be taken without a subprocess.
 *
 * Framing, message building, position conversion, and the mapping into
 * `@adcode/diagnostics`. Everything here is a pure function of its arguments: no spawning,
 * no sockets, no disk. `apps/desktop/src/main/lsp.ts` owns all of that and calls in here.
 *
 * The split is not ceremony. The parts of a language client that actually break - byte
 * framing across chunk boundaries, zero-based to one-based conversion, URI encoding on
 * Windows - are all pure, and none of them can be exercised comfortably with a real server
 * attached. Keeping them here makes them testable in milliseconds and testable at all.
 */
export { createMessageReader, encodeMessage, type MessageReader } from "./framing.ts";

export {
  didChangeParams,
  didCloseParams,
  didOpenParams,
  initializeParams,
  notification,
  pathToUri,
  positionParams,
  request,
  severityFor,
  toDiagnostic,
  toEditorColumn,
  toEditorLine,
  toLspPosition,
  uriToPath,
  type LspCompletionItem,
  type LspDiagnostic,
  type LspPosition,
  type LspRange,
  type Notification,
  type Request,
} from "./protocol.ts";

export {
  SERVERS,
  languagesWithServers,
  parseCustomServers,
  resolveServer,
  serverFor,
  type ServerSpec,
} from "./servers.ts";
