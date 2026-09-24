# ADCode release checklist

Give this file to an AI agent together with the intended source branch/commit, target version, release scope, and publication authorization. Work through the boxes in order and record evidence for each one. A passing build or a pushed tag is **not** a published release.

Current sources of truth: [desktop workflow](.github/workflows/release.yml), [package configuration](electron-builder.yml), [installer asset check](scripts/check-release-assets.mjs), [Windows installer](apps/web/public/install.ps1), [Linux installer](apps/web/public/install.sh), and [deployment setup](SETUP.md). Re-read them before each release; older notes under `docs/` may describe earlier deployment paths.

## 1. Choose the release input

- [ ] Check `git status --short --branch`, `git log -1 --oneline`, local tags, and the latest **published** GitHub release. Decide exactly which changes belong in this release. Preserve unrelated working-tree changes; use an isolated branch/worktree if the tree is dirty. Never tag uncommitted work or blindly stage every file.
- [ ] Choose `X.Y.Z` higher than the latest published version and verify that `vX.Y.Z` does not already exist. If a published release needs correction, create a new version and tag; do not rewrite its tag or assets.
- [ ] Review the current dated release-readiness report and any blockers relevant to the changed features. Confirm the required repository secret `ADCODE_GOOGLE_CLIENT_SECRET` exists without exposing its value. Check the workflow summary for whether Windows signing is configured; disclose unsigned installers accurately.
- [ ] Identify whether the change includes desktop, web/API, generated help docs, installer scripts, or ads/earnings. The GitHub desktop release workflow **does not deploy** the Cloudflare website/API.

## 2. Prepare one versioned source commit

- [ ] Set the same `X.Y.Z` in root `package.json`, root `package-lock.json` (both top-level version fields), `apps/desktop/package.json`, and `apps/web/package.json`. Keep the root lockfile consistent with the root manifest. This repository has no `apps/web/package-lock.json`; install dependencies at the root.
- [ ] Update `CHANGELOG.md` with the user-visible changes and known limitations. Review any product copy affected by the release. If help entries changed, run `node scripts/docs-seed.mjs`, include its generated `apps/web/src/lib/docsSeed.ts` and `docs/features/complete-feature-guide.md`, and check with `node scripts/docs-seed.mjs --check`.
- [ ] Review the exact source diff and run `git diff --check`. Commit only the intended release files. Verify all version fields and the release notes in the resulting commit. Do not include credentials, local `.env` files, generated installers, or unrelated changes.

## 3. Prove the candidate works

- [ ] From a clean checkout of that commit with Node 24, run `npm ci`, `npm run verify`, and `npm audit --omit=dev --audit-level=high`. Resolve failures rather than releasing around them. The workflow also runs these checks on Linux.
- [ ] Run `npm run desktop:build` and the relevant desktop smoke tests for the changed behavior. For an ads/earnings change, run `npm run smoke:ads` and inspect the live ad supply/API separately: a mock smoke pass cannot prove that a real user is eligible for a card or that inventory exists.
- [ ] If web/API changed, run `npm run web:build` and feature-specific checks. Test any migrations, secrets, or production compatibility needed by the new code before deployment.
- [ ] Test a packaged build or a pre-release workflow artifact on the supported platform when the change touches startup, sign-in, packaging, install, or updates. For Google sign-in, follow [the release sign-in check](docs/google-sign-in-release.md) on an installed build without development environment variables.

## 4. Create and inspect the desktop draft

- [ ] Push the reviewed source commit to the intended remote branch. Create `vX.Y.Z` **on that exact commit**, check that the tag version matches root `package.json`, then push the tag. Pushing a `v*` tag starts `.github/workflows/release.yml`. A manual `workflow_dispatch` run with `publish` off only saves temporary build artifacts; it does not create a draft.
- [ ] Wait for the version, verification, Windows, Linux, and release jobs to succeed. macOS is attempted but optional while it is advertised as coming soon. Diagnose a failed job from its log/annotations, fix the source, and use a fresh version/tag if the release was already published.
- [ ] Open the **draft** at `https://github.com/bluethenics/adcode/releases`. Check the tag target SHA, title, release notes, signing status, and assets. Windows needs `ADCode-Setup-x64.exe` (and normally `ADCode-Portable-x64.exe`); Linux needs `ADCode-x86_64.AppImage` and `ADCode-amd64.deb`. Require `latest.yml`, `latest-linux.yml`, and the blockmaps/checksums generated for those artifacts. `scripts/check-release-assets.mjs` checks required installer names but does not replace this manifest review. macOS remains unsupported until signing/notarization and its installer path and site copy are updated.
- [ ] Confirm the installers and update manifests all describe `X.Y.Z`, the installer commands still target `bluethenics/adcode`, and the draft contains no stray or stale assets. Have the release owner review the concrete draft and publish it when publication is authorized. A draft is invisible to `releases/latest` and cannot update existing installs.

Typical release commands after replacing the placeholders and finishing the prior checks:

```sh
git tag -a vX.Y.Z <reviewed-commit-sha> -m "ADCode X.Y.Z"
git push origin vX.Y.Z
# After the workflow succeeds and the concrete draft is approved:
gh release edit vX.Y.Z --draft=false
```

## 5. Verify the public release, not just the workflow

- [ ] Confirm `https://api.github.com/repos/bluethenics/adcode/releases/latest` returns `vX.Y.Z` with `draft: false`, and `https://github.com/bluethenics/adcode/releases/tag/vX.Y.Z` is public. Check the Windows/Linux asset URLs and both `latest.yml` and `latest-linux.yml` return files, with correct filenames, sizes, versions, and hashes. The Windows terminal installer also requires GitHub's SHA-256 asset digest; the Linux script checks SHA-512 in `latest-linux.yml`.
- [ ] Exercise a **fresh install** through the published Windows or Linux install command on an appropriate test machine, and check that the launched app reports `X.Y.Z`. Do not run a public install script blindly on a development machine containing a version under test.
- [ ] Exercise an **old installed non-Store build**: check its actual installed version, trigger *Check for Updates*, allow the download, close the app, relaunch, and verify it now reports `X.Y.Z`. The updater starts automatically after about 45 seconds and retries every six hours; it installs on app quit, not immediately. If an old UI incorrectly says “latest,” compare its actual version with the public update manifest and test the upgrade path directly. Store builds use Store updates and are outside this GitHub updater test.
- [ ] If web/API changed, deploy that reviewed source through `npm run web:deploy` using the configured Cloudflare account, sequencing it with the desktop release according to compatibility. Verify `https://adcode.bluethenics.com/v1/health`, affected site pages, and affected API behavior. Desktop tag publication alone does not do this. If the release changes ad serving, validate the production ad decision and card flow with an eligible test account; “No card available” may indicate no inventory and is not proof that delivery works.
- [ ] If the public `/versions` page should show release notes, draft the note with `npm run release-note -- --dry-run`, then use the admin release-note flow described by `scripts/release-note.mjs` and publish the note separately. GitHub release notes do not automatically populate `/versions`; it reads `/v1/releases`. Verify the public page after its cache refresh.
- [ ] Report the public release URL, commit SHA, platform assets, test results, signing status, website/API deployment result if applicable, and any remaining limitations. Mark the release complete only when the public download and appropriate update path actually work.
