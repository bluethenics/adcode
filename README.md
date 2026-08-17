# ADCode

An ad-supported, AI-native IDE. See `2026-08-15-scratch-ide-build-prompt.md` for the brief.

**Status: the editor is real.** It opens folders, edits in Monaco, runs several terminals,
stages and commits, searches and replaces across a workspace, talks to four AI providers,
remembers what you were doing, and installs as a Windows app. Language intelligence (LSP,
DAP) and the whole advertiser-facing platform are not built.

```
npm install
npm start               # build if needed, then launch
npm run package         # installer + portable .exe into release/

npm run verify          # typecheck + architecture rules + full suite (740 tests)
npm run smoke           # launch the built app and drive it (48 checks)
npm run icons           # rasterise build/icon.svg into icon.ico and icon.png
npm run dev             # electron-vite dev server, with hot reload
npm run mock-server     # ad serving contract on :8787, no build step
```

> After `npm install`, npm's allow-scripts policy blocks install scripts. Electron's
> binary, node-pty's prebuilds, and esbuild all need theirs:
> `npm approve-scripts electron node-pty esbuild`. If `node_modules/electron/dist` is
> still missing, run `node node_modules/electron/install.js`.

## What exists

| Path | State |
|---|---|
| `packages/ads` | All twelve modules from brief §8. 194 tests. |
| `packages/git` | init, clone, status, stage, commit, push, pull, branches, blame, line changes, conflicts, commit detail, per-file restore. 136 tests. |
| `packages/search` | Fuzzy file ranking and workspace search/replace. 57 tests. |
| `packages/memory` | Shared memory store, frontmatter, mirrors, FTS index, MCP server. 116 tests. |
| `packages/settings` | 44 settings across 9 groups. 61 tests. |
| `packages/ai` | Completion state machine, diff review, agent loop, four providers. 70 tests. |
| `mock-server` | All four `/v1/*` endpoints, an asset host, fault injection. 21 tests. |
| `apps/desktop` | The shell: menu bar, command palette, tabs, tree with right-click actions and drag-and-drop, git and search panels, commit browser, multi-terminal, settings, chat, session restore. |

**Not built:** the Language group (LSP client, DAP client, tree-sitter), and the Navigation
rows that depend on it — symbol search, go-to-definition, breadcrumbs, outline. Nothing on
the advertiser side exists yet: no backend, portal, landing page, or payments.

Settings for unbuilt features are shown with an `available: false` flag rather than hidden,
so the roster stays honest about what the toggle would do.

Design decisions and the nine documented deviations from the brief are in
`docs/specs/2026-08-16-ad-core-design.md`. The build order is in
`docs/plans/2026-08-16-ad-core.md`.

## The three rules that shape this codebase

**The firewall.** `packages/ads` may never import from `packages/memory` or `packages/ai`,
in either direction. The ad side promises that nothing from the user's code leaves the
machine; the AI and memory sides are full of exactly that. `.dependency-cruiser.cjs`
enforces it, and `test/firewall.test.ts` asserts both that the rule passes on the real tree
*and* that a planted violation makes it fire — a guard that has never been seen to fire is
not known to work. Per brief §11 this failing is a release blocker.

**Money is `bigint`.** All monetary values are int64 micros of USD, formatted with integer
arithmetic only, and carried on the wire as decimal strings. A JavaScript `number` is a
float; it happens to be exact below 2⁵³, but a revenue-share ledger is not the place to rely
on "happens to be".

**A green suite is not a working app.** `npm run smoke` launches the built binary, attaches
over CDP, and drives the real thing: it opens menus, starts terminals, runs `git blame`
through the IPC bridge, creates and renames and deletes files in a scratch folder, and fails
on any console error. It has already caught four bugs that a clean typecheck, a successful
build, and the whole unit suite all missed — a bundled `node-pty` that broke every terminal,
a hidden overlay that made the window unclickable, a menu bar that was dead to a real mouse,
and a dropdown that opened behind the sidebar.
`npm run smoke -- --packaged` runs the same checks against the installer's output.

**Drive at coordinates, not at nodes.** The menu bar shipped completely unclickable while its
check stayed green, because the check called `element.click()` — which dispatches straight at
a node and so cannot see that a `-webkit-app-region: drag` region was swallowing every real
press before the renderer got it. Smoke now clicks real coordinates through CDP's Input
domain, and asserts the geometry that CDP *cannot* reach: no drag region may overlap a menu
button, and an open menu must be the topmost thing at its own centre.

## Architecture

`packages/*` is plain TypeScript — no Electron, Monaco, or DOM imports — which is what
makes the logic testable in milliseconds before a window exists.

- **Five pure modules** in `ads` (`scheduler`, `validation`, `tagger`, `ledger`,
  `sponsorsView`) import only `types.ts` or one another. Enforced twice: dependency-cruiser
  proves what they import, and `test/purity.test.ts` reads their source to prove they never
  reach for `Date`, `Math.random`, `process`, or `fetch` — which need no import at all.
- **I/O modules** receive every capability through a port, so the disk and the network are
  injected rather than imported.
- **`git` never touches a shell.** Every call is `execFile` with an argv array and
  `GIT_TERMINAL_PROMPT=0`; `ext::` transports, `--upload-pack=`, and leading-dash arguments
  are refused before they reach git.
- **The renderer is hostile by assumption** (§1). Every IPC handler validates its own
  arguments, because "the preload only sends well-formed messages" is not a safety property
  when a compromised renderer can call `ipcRenderer` directly.

The mock server shares **no types** with the client. A mock built on the client's own
definitions cannot catch a contract mismatch, which is the main thing it exists to do.

The menu bar is drawn in-window rather than by the OS, because the shell uses a hidden title
bar and a native menu has nowhere to live under one. `shared/menuModel.ts` is the single
definition; macOS builds a native menu from it, Windows and Linux draw their own, and both
resolve the same command ids as the keyboard and the palette.

## Known constraints

- **This repo is on a FAT32 volume**, which has no symlinks, so npm workspaces cannot be
  used (`EISDIR` on install). Package boundaries are enforced by dependency-cruiser and
  tsconfig paths instead. Moving to NTFS would remove this entirely.
- **The installer is unsigned.** SmartScreen will warn on first run until there is a
  certificate. A Windows OV/EV certificate needs organisation validation (1–3 weeks) and
  hardware-token storage; notarization needs an Apple Developer account and macOS hardware.
- **One window per process.** The workspace root is process-wide, so a second window would
  fight the first over which folder is open. "New Window" is deliberately absent from the
  File menu rather than present and broken.
