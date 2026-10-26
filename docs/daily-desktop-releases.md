# Publishing ADCode improvements every day

You can publish whenever an improvement is ready, including more than once a day. Each release needs a new version: `2.4.1`, `2.4.2`, and so on. Publishing on a timer is unnecessary; the existing GitHub Actions workflow builds the installers after you push a version tag. [Standard GitHub-hosted builds in public repositories are free](https://docs.github.com/en/billing/concepts/product-billing/github-actions); no paid release service is added.

## Prepare a release

1. Commit the improvements you want to ship. Leave other work out of the release, using a clean branch or an isolated checkout. Fetch the latest tags with `git fetch origin --tags`. Have the free [GitHub CLI](https://cli.github.com/) installed and signed in (`gh auth login`) so preparation can also check draft versions that do not have a tag yet.
2. Preview the next patch release:

   ```sh
   npm run release:prepare -- --dry-run
   ```

   `--offline` also previews without network access. A preview never changes files or publishes anything. If your checkout has uncommitted work, the preview describes committed source only.
3. Prepare the files on a clean, committed checkout:

   ```sh
   npm run release:prepare -- --write
   ```

   This updates the root and desktop package versions, root lockfile version fields, and a changelog section from new `feat`, `fix`, and `perf` commits. It leaves the independently deployed website/cloud versions alone. Use `--version 2.5.0 --write` for a deliberate minor release. Used published/draft versions, a stale release checkout, missing remote tags, or uncommitted files stop preparation.
4. Review the generated changelog for accuracy. Run `npm run verify`, then `npm run desktop:build` and `node scripts/smoke.mjs` in the release checkout. Review the printed checks, not only the exit code. Keep the source commit and final test evidence together.
5. Commit the prepared files and push that commit and its matching tag. For example, after preparing `2.4.1`:

   ```sh
   git add package.json apps/desktop/package.json package-lock.json CHANGELOG.md
   git commit -m "chore: prepare ADCode 2.4.1"
   git tag v2.4.1
   git push origin HEAD
   git push origin v2.4.1
   ```

   Use the actual prepared version. Do not reuse a published tag or force-update it. These commands publish source and trigger the build; they do not publish an installer yet.

## Publish the verified draft

1. Open the [release workflow](https://github.com/bluethenics/adcode/actions/workflows/release.yml) and wait for required Windows and Linux builds. macOS remains optional and is not offered as a supported download yet.
2. The workflow verifies the source, package versions and changelog, then checks exact installer filenames, update manifest versions, each advertised file's size and SHA-512, and the Windows differential blockmap's structure and byte coverage. Missing or stale update files stop the release. Platform files transfer through a run-owned **temporary draft prerelease**, then all required outputs are verified together before the normal release draft is created. Ignore the temporary `ci-adcode-*` entries; they are removed after the run and never feed the stable updater. [GitHub Releases supports this binary distribution without Actions artifact storage](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases). Concurrent writes to the same final draft are serialized, and a draft cannot be replaced with installers built from a different commit.
3. Open the draft in [GitHub Releases](https://github.com/bluethenics/adcode/releases), inspect its notes and installer assets, and test the packaged installer. Signing status is stated in the release notes. Publishing unsigned Windows builds may show SmartScreen warnings; signing can be configured later without changing the release process. Never describe an unsigned build as signed.
4. Publish the draft as a normal stable release. Drafts and prereleases do not become the normal update channel. Existing installer users receive the new version through ADCode's background update check and its **Update now** notification. Use Help → Check for Updates to test immediately; automatic checks run shortly after launch and periodically while the app stays open.
5. In ADCode's admin **Releases** page, publish a matching release note when you want the in-app “What's New” and website release list to describe it. `npm run release-note -- --dry-run` previews a note from commits; the non-dry-run form creates an admin draft, never an announcement by itself. Store/portable installations use that published release list to discover a new version, so keep it in step with an actually available desktop release. Microsoft Store delivery still goes through Partner Center and its rollout process; portable users replace their portable copy from the official download page.

Repeat the same process for the next improvement. Releasing `2.4.2` later on the same day works just like releasing it tomorrow. No daily automation, surprise publication, or paid release service is required.

## If a release needs correction

Fix the problem and publish a higher patch version. The updater follows increasing versions and should not be asked to downgrade. Keep an already published release and its checksums immutable. You can rerun a failed build for the same draft only when it uses the same source commit; a changed source needs a new version.

The protocol and lifecycle behavior are documented in [electron-builder's auto-update documentation](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md) and [GitHub's workflow concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency). Microsoft Store timing and provider availability are separate from GitHub installer publication.
