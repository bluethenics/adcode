#!/usr/bin/env node
/** Prepare reviewed source for a desktop release. Never commits, tags, pushes or publishes. */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { compareReleaseVersions, latestPublishedStableRelease, nextReleaseVersion, releaseChanges } from "../packages/release/src/releasePreparation.ts";

const root = process.cwd();
const args = process.argv.slice(2);
let write = false, offline = false, dryRun = false, requested;
try { for (let index = 0; index < args.length; index++) {
  const argument = args[index];
  if (argument === "--write") write = true;
  else if (argument === "--dry-run") dryRun = true;
  else if (argument === "--offline") offline = true;
  else if (argument === "--version" && args[index + 1] && !args[index + 1].startsWith("--")) requested = args[++index];
  else throw new Error(`Unknown or incomplete option: ${argument}`);
}
if (write && dryRun) throw new Error("Choose --write or --dry-run, not both.");
if (write && offline) throw new Error("--offline is preview-only. A written release must check origin for used versions.");
} catch (error) { console.error(error.message); process.exit(1); }
const git = (...parts) => execFileSync("git", parts, {
  cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000,
  env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
}).trim();
const json = path => JSON.parse(readFileSync(join(root, path), "utf8"));

async function main() {
  if (resolve(git("rev-parse", "--show-toplevel")) !== resolve(root)) throw new Error("Run release:prepare from the repository root.");
  const pkg = json("package.json"), desktop = json("apps/desktop/package.json");
  if (pkg.name !== "adcode" || desktop.name !== "@adcode/desktop") throw new Error("This is not the ADCode repository.");
  if (pkg.version !== desktop.version) throw new Error("Root and desktop package versions disagree. Reconcile them before releasing.");
  const dirty = git("status", "--porcelain", "--untracked-files=normal");
  if (write && dirty) throw new Error("The checkout has uncommitted changes. Commit the reviewed changes first, or use an isolated clean checkout. Nothing was written.");
  const localTags = git("tag", "--list").split("\n").filter(Boolean);
  let remoteTags = [], releaseTags = [], githubReleases = null;
  const remoteTagCommits = new Map();
  if (!offline) {
    try {
      for (const line of git("ls-remote", "--tags", "origin").split("\n")) {
        const match = /^([a-f\d]+)\s+refs\/tags\/([^\s^]+)(\^\{\})?$/.exec(line);
        if (!match) continue;
        // Annotated tags name a tag object; its peeled ref names the actual source.
        if (match[3] || !remoteTagCommits.has(match[2])) remoteTagCommits.set(match[2], match[1]);
      }
      remoteTags = [...remoteTagCommits.keys()];
    } catch { throw new Error("Could not check origin's release tags. Sign in to Git or restore connectivity; --offline is available for previews only."); }
    const remote = git("remote", "get-url", "origin");
    const github = /github\.com[:/]([^/]+)\/([^/\s]+)$/.exec(remote);
    if (github) {
      // A draft can reserve a version before GitHub creates its tag. Tag checks alone
      // would allow that version to be prepared again and fail only after a long build.
      try {
        const releases = JSON.parse(execFileSync("gh", ["release", "list", "--repo", `${github[1]}/${github[2].replace(/\.git$/, "")}`, "--json", "tagName,isDraft,isPrerelease,publishedAt", "--limit", "1000"], {
          cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000,
        }));
        if (!Array.isArray(releases) || releases.some(release => typeof release.tagName !== "string" || typeof release.isDraft !== "boolean" || typeof release.isPrerelease !== "boolean" || (release.publishedAt !== null && (typeof release.publishedAt !== "string" || !Number.isFinite(Date.parse(release.publishedAt)))))) throw new Error("Unexpected GitHub release metadata.");
        githubReleases = releases;
        releaseTags = releases.map(release => release.tagName);
      } catch { throw new Error("Could not check GitHub's published and draft release versions. Install GitHub CLI and run gh auth login; --offline is available for previews only."); }
    }
  }
  const version = nextReleaseVersion(pkg.version, [...localTags, ...remoteTags, ...releaseTags], requested);
  // A local tag can be behind origin. Refuse to infer a release from stale tag objects.
  if (remoteTags.some(tag => !localTags.includes(tag))) throw new Error("Origin has release tags not present locally. Run git fetch --tags before preparing a release.");
  for (const [tag, remoteCommit] of remoteTagCommits) {
    if (git("rev-parse", `${tag}^{}`) !== remoteCommit) throw new Error(`Local tag ${tag} disagrees with origin. Reconcile the tag before preparing a release; do not overwrite a published tag.`);
  }
  const stableTags = localTags.filter(tag => /^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag))
    .sort((a, b) => compareReleaseVersions(b.replace(/^v/, ""), a.replace(/^v/, "")));
  const latestTag = stableTags[0];
  // Keep the highest reserved tag's ancestry check even when that failed/draft build
  // is deliberately excluded from the published changelog baseline.
  if (latestTag) {
    try { git("merge-base", "--is-ancestor", latestTag, "HEAD"); }
    catch { throw new Error(`This checkout does not contain ${latestTag}. Merge the latest release before preparing another one.`); }
  }
  const publishedBase = githubReleases === null ? null : latestPublishedStableRelease(githubReleases);
  if (publishedBase !== null && !localTags.includes(publishedBase)) throw new Error(`Published release ${publishedBase} is missing locally. Run git fetch --tags before preparing a release.`);
  if (publishedBase !== null) {
    try { git("merge-base", "--is-ancestor", publishedBase, "HEAD"); }
    catch { throw new Error(`This checkout does not contain published release ${publishedBase}. Merge its source before preparing another one.`); }
  }
  const since = (githubReleases === null ? latestTag : publishedBase) ?? git("rev-list", "--max-parents=0", "HEAD").split("\n")[0];
  const baseStatus = githubReleases !== null ? publishedBase ? "published stable release" : "no published stable release; initial source" : offline ? "tag-based preview; published release status unverified" : "tag-based fallback for a non-GitHub origin; published release status unverified";
  const subjects = git("log", `${since}..HEAD`, "--no-merges", "--pretty=format:%s").split("\n").filter(Boolean);
  const changes = releaseChanges(subjects);
  if (changes.length === 0) throw new Error(`No feature, fix or performance commits since ${since}. Prepare a release after committing an improvement.`);
  const changelogPath = join(root, "CHANGELOG.md");
  const changelog = readFileSync(changelogPath, "utf8");
  if (new RegExp(`^## ${version.replaceAll(".", "\\.")}(?:\\s|$)`, "m").test(changelog)) throw new Error(`CHANGELOG.md already contains ${version}. Choose a fresh version.`);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const heading = /^## /m.exec(changelog);
  if (!heading) throw new Error("CHANGELOG.md has no release headings; add its introduction before preparing a release.");
  const section = `## ${version} — ${date}\n\n${changes.join("\n")}\n\n`;
  const updates = new Map();
  const updateVersion = path => {
    const original = readFileSync(join(root, path), "utf8");
    let replaced = false;
    const next = original.replace(/("version"\s*:\s*")([^"]+)(")/, (match, prefix, old, suffix) => {
      if (old !== pkg.version) throw new Error(`${path} has a mismatched version.`);
      replaced = true; return prefix + version + suffix;
    });
    if (!replaced) throw new Error(`${path} has no version.`);
    updates.set(path, { original, next });
  };
  updateVersion("package.json"); updateVersion("apps/desktop/package.json");
  if (existsSync(join(root, "package-lock.json"))) {
    const original = readFileSync(join(root, "package-lock.json"), "utf8");
    const lock = JSON.parse(original);
    if (lock.version !== pkg.version || lock.packages?.[""]?.version !== pkg.version) throw new Error("Root package-lock.json version disagrees with package.json.");
    // Root version fields occur before dependencies. Never replace dependency versions.
    let count = 0;
    const next = original.replace(/("version"\s*:\s*")([^"]+)(")/g, (match, prefix, old, suffix) => {
      if (count >= 2) return match;
      if (old !== pkg.version) throw new Error("Unexpected package-lock.json root version layout.");
      count++; return prefix + version + suffix;
    });
    if (count !== 2) throw new Error("Root package-lock.json is missing its version fields.");
    updates.set("package-lock.json", { original, next });
  }
  updates.set("CHANGELOG.md", { original: changelog, next: changelog.slice(0, heading.index) + section + changelog.slice(heading.index) });
  console.log(`${write ? "Preparing" : "Preview"}: ADCode ${pkg.version} → ${version}\nBase: ${since} (${baseStatus})\n${dirty ? "Preview includes committed source only; uncommitted changes will not ship.\n" : ""}`);
  console.log(section.trim());
  console.log(`\nFiles: ${[...updates.keys()].join(", ")}`);
  if (write) {
    const written = [];
    try {
      for (const [path, content] of updates) { writeFileSync(join(root, path), content.next); written.push(path); }
    } catch (error) {
      for (const path of written) writeFileSync(join(root, path), updates.get(path).original);
      throw error;
    }
    console.log(`\nPrepared locally. Review the changelog and run npm run verify plus desktop build/smoke.\nThen commit these files, create tag v${version}, and push the commit and tag to origin.\nCI builds and verifies a draft; publishing that draft delivers the update.`);
  } else console.log(`\nNo files changed. ${offline ? "Remote versions were not checked. " : ""}Use --write on a clean committed checkout to prepare this version.`);
}

await main().catch(error => { console.error(error.message); process.exitCode = 1; });
