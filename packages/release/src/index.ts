export interface Release {
  readonly version: string;
  readonly title: string;
  readonly body: string;
  readonly highlights: readonly string[];
  readonly announce: boolean;
  readonly critical: boolean;
  readonly publishedAt: number | null;
}

export interface Moment {
  readonly windowFocused: boolean;
  readonly typing: boolean;
  readonly commandRunning: boolean;
  readonly debugActive: boolean;
}

export interface AnnounceState {
  readonly releases: readonly Release[];
  readonly currentVersion: string;
  readonly seenVersions: ReadonlySet<string>;
  readonly hasRunBefore: boolean;
  readonly enabled: boolean;
  readonly moment: Moment;
}

export type AnnouncementDecision =
  | { readonly show: true; readonly release: Release }
  | {
      readonly show: false;
      readonly reason: "disabled" | "first-run" | "none" | "busy";
    };

const VERSION = /^[0-9A-Za-z.\-+]{1,32}$/;
const MAX_TITLE = 160;
const MAX_BODY = 40_000;
const MAX_HIGHLIGHTS = 6;
const MAX_HIGHLIGHT = 240;

function parseRelease(raw: unknown): Release | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const version = record["version"];
  const title = record["title"];
  const publishedAt = record["publishedAt"];

  if (typeof version !== "string" || !VERSION.test(version)) return null;
  if (typeof title !== "string" || title.length === 0 || title.length > MAX_TITLE) return null;
  if (
    publishedAt !== null &&
    (typeof publishedAt !== "number" || !Number.isFinite(publishedAt))
  ) {
    return null;
  }

  const body =
    typeof record["body"] === "string" ? record["body"].slice(0, MAX_BODY) : "";
  const highlights = Array.isArray(record["highlights"])
    ? record["highlights"]
        .filter((item): item is string => typeof item === "string" && item.length > 0)
        .slice(0, MAX_HIGHLIGHTS)
        .map((item) => item.slice(0, MAX_HIGHLIGHT))
    : [];

  return {
    version,
    title,
    body,
    highlights,
    announce: record["announce"] === true,
    critical: record["critical"] === true,
    publishedAt,
  };
}

export function parseReleaseList(raw: unknown): Release[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseRelease).filter((item): item is Release => item !== null);
}

type Version = readonly [major: number, minor: number, patch: number];

function versionOf(value: string): Version | null {
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(value);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersion(left: Version, right: Version): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function releasesInBuild(
  releases: readonly Release[],
  currentVersion: string,
): Release[] {
  const current = versionOf(currentVersion);
  if (current === null) return [];

  return releases
    .map((release) => ({ release, version: versionOf(release.version) }))
    .filter(
      (entry): entry is { release: Release; version: Version } =>
        entry.version !== null && compareVersion(entry.version, current) <= 0,
    )
    .sort((left, right) => compareVersion(right.version, left.version))
    .map((entry) => entry.release);
}

export function decideAnnouncement(state: AnnounceState): AnnouncementDecision {
  if (!state.enabled) return { show: false, reason: "disabled" };
  if (!state.hasRunBefore) return { show: false, reason: "first-run" };
  const release = releasesInBuild(state.releases, state.currentVersion).find(
    (item) => item.announce && !state.seenVersions.has(item.version),
  );
  if (release === undefined) return { show: false, reason: "none" };
  const busy =
    !state.moment.windowFocused ||
    state.moment.typing ||
    state.moment.commandRunning ||
    state.moment.debugActive;
  if (busy && !release.critical) return { show: false, reason: "busy" };
  return { show: true, release };
}

export function versionsToMarkSeen(state: AnnounceState, shown: Release): string[] {
  const shownVersion = versionOf(shown.version);
  if (shownVersion === null) return [];

  return releasesInBuild(state.releases, state.currentVersion)
    .filter((release) => {
      const version = versionOf(release.version);
      return (
        version !== null &&
        compareVersion(version, shownVersion) <= 0 &&
        !state.seenVersions.has(release.version)
      );
    })
    .map((release) => release.version);
}
