import {
  searchFeatures,
  type FeatureAction,
  type FeatureRecord,
  type HelpGroupId,
} from "@adcode/help";

export type FeatureLibraryCategory = "all" | HelpGroupId;

export interface FeatureLibraryFilter {
  readonly category: FeatureLibraryCategory;
  readonly query: string;
}

export interface PresentedFeatureAction {
  readonly action: FeatureAction;
  readonly enabled: boolean;
}

export interface FeatureActionPresentation {
  readonly primary: PresentedFeatureAction | null;
  readonly secondary: readonly PresentedFeatureAction[];
  readonly disabledReason: string | null;
}

export function featureLibraryCategories(
  records: readonly FeatureRecord[],
): readonly FeatureLibraryCategory[] {
  const groups: HelpGroupId[] = [];
  for (const record of records) {
    if (!groups.includes(record.entry.group)) groups.push(record.entry.group);
  }
  return ["all", ...groups];
}

/** A query intentionally searches every group; choosing a chip clears it in the view. */
export function filterFeatureLibrary(
  records: readonly FeatureRecord[],
  filter: FeatureLibraryFilter,
): readonly FeatureRecord[] {
  if (filter.query.trim().length > 0) {
    const allowed = new Set(records.map((record) => record.entry.id));
    return searchFeatures(filter.query).filter((record) => allowed.has(record.entry.id));
  }
  if (filter.category === "all") return records;
  return records.filter((record) => record.entry.group === filter.category);
}

export function featureActionPresentation(
  feature: FeatureRecord,
  hasCommand: (command: string) => boolean,
): FeatureActionPresentation {
  const presented = feature.actions.map((action): PresentedFeatureAction => ({
    action,
    enabled: action.kind === "setting" || hasCommand(action.command),
  }));
  const availableAt = presented.findIndex((item) => item.enabled);
  const primaryAt = availableAt === -1 ? 0 : availableAt;
  const primary = presented[primaryAt] ?? null;

  return {
    primary,
    secondary: presented.filter((_, at) => at !== primaryAt),
    disabledReason:
      primary !== null && !primary.enabled
        ? "This feature is not available in this window."
        : null,
  };
}

export function moveFeatureSelection(current: number, delta: -1 | 1, length: number): number {
  if (length === 0) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return Math.max(0, Math.min(current + delta, length - 1));
}
