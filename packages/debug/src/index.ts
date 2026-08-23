/**
 * Stopping a program in the middle and looking at it.
 *
 * Built on Node's inspector rather than the Debug Adapter Protocol, and that is a
 * deliberate trade. DAP is the conventional choice, and it would mean shipping or
 * downloading `js-debug` - an adapter binary - which is precisely the extension marketplace
 * this product does not have. Node's inspector speaks CDP and is already in every Node
 * install, so debugging JavaScript and TypeScript needs nothing fetched at all.
 *
 * The cost is honest and worth stating: this debugs what Node can debug. Python needs
 * `debugpy` installed, and where it is missing the editor says which program to install
 * rather than failing with a stack trace - the same shape as the language-server story.
 *
 * This package is pure. Sockets, child processes and request ids belong to the shell.
 */
export {
  describeValue,
  framesFrom,
  pauseReasonOf,
  propertiesFrom,
  scopesFrom,
} from "./inspector.ts";

export { fileUrlToPath, pathToFileUrl, samePath } from "./paths.ts";

export type {
  Breakpoint,
  DebugState,
  PauseReason,
  Scope,
  StackFrame,
  Variable,
} from "./types.ts";

/**
 * Languages this can debug, and what each one needs.
 *
 * Stated as data rather than scattered through the shell so the editor can answer "can you
 * debug this?" before offering a button that would fail.
 */
export interface DebugSupport {
  readonly languageId: string;
  /** The program that has to be present, or null when Node's own inspector is enough. */
  readonly requires: string | null;
  /** How to get it, for the message shown when it is missing. */
  readonly install: string | null;
}

const SUPPORTED = new Map<string, DebugSupport>(
  Object.entries({
    javascript: { languageId: "javascript", requires: null, install: null },
    typescript: { languageId: "typescript", requires: null, install: null },
    javascriptreact: { languageId: "javascriptreact", requires: null, install: null },
    typescriptreact: { languageId: "typescriptreact", requires: null, install: null },
    python: {
      languageId: "python",
      requires: "debugpy",
      install: "pip install debugpy",
    },
  }) as [string, DebugSupport][],
);

export function debugSupportFor(languageId: string): DebugSupport | null {
  return SUPPORTED.get(languageId) ?? null;
}
