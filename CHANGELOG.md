# Changelog

All notable changes to ADCode. Dates are the date the version was prepared; a version is
only public once its installers are attached to a GitHub release.

## Unreleased

### Every feature answers

Merge-conflict resolution worked from the first release and could not be found. It drew
Keep yours, Keep theirs and Keep both over the markers in any conflicted file you opened,
and nothing in the window could tell you whether such a file existed - so the only trace of
the feature was a switch in Settings claiming it existed.

That was the default behaviour of the feature catalogue, not one oversight: it built each
feature's actions from an eighteen-entry table and auto-generated "Open X setting" for
everything else, leaving sixty-eight of eighty-six features with one route into themselves.

- Eleven checks can now be asked for, from a button or a menu, and each one answers when it
  finds nothing: merge conflicts, blame, file timeline, local history, unsaved-work
  recovery, updates, organize imports, TODOs and FIXMEs, spelling in comments, unused CSS
  rules, and classes nothing defines.
- **Check Conflicts** joins Pull, Push and Fetch in the Source Control panel. It lists the
  files where both sides changed the same lines, and says "No merge conflicts" when there
  are none.
- Choosing a switch in the feature library now flips it where you found it and says which
  way it went, instead of navigating to the Settings row.
- Local file history and the update check were unreachable rather than merely hidden: their
  main-process code, IPC channels and preload bindings were complete and no renderer line
  called any of them.

### The website

- Eight written articles were reachable only through URLs that redirected to the homepage
  after the single-page restructure. They are filed under the documentation - Start here,
  How ADCode works, Earning and advertising, Comparisons - so each has a URL that resolves,
  its own metadata and a sitemap entry.
- `llms.txt`, `llms-full.txt` and `feed.xml` no longer advertise retired routes.
- The homepage prints the questions it has always been able to answer, and publishes the
  matching FAQ structured data from the same source.

## 1.0.0 — 2026-08-30

The first release. Everything below is in the box on first launch — ADCode has no extension
marketplace, so nothing here needs installing.

### The editor

- Monaco with tree-sitter highlighting, minimap, sticky scroll and multiple cursors.
- Language servers for Python, Rust, Go, C/C++/Objective-C, Lua, Ruby, PHP, shell, YAML and
  Markdown, plus TypeScript and JavaScript through Monaco's own worker. A custom server can
  be added from settings as `languageId: command args`.
- Debugging over the Debug Adapter Protocol, with a debug console and variable inspection.
- Diagnostics inline on the line that caused them, and collected in a Problems panel.
- Format on save — the language server's answer wins, with a built-in formatter as the
  fallback when no server replies.
- Spell checking and comment tones over a single comment scanner.
- Breadcrumbs, a structure outline, symbol search, a project map, and search and replace
  across the whole folder.
- Path completion, automatic tag closing, paired tag renaming and TODO highlighting.
- Local history, so a file can be recovered after it was saved over.
- Git: status, stage, commit, push, pull, fetch, clone, branches, checkout, log, blame and
  diff, with a commit browser and blame shown in the gutter.
- An integrated terminal, a ports panel, a live preview with device sizes, and a run button
  that knows how to run the file you are looking at.
- Three themes — Light, Dark and Midnight — a theme picker, file icons, a draggable split
  layout, a command palette, and a menu bar with full keyboard mnemonics.

### Finding things

- Universal search in the title bar, over features, commands, files, symbols and recent
  folders, with explanations rather than bare matches.
- A feature library with What/Why/How help for every capability, reachable from the View
  menu and published as a generated guide on the website.
- `adcode open [path]` opens a folder or file from the terminal in a normal desktop session.

### AI

- Chat, inline edit and inline completion, with Model Context Protocol support.
- Isolated AI workspaces: file edits run in a sandbox, are checkpointed, and can be rolled
  back. Rollback refuses to overwrite later human edits rather than silently discarding them.
- Task budgets and retention limits, so an agent cannot run away with tokens or time.
- Team mode: several agents coordinated over a task graph with handoffs, shared budgets, and
  a review step before anything is merged.
- Scheduled messages and safe terminal continuation, both off by default.

### Collaboration

- Live shared editing over the local network, built on Yjs, with remote cursors.

### Ads and earnings

- Sponsored cards delivered by the ad service, with a cadence, a daily cap, a minimum gap, a
  60-second settle, and a remote kill switch.
- Receipts are written only after the card is actually painted, and earnings move on the
  receipt rather than the serve.
- Earnings, balance and the account's own id are visible in the workbench.
- Coding activity counts what you typed against what the agent wrote, and reports counts
  only — never file names, paths, languages, prompts or code.

### The platform

- Marketing site, docs, blog, user dashboard, advertiser portal and admin panel, all served
  from one Cloudflare Worker together with the API.
- Supabase Postgres holds every table, with the five money-critical operations as Postgres
  functions so nothing can half-apply.
- Firebase for authentication only, verified with Web Crypto.
- Admin panel over six destinations, with feedback triage, test ads, blog authoring and
  release note drafting.

### Money

- Advertiser funding through Dodo Payments, with credit orders and an append-only ledger.
- Withdrawals with five conditions checked on both the dashboard and the endpoint: $50
  minimum, a confirmed email, an account at least 7 days old, payout details on file, and no
  request already in progress.
- Payout corridors covering the destinations a normal Wise account can send to, each one
  disableable from the admin screen.
- Payouts are made by hand and recorded; nothing on an admin screen edits a number, because
  every change is a new ledger entry.

### Fixed on the way to 1.0.0

- **The cash-out path never worked.** The withdrawal functions named an `evidence` column
  that did not exist, so every payout request and every admin decision raised `42703`.
  PL/pgSQL does not resolve column names until the body runs, so both migrations applied
  cleanly and the fault only appeared when somebody asked to be paid.
- **All four payout corridors shipped disabled**, so no payout profile could ever be saved,
  so the "payout details on file" condition could never pass.
- **Advertiser credit status was computed from the wrong quantity** — an advertiser's total
  funded amount rather than the order's own entries — so a fully refunded order could stay
  marked paid, and `dispute-final` matched no branch at all.
- **Ad delivery had five defects behind green tests**: workspace signals and theme were never
  set, so every request went out untargeted; `debugActive` was pinned false; the balance and
  config were read only at start, so earnings never moved while the app was open; prefetch
  refused to refetch while holding a stale card whose TTL was ignored; and advertiser logos
  were stored as base64 inside the creatives row, which cost 1,960 ms of a 3,000 ms budget
  and failed client validation anyway.
- **`packages/` was missing** from the working branch, so the desktop app could not build.

### Known limitations

- **The installers are not signed.** Windows shows a SmartScreen warning on first run.
- **Windows artifacts only.** macOS needs a Mac to sign and notarise; Linux needs a Linux
  host or CI.
- **Payouts are manual.** A request arrives in the admin panel and you make the transfer
  yourself, then record it.
- **The terms are a template** and say so on the page. That sentence stays until a lawyer
  has read them.
- **No notebooks, no remote or container workspaces, no Vim mode, and no extension
  catalogue.** These are planned; see `artifacts/adcode-extension-store.md`.
- Six moderate npm advisories remain in the production dependency graph, all reached through
  `firebase-admin`, which the deployed Worker does not use at runtime.
