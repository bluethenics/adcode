/** Stable desktop releases use a fresh semantic version, including multiple releases a day. */
export function releaseVersion(value: string): readonly [number, number, number] {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) throw new Error(`Use a stable version such as 2.4.1, not ${JSON.stringify(value)}.`);
  const parts = match.slice(1).map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error("Release version is too large.");
  return [parts[0]!, parts[1]!, parts[2]!];
}

export function compareReleaseVersions(left: string, right: string): number {
  const a = releaseVersion(left), b = releaseVersion(right);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index]! - b[index]!;
  return 0;
}

export interface GitHubReleaseMetadata {
  readonly tagName: string;
  readonly isDraft: boolean;
  readonly isPrerelease: boolean;
  readonly publishedAt: string | null;
}

/** A failed build's tag reserves its version, but does not mark its changes as shipped. */
export function latestPublishedStableRelease(releases: readonly GitHubReleaseMetadata[]): string | null {
  const published = releases.filter(release => release.isDraft === false && release.isPrerelease === false &&
    typeof release.publishedAt === "string" && Number.isFinite(Date.parse(release.publishedAt)) &&
    /^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(release.tagName));
  published.sort((left, right) => compareReleaseVersions(right.tagName.replace(/^v/, ""), left.tagName.replace(/^v/, "")) ||
    Date.parse(right.publishedAt!) - Date.parse(left.publishedAt!));
  return published[0]?.tagName ?? null;
}

export function nextReleaseVersion(current: string, tags: readonly string[], requested?: string): string {
  const [major, minor, patch] = releaseVersion(current);
  const existing = tags.map(tag => tag.startsWith("v") ? tag.slice(1) : tag)
    .filter(tag => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag));
  const newer = existing.find(tag => compareReleaseVersions(tag, current) > 0);
  if (newer) throw new Error(`This checkout is ${current}, but release ${newer} exists. Update your checkout before preparing a release.`);
  const version = requested ?? `${major}.${minor}.${patch + 1}`;
  releaseVersion(version);
  if (compareReleaseVersions(version, current) <= 0) throw new Error(`The release must be newer than ${current}.`);
  if (existing.includes(version)) throw new Error(`Release v${version} already exists. Use a new version.`);
  return version;
}

export function releaseChanges(subjects: readonly string[]): string[] {
  return [...new Set(subjects.flatMap(subject => {
    const match = /^(?:feat|fix|perf)(?:\([^)]+\))?!?:\s*(.+)$/.exec(subject);
    const text = match?.[1]?.trim();
    return text ? [`- ${text[0]!.toUpperCase()}${text.slice(1).replace(/\.$/, "")}.`] : [];
  }))];
}

export function changelogSection(changelog: string, version: string): string {
  const start = new RegExp(`^## ${version.replaceAll(".", "\\.")}(?:\\s|$)`, "m").exec(changelog);
  if (!start) throw new Error(`CHANGELOG.md has no section for ${version}.`);
  const after = changelog.slice(start.index);
  const next = /^## /m.exec(after.slice(start[0].length));
  return (next ? after.slice(0, start[0].length + next.index) : after).trim();
}
