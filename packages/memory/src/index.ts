/**
 * Shared AI memory store.
 *
 * Brief §5.1: one local store, read and written by every AI the user works with - the
 * built-in chat, and any external CLI agent running in the terminal. "Switching models
 * does not reset what the machine knows about your project."
 *
 * §1: `packages/ads` may not import from here, and no memory content may reach any
 * `/v1/*` endpoint. The ad side promises that nothing from the user's code ever leaves
 * the machine; this package is full of exactly that, and the promise survives only if
 * the two can never touch. `.dependency-cruiser.cjs` enforces it.
 *
 * Nothing here syncs anywhere. There is no network in this package at all.
 */
export {
  MEMORY_KINDS,
  isValidName,
  normalizeName,
  relativePathFor,
  directoryFor,
  kindForDirectory,
} from "./names.ts";

export { parseMemory, serializeMemory, extractLinks } from "./frontmatter.ts";
export { renderMirror, renderProjectContext } from "./mirrors.ts";

export { createMemoryStore, type MemoryStore, type MemoryStoreDeps, type MemoryWriteInput } from "./store.ts";
export { createSearchIndex, type SearchIndex } from "./searchIndex.ts";

export {
  createNodeMemoryFileSystem,
  openNodeMemory,
  MEMORY_DIRECTORY,
  INDEX_FILENAME,
  type NodeMemory,
} from "./nodeStore.ts";

export { createMemoryMcpServer, SERVER_NAME, SERVER_VERSION, type MemoryMcpDeps } from "./mcp.ts";

export type {
  Clock,
  MemoryFileSystem,
  MemoryKind,
  MemoryRecord,
  MemorySummary,
  SearchHit,
} from "./types.ts";
