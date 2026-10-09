# Release plan: ADCode 2.1.2

The runbook an AI agent works through to take ADCode from 2.1.1 to 2.1.2. Prepared
2026-10-01 from `main` at `4025d4d` plus the `better-tools` branch at `bfa3039`.

**How to use it.** Work top to bottom. Tick each box, and write what proved it into the
**Release log** at the bottom: the command, the result, the commit SHA. Where a step says
**STOP**, ask Sinan in chat and wait for a clear yes. This plan is specific to 2.1.2. The
general procedure is [`RELEASE-CHECKLIST.md`](../RELEASE-CHECKLIST.md) and
[`docs/RELEASING.md`](RELEASING.md); where they disagree with this file, follow them and
note the disagreement in the log.

---

## 0. Before anything

### What the agent may and may not do

- **May, without asking:** read anything, run tests, builds and smoke runs, merge
  `better-tools` into `main` locally, write the changelog, bump versions, and make
  local commits.
- **STOP and ask Sinan first:**
  - pushing any branch or tag
  - publishing a GitHub release, or editing a published one
  - deploying `apps/web` (it also serves the live `/v1` ads and payments API)
  - clicking Publish in the site's admin panel
  - changing repository settings or secrets
  - deleting branches, worktrees or backups
  - installing a build over Sinan's own installed ADCode
