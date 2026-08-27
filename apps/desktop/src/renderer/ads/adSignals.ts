/**
 * What the workbench tells the ad client about itself.
 *
 * Pulled out of `main.ts` for the same reason `languageIds.ts` was pulled out of
 * `editorHost.ts`: this is a decision worth testing, and `main.ts` cannot be imported
 * without a DOM. This file imports nothing that needs a window.
 *
 * The privacy rule this has to keep is §8.2's: the tagger sees basenames, never paths.
 * That rule is enforced again inside the tagger, but it is enforced *here* too, because
 * the wrong place to first notice a leaked directory name is on the far side of an IPC
 * boundary.
 */
import type { AdSignals, ThemeChoice } from "../../shared/api.ts";
import { languageForFilename } from "../editor/languageIds.ts";

/**
 * A ceiling on how many names travel.
 *
 * The tagger keeps at most eight tags and a workspace root rarely has more than a few
 * dozen files, so this is not a targeting limit - it is a limit on how large a message a
 * pathological directory can push through IPC on every tab switch.
 */
const MAX_FILENAMES = 64;

export interface AdSignalsInput {
  readonly theme: ThemeChoice;
  /** Basenames of the open editors, in tab order. */
  readonly openNames: readonly string[];
  /** Names of the files directly at the workspace root, already listed by the workbench. */
  readonly rootFileNames: readonly string[];
}

/**
 * Everything after the last separator.
 *
 * Defensive: callers pass basenames already, and a future one that passes a path should
 * lose the directory here rather than send it.
 */
function basename(value: string): string {
  return value.split(/[\\/]/).pop() ?? value;
}

/**
 * Three themes become two.
 *
 * Midnight is a dark theme. The only thing this value decides is which of an advertiser's
 * two logos is fetched, and there is no third artwork to choose.
 */
export function themeKindOf(theme: ThemeChoice): "light" | "dark" {
  return theme === "light" ? "light" : "dark";
}

export function buildAdSignals(input: AdSignalsInput): AdSignals {
  const filenames: string[] = [];
  const seen = new Set<string>();

  // Open editors first, then the root manifests. Order matters only because of the cap,
  // and what the user has open is a better signal than what happens to sit in the folder.
  for (const raw of [...input.openNames, ...input.rootFileNames]) {
    if (typeof raw !== "string") continue;

    const name = basename(raw);
    if (name.length === 0 || seen.has(name)) continue;

    seen.add(name);
    filenames.push(name);
    if (filenames.length >= MAX_FILENAMES) break;
  }

  const languageIds: string[] = [];
  const languages = new Set<string>();

  for (const raw of input.openNames) {
    if (typeof raw !== "string") continue;

    const id = languageForFilename(basename(raw));
    // `plaintext` is what an unrecognised file lands on. It maps to no tag, so sending it
    // costs a wire byte and buys nothing.
    if (id === "plaintext" || languages.has(id)) continue;

    languages.add(id);
    languageIds.push(id);
  }

  return { themeKind: themeKindOf(input.theme), languageIds, filenames };
}
