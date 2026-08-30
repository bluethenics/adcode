/**
 * The explanation layer.
 *
 * One entry per feature, rendered by three different surfaces: the `?` popover on every
 * settings row, the in-app guide, and the website's docs pages. Writing the text three
 * times was the alternative, and three copies drift apart the first time a feature
 * changes - which is exactly when being wrong matters most.
 *
 * Plain TypeScript. No DOM, no Electron, no I/O.
 */
import { HELP_ENTRIES } from "./entries/index.ts";
import type { HelpEntry, HelpGroupId } from "./types.ts";

export { HELP_ENTRIES };
export { FEATURE_COMMANDS, featureFor, featureRecords, searchFeatures } from "./features.ts";
export type {
  FeatureAction,
  FeatureCommandAction,
  FeatureRecord,
  FeatureSettingAction,
  FeatureToggleAction,
  HelpEntry,
  HelpGroupId,
} from "./types.ts";

const BY_ID = new Map<string, HelpEntry>(HELP_ENTRIES.map((entry) => [entry.id, entry]));

/**
 * Settings id to entry.
 *
 * A map rather than a scan because the settings screen asks this once per row, and one
 * row asking is fifty-five rows asking.
 */
const BY_SETTING = ((): ReadonlyMap<string, HelpEntry> => {
  const map = new Map<string, HelpEntry>();
  for (const entry of HELP_ENTRIES) {
    for (const settingId of entry.settingIds) {
      // First entry wins. Two entries naming the same setting is a catalogue bug the test
      // catches; picking deterministically here means the UI does not also misbehave.
      if (!map.has(settingId)) map.set(settingId, entry);
    }
  }
  return map;
})();

export function helpFor(id: string): HelpEntry | undefined {
  return BY_ID.get(id);
}

export function helpForSetting(settingId: string): HelpEntry | undefined {
  return BY_SETTING.get(settingId);
}

export function helpForGroup(group: HelpGroupId): readonly HelpEntry[] {
  return HELP_ENTRIES.filter((entry) => entry.group === group);
}

/** The groups that actually have entries, in catalogue order. */
export function helpGroups(): readonly HelpGroupId[] {
  const seen: HelpGroupId[] = [];
  for (const entry of HELP_ENTRIES) {
    if (!seen.includes(entry.group)) seen.push(entry.group);
  }
  return seen;
}

/**
 * Search across every field a person might remember.
 *
 * Including `why` and `how`, not just the title - somebody looking for "the grey text that
 * guesses what I am typing" does not know it is called inline completion, and that phrase
 * is in `plain` rather than in the title. Searching only titles would fail the exact
 * person this catalogue exists for.
 */
export function searchHelp(query: string): readonly HelpEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return HELP_ENTRIES;

  return HELP_ENTRIES.filter((entry) => {
    const haystack =
      `${entry.id} ${entry.title} ${entry.plain} ${entry.why} ${entry.how}`.toLowerCase();
    return haystack.includes(needle);
  });
}

/** The entries `related` points at, skipping any that no longer exist. */
export function relatedTo(entry: HelpEntry): readonly HelpEntry[] {
  return entry.related
    .map((id) => BY_ID.get(id))
    .filter((found): found is HelpEntry => found !== undefined);
}