- **Never:** rewrite a published tag or its assets, run `--no-verify`, stage the untracked
  `marketing/ad-*` folders (another session's video work), or describe the ChatGPT plan
  sign-in as part of this release (it is a separate project).

### This machine

- The repository is on a **FAT32 drive**, so it has no symlinks. Worktrees under
  `.claude/worktrees/` have no `node_modules`, and seven unit tests (`packages/ads` and
  `packages/collab` firewall tests, `apps/desktop/test/thirdPartyNotices.test.ts`) fail
  there for that reason alone. Run `verify` in the main checkout.
- **Do not run `npm ci` locally** unless Sinan agrees: it deletes `node_modules`, and
  reinstalling on this drive takes 30-70 minutes. CI runs the clean install on Linux.
- **Run builds and smoke one at a time**, never next to another ADCode Electron
  instance. Use your own ports: `ADCODE_SMOKE_PORT=9433` for `npm run smoke` and
  `ADCODE_AGENT_SMOKE_PORT=9461` for `npm run smoke:agent`. `smoke:ads` always uses 9334.
  Before running, check that no other session is running smoke. If a focus or timing
  check fails, re-run it alone before treating it as real.
- **Window focus decides some results.** Ad receipts need the ADCode window in front for
  four seconds. If the Claude app holds focus, `smoke:ads` fails `receiptReachedServer`,
  `balanceMoved` and `queuedCardArrives` on any build (seen on 2026-10-01 on both `main`
  and `better-tools`). See item 2B.
- **Other sessions commit to this repository.** Re-read `git log --oneline -5 main` right
  before every merge, tag and push. If `main` moved, ask Sinan which commit to release.
- **Escaping:** writing TypeScript through shell heredocs or JSON has corrupted `\n` and
  quotes here before. Edit source files with the editor tool.

---

## 1. Snapshot and scope

- [ ] Record the starting state:
  ```bash
  git status --short --branch
  git log --oneline -3 main
  git log --oneline -3 better-tools
  git tag --sort=-creatordate | head -3
  gh release list --repo bluethenics/adcode --limit 3
  ```
  Expect `main` at `4025d4d` (or later, if Sinan committed since), `better-tools` one commit
  ahead at `bfa3039`, `v2.1.1` as the latest published release, and no `v2.1.2` tag.
  Untracked `marketing/ad-*` folders and this file are expected; leave them alone.
- [ ] Confirm with `git branch --no-merged better-tools` that no other branch holds work
  this release would miss. If one does, STOP and ask whether it belongs in 2.1.2.
- [ ] Merge the release input into `main` (a fast-forward):
  ```bash
  git checkout main
  git merge --ff-only better-tools
  ```
  If it is not a fast-forward, `main` moved: STOP and ask Sinan.
- [ ] The scope of 2.1.2 is everything in `git log --oneline v2.1.1..main`. On 2026-10-01
  that was:
  - **Open source:** Apache-2.0 licence, NOTICE, trademark, contributing and security
    policies, CI for pull requests, licence notices in every installer, and Help > Open
    Source Licences. The website and Terms say ADCode is open source. Commits
    `107911b`..`7f69959`.
  - **Fixes:** the MCP server ships in installers and is copied to `~/.adcode/mcp`
    (`eb29489`). The connect command says it needs Node.js 22.13+ and checks for Node on
    Windows (`4025d4d`). Search, Ctrl+P and the AI tools skip `.claude/worktrees` and
    gitignored folders (`203c3f9`). AI sandboxes leave agent worktrees out (`ed02995`).
  - **Agent tools (`bfa3039`):**
    - `view_page`, the assistant's own browser.
    - `open_preview` with a page path that waits for the dev server.
    - An editable preview address bar.
    - `delete_file` and `move_file` with Undo.
    - Background commands, longer timeouts and real exit codes.
    - Upgrades to search, edit, read and fetch.
    - The `update_plan` checklist.
    - One mascot in the chat.
    - `/check` and the AI: Check My Running App command.
    - A fix for Windows commands that quote a path.
  - **Not app code:** marketing ad commits (`a211491`, `6a8ad87`) and website SEO work
    (`c31985d`, `2653081`). The website work ships only with a web deploy (step 8).

---

## 2. Close the open items

These were known on 2026-10-01. Do not bump the version until each one is fixed, or Sinan
has accepted it in writing in chat.

### 2A. The preview showed ADCode instead of the user's project

Sinan sent a screenshot (in the "Code cleanup and app testing" session): the live preview
showed **ADCode's own window instead of the shoe shop** the assistant was building. Nobody
has investigated it.

- [ ] Ask Sinan for the steps: which project, how ADCode was started (installed app, or
  `npm run dev` from the source), and whether it was the chat's preview card or the
  floating preview.
- [ ] Reproduce it with the built app. Make a small Vite project in a temp folder (a "shoe
  shop" page), open it, start the preview, and ask the assistant to open a page.
- [ ] Hypothesis worth checking first (unconfirmed): the project's dev server announces
  `http://localhost:5173/`, but something else answers on the other IP version of that
  port. One candidate is ADCode's own electron-vite dev renderer when ADCode runs via
  `npm run dev`. Chromium tries `[::1]` first. Check with
  `netstat -ano | findstr :5173`, and compare `curl http://127.0.0.1:5173/` with
  `curl http://[::1]:5173/`.
  - Relevant code: `apps/desktop/src/main/devServer.ts` (`parseServerUrl`), `preview.ts`,
    `aiPreview.ts`, `renderer/ai/chatPreview.ts` and `renderer/preview/previewPane.ts`.
- [ ] Fix it, with a test, if it is real. **Pass:** both the chat card and the floating
  preview show the project's page, and a `view_page` report's title is the project's
  title.

### 2B. Ad receipts are unproven on this code

- [ ] Ask Sinan to run `npm run smoke:ads` himself, or to keep hands off the machine for
  about three minutes while it runs, with the ADCode window in front.
- [ ] **Pass:** every check is `true`, including `receiptReachedServer`, `balanceMoved` and
  `queuedCardArrives`. If those three fail while the window really had focus, it is a
  regression since 2.1.1, and the release stops. Bisect with `git bisect` over
  `v2.1.1..main`, looking first at commits touching `apps/desktop/src/main/ads*.ts`,
  `adRuntime.ts` and `packages/ads/`. `bfa3039` changed only which window gets an ad card:
  it excludes the assistant's offscreen browser.

### 2C. No installer has been built from this code

- [ ] Run `npm run desktop:build`, then `npm run package`. Output goes to `release/`.
- [ ] Without installing, check `release/win-unpacked/resources/`:
  - `mcp/adcode-mcp.js` and `mcp/package.json` exist.
  - `licenses/` holds the licence, NOTICE and third-party notices.
- [ ] Launch `release/win-unpacked/ADCode.exe` with a throwaway profile, and point ads at a
  dead port so no view can count:
  ```powershell
  $env:ADCODE_AD_SERVER = "http://127.0.0.1:9"
  & "release\win-unpacked\ADCode.exe" --user-data-dir="$env:TEMP\adcode-candidate-profile"
  ```
  **Pass:**
  - It starts.
  - Help > Open Source Licences lists the notices.
  - Settings > Connect an external agent hands out a command naming `~/.adcode/mcp`, and
    running that command with Node 22.13+ starts the server.
  - The Tools page shows 19 built-in tools.
  - `view_page` works in the packaged build: open a folder with an `index.html`, connect
    any model, and ask "look at the home page".
- [ ] Do not run the installer over Sinan's installed 2.1.1. It is needed in step 7 to test
  the update.

### 2D. Linux has not run this code

CI (`verify.yml`, Ubuntu, `xvfb-run -a npm run verify`) has never run on the 32 commits
since 2.1.1, because nothing is pushed. The new command runner has POSIX-only paths
(process groups, `/bin/sh`). The first CI run after the push in step 5 is the check. A red
run blocks the tag.

### Not a release gate

`scripts/smoke-editor-workspace.mjs`, the only runner of `smoke-ai-checks.mjs`, is stale
since the Vibe-first layout. It fails waiting for two editor tabs before any AI check runs.
`npm run smoke:agent` covers the assistant's tools instead. Leave it unless Sinan asks.

---

## 3. Make the release commit

- [ ] Set `2.1.2` in all five places:
  - root `package.json`
  - both top-level version fields of root `package-lock.json` (lines 3 and 9)
  - `apps/desktop/package.json`
  - `apps/web/package.json`
- [ ] Replace the `## Unreleased` section of `CHANGELOG.md` with a `## 2.1.2 — <date>`
  section. The draft below is ready to edit. Check every claim against the code before
  keeping it, and keep the file's style: plain words, what a user notices.

  ```markdown
  ## 2.1.2 — YYYY-MM-DD

  - ADCode is open source under the Apache License 2.0. The repository has a licence, a
    notice, a trademark policy, a contributing guide, a security policy and CI for pull
    requests.
  - Help > Open Source Licences shows ADCode's licence, its notice and the licence of every
    package built into it. Installers carry the same files under `resources/licenses`.
  - The website's terms now say the source code is governed by the Apache licence, and no
    longer describe a revocable licence or forbid resale of the code.
  - The assistant sees the app you are building. It opens any page of your live preview in
    a browser of its own, clicks and types through it, and reads the console, failed
    requests, broken images and the layout at phone width - with a screenshot - before it
    says a page works. Its latest look appears in the chat under What the assistant saw.
    Type /check, or run AI: Check My Running App, to have it look over the app and fix
    what is broken.
  - "Open the about page" opens the about page: the assistant's preview goes to the page
    it names, waits for a framework's dev server to start, and an open preview window
    follows. The preview's address bar takes a path - type /about.html and press Enter.
  - The assistant can delete, move and rename files, and Undo puts them back, images
    included. Dev servers and watchers keep running in the background while it works.
    Commands may run for up to ten minutes and report their real exit code, and Stop ends
    a command and everything it started.
  - For bigger jobs the assistant keeps a Plan checklist in the chat. Its search shows the
    lines around each match, its edits survive an indentation mismatch, it can look at
    images in your project, and documentation it reads arrives as clean text.
  - One mascot in the chat - the one at work. Finished steps show a small check instead of
    a copy each.
  - Commands the assistant runs on Windows now work when they quote a path with a space in
    it.
  - Connect an external agent works in installed builds: the project-memory server ships
    with the installer and is copied to ~/.adcode/mcp, so its command survives updates. The
    command says it needs Node.js 22.13 or newer, and on Windows ADCode says when Node is
    missing or too old.
  - Search, Ctrl+P and the assistant's file tools skip agent worktrees (.claude/worktrees)
    and folders your .gitignore leaves out, and an AI task's private copy no longer carries
    those worktrees.

  Known limitations: macOS builds remain unsupported, and the portable build still does not
  update itself. The assistant deletes and moves files only when AI edits apply
  automatically; in review mode it says what to move instead.
  ```

  Add any fix from step 2A to the list.
- [ ] Run `node scripts/docs-seed.mjs --check`. If it reports stale output, run
  `node scripts/docs-seed.mjs` and include the regenerated files.
- [ ] Run `git diff --check`, review `git diff --stat`, and commit only the release files
  (versions, changelog, any 2A fix, and this plan with its log). Use the message
  `release: 2.1.2 - <one line>` and the usual co-author line. Record the SHA.

---

## 4. Prove the candidate

Run in the main checkout, one at a time, and record each result in the log.

- [ ] `npm run verify`: typecheck, firewall and every test. Expect about 3,850 tests, all
  passing.
- [ ] `npm audit --omit=dev --audit-level=high`: no high or critical findings. If there
  are any, STOP and show Sinan.
- [ ] `npm run desktop:build`.
- [ ] `ADCODE_SMOKE_PORT=9433 npm run smoke`: exit 0, about 195 checks printed, none
  `false`. A check missing compared with the last run means an aborted block, not a pass.
- [ ] `ADCODE_AGENT_SMOKE_PORT=9461 npm run smoke:agent`: prints `agentToolsEvidence`
  with every value `true`, `mostMascotsWhileWorking: 1` and `mascotsAfter: 0`.
- [ ] `npm run smoke:ads`, focused, as in 2B: every check `true`.
- [ ] `npm run web:build` succeeds.
- [ ] The installer checks in 2C pass on a package built from **this** commit.

---

## 5. Sinan's decisions, then push

**STOP.** Show Sinan the release log so far and ask for each of these:

- [ ] Approval of the release scope and the changelog text.
- [ ] Open source:
  - Confirm the rewritten "Using the editor" section of the website Terms.
  - Confirm the copyright line `Copyright 2026 Bluethenics`.
  - Turn on private vulnerability reporting (GitHub, Settings > Security). This is his
    action.
- [ ] Permission to push `main`. The repository is public, and this push is also what
  makes the Apache licence visible on GitHub. Re-read `git log --oneline -3 main` first.
- [ ] After the push, check the `verify` workflow run on Ubuntu:
  `gh run list --repo bluethenics/adcode --limit 3`, then
  `gh run view <id> --log-failed` if it failed. It must be green (item 2D).

---

## 6. Tag and inspect the draft

- [ ] Confirm the release secrets exist without reading their values:
  `gh secret list --repo bluethenics/adcode` must list `ADCODE_GOOGLE_CLIENT_SECRET`
  (the release build fails without it). Note whether `CSC_LINK` or the Azure signing
  secrets exist; if not, the Windows installer is unsigned and the release notes must say
  so honestly.
- [ ] **STOP:** ask Sinan for permission to tag. Then:
  ```bash
  git tag -a v2.1.2 <release-commit-sha> -m "ADCode 2.1.2"
  git push origin v2.1.2
  ```
- [ ] The `release` workflow runs. Wait for the `version`, `verify`, `build` (Windows,
  Linux; macOS optional) and `release` jobs to succeed. If one fails, read its log, fix the
  source, and start again from step 3 with the same version only if nothing was published.
- [ ] Open the **draft** at https://github.com/bluethenics/adcode/releases and check:
  - The tag points at the release commit.
  - Assets: `ADCode-Setup-x64.exe`, `ADCode-Portable-x64.exe`,
    `ADCode-x86_64.AppImage`, `ADCode-amd64.deb`, `latest.yml`, `latest-linux.yml`, and
    their blockmaps.
  - Every manifest says `2.1.2`.
  - There are no stray assets.

---

## 7. Publish and prove the public release

- [ ] **STOP:** Sinan reviews the draft and publishes it, or tells you to run
  `gh release edit v2.1.2 --draft=false`.
- [ ] `https://api.github.com/repos/bluethenics/adcode/releases/latest` returns `v2.1.2`
  with `draft: false`. `https://adcode.bluethenics.com/dl/windows` serves the new
  installer.
- [ ] **Update test, 2.1.1 to 2.1.2,** on Sinan's installed copy. This needs his yes,
  because it updates his real install. Use the method proven for 2.1.0 and 2.1.1:
  1. Launch with ads pointed at a dead port, so nothing counts against the production
     API:
     ```powershell
     $env:ADCODE_AD_SERVER = "http://127.0.0.1:9"
     Start-Process "$env:LOCALAPPDATA\Programs\ADCode\ADCode.exe"
     ```
  2. Within about 10 seconds the updater checks for updates. Watch
     `%LOCALAPPDATA%\@adcodedesktop-updater\pending\`:
     - The temp installer grows while it downloads.
     - `update-info.json` appears when the download is done.
     - A temp file that climbs to about 115 MB and then restarts means the differential
       download failed and it fell back to the full download.
  3. The status bar reads Restart to update. Quit normally with `taskkill /PID <pid>`,
     **without** `/F`.
  4. Within 15-60 seconds the version in
     `%LOCALAPPDATA%\Programs\ADCode\resources\app.asar` becomes 2.1.2. Relaunch and
     confirm Help > About ADCode says 2.1.2.
  5. Evidence of each step is in `%APPDATA%\@adcode\desktop\logs\debug.log`, source
     `updater`.
- [ ] Only if Sinan has a spare machine or VM: a fresh install through the published
  install command.

---

## 8. Website, release note, and announcements

The desktop release does not deploy the site. The site carries the open-source pages, the
new docs for The assistant sees your app and What the assistant can do, and the SEO work.

- [ ] Build and check: `npm run web:build`, then
  `cd apps/web && npx opennextjs-cloudflare build`. Note the live version for rollback with
  `npx wrangler deployments list`.
- [ ] **STOP:** give Sinan the command to run himself:
  `cd apps/web && npx opennextjs-cloudflare deploy`. Agent deploys are blocked by
  policy.
- [ ] After he deploys:
  - `https://adcode.bluethenics.com/v1/health` answers.
  - `/docs` has the two new guides.
  - `/versions` and the Terms page are correct.
  - Run `node scripts/submit-indexnow.mjs`.
- [ ] Release note for `/versions`: run `npm run release-note -- --dry-run` and show
  Sinan the text. Creating the real draft needs `ADCODE_AGENT_TOKEN`; Sinan clicks Publish
  in the admin panel (`/admin/content?tab=releases`).
- [ ] If Sinan will advertise this release: re-render the Payback ad's end card with
  `node marketing/ad-payback/render.mjs --version 2.1.2`, then run
  `node marketing/ad-payback/verify.mjs`.

---

## 9. Close out

- [ ] Report to Sinan:
  - the public release URL and the release commit SHA
  - the assets
  - signing status
  - test results: verify, smoke, smoke:agent, smoke:ads, the installer check and the
    update test
  - the website deploy result
  - what stayed open
- [ ] Ask Sinan before removing the `better-tools` worktree. It is merged by then. Archive
  its session in the Claude app first, then run `git worktree prune`.

---

## Release log

Fill in as you go. One line per box: what ran, what it showed, the SHA.

| Step | Result | Evidence |
|---|---|---|
| 1 Snapshot | | |
| 1 Merge better-tools | | |
| 2A Preview bug | | |
| 2B Ad receipts | | |
| 2C Installer | | |
| 3 Release commit | | |
| 4 verify / audit | | |
| 4 smoke / smoke:agent / smoke:ads | | |
| 5 Decisions and push, CI | | |
| 6 Tag, workflow, draft | | |
| 7 Publish, update test | | |
| 8 Website, release note | | |
