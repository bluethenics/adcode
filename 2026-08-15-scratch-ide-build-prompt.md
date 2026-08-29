# Build ADCode — an ad-supported, AI-native IDE, from scratch

> **How to use this document:** paste its full contents as the opening prompt of a fresh
> session in an empty directory. It is self-contained; it assumes no repository, no prior
> conversation, and no access to any other file.

---

## 0. Mission

Build a desktop code editor that a developer would choose over VS Code, which pays its
users 50% of the advertising revenue their attention generates, and which treats "several
different AIs working on the same codebase" as the normal case rather than an edge case.

Three things make it worth building:

1. **It pays the user.** Sponsored notifications appear rarely, on the user's terms, and
   accrue a real balance against a server-authoritative ledger.
2. **It has one memory, shared by every AI.** Claude in the built-in chat, Claude Code in
   the terminal, and Codex in another terminal all read and write the same project memory.
   Switching models does not reset what the machine knows about your project.
3. **It is not a fork.** No Code-OSS submodule, no patch stack, no upstream to chase every
   month. The editing engine is Monaco, which ships as an MIT-licensed npm package — using
   it is a dependency, not a fork.

**This is one project, not five.** The advertiser portal, the real ad-serving backend, the
payout ledger, KYC, and fraud analytics are explicitly out of scope. This build targets a
mock server implementing the serving contract in §10, so it is completable and testable
before any backend exists.

---

## 1. Non-negotiable constraints

Violating any of these is a defect, not a trade-off. They are listed first because several
of them are load-bearing for either the product's legality or its honesty.

### Money

- **All monetary values are int64 micros of USD. Never floats.** Display formatting uses
  integer arithmetic only. Binary floating point cannot represent decimal currency exactly,
  and rounding drift in a revenue-share ledger is a legal problem, not a rounding problem.
- **The client never computes money.** It reports receipts; the server owns the balance.
  Any figure shown in the UI is a cached mirror of a server value.
- **Receipts are authenticated, not signed.** Identity comes from the Firebase ID token on
  the request. No signing key ships in the binary — a key that ships with the app can be
  extracted by anyone, so client-side signing would be security theater.

### Privacy

- **The tagger's output must be a subset of a fixed, compiled-in tag vocabulary.** It may
  never emit file contents, file paths, directory names, workspace names, git remotes,
  branch names, dependency lists, or environment variables. Filename-level detection only —
  it never reads the *contents* of `package.json` or any other manifest.
- **The AI memory subsystem and the ad subsystem are firewalled.** `packages/ads` may not
  import from `packages/memory`, and no memory content may reach any `/v1/*` endpoint.
  Enforce this with a dependency-cruiser rule (or equivalent) that fails CI on violation.
  This is the single most important boundary in the codebase: the ad side promises that
  nothing from the user's code ever leaves the machine, and the AI side is full of exactly
  that. The promise survives only if the two can never touch.
- **Creative assets are `https` only, from an allowlisted host, fetched and cached by us.**
  Never hot-linked from advertiser servers. Hot-linking would hand every advertiser the
  user's IP address and a fingerprinting beacon on every impression.
- **Ad clicks open via the system browser, `https` only.** Never a webview, never in-editor
  navigation.

### Interruption

- **Frequency caps are client-side and authoritative.** Remote config may only *tighten*
  them, never loosen them. A compromised or misconfigured server must not be able to make
  the IDE more annoying than its shipped defaults.
- **An impression requires all three:** the toast actually painted, the window focused for
  the full duration, and at least 4 seconds on screen. Anything else is discarded locally
  and never reported.
- **Frequency defaults:** 30-minute minimum interval, 8/day cap, 8s auto-dismiss (timer
  pauses on hover), 60s settle period after launch.

### Performance

- **Only `transform` and `opacity` may animate.** Both are GPU-composited. Animating `top`,
  `right`, `width`, or `height` forces layout every frame *while the user is typing*, which
  surfaces as input latency in the one application where latency is unforgivable. Set
  `will-change` on enter and remove it on completion so no compositor layer is pinned for
  the session.
- **Reduce-motion is honored everywhere.** Follows the OS setting. Slide transitions become
  100ms opacity fades with no translation.
- **No AI feature may block a keystroke.** Ever, under any latency or failure condition.

### Architecture

- **Every user-facing capability is a built-in with a settings toggle.** There is no
  extension system, no extension host, and no `.vsix` support. What VS Code delegates to
  extensions, this IDE ships natively and lets the user switch off.
- **Electron security posture is non-negotiable:** `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`, a strict CSP, and all privileged operations
  behind an explicit `contextBridge` API. The renderer opens untrusted content (repo files,
  model output, ad creatives) and must be treated as hostile.

---

## 2. Stack and process model

**TypeScript 5.x · Node 24 / npm 11 · Electron · Monaco · xterm.js · SQLite · vitest ·
fast-check · Playwright**

```
┌─ main process (Node) ──────────────────────────────────────┐
│  window lifecycle · file system · node-pty                  │
│  LSP + DAP subprocesses · auto-update · MCP server          │
│  memory store + index · Firebase auth token refresh         │
└───────────────────┬────────────────────────────────────────┘
                    │ contextBridge (typed, allowlisted)
┌─ renderer (sandboxed) ─────────────────────────────────────┐
│  workbench shell — layout, activity bar, status bar         │
│  ├─ Monaco .............. editing surface only              │
│  ├─ xterm ............... terminal surface                  │
│  ├─ notifications ....... sponsored toast lives here        │
│  ├─ ai widgets .......... chat, trace, inline diff          │
│  └─ design system ....... tokens + primitives               │
└────────────────────────────────────────────────────────────┘
```

Monaco is the **editing surface only**. It is not the workbench. The file tree, tabs,
command palette, settings, search, git UI, notifications, and every AI surface are yours.
Resist the temptation to reach for `monaco-editor`'s standalone services for anything
beyond text editing — they are built for embedding a code box in a web page, and the seams
show immediately.

### Directory layout

```
adcode/
├─ package.json                  npm workspaces root
├─ apps/desktop/
│  ├─ src/main/                  Node-side services
│  ├─ src/preload/               contextBridge surface, no logic
│  └─ src/renderer/
│     ├─ workbench/              layout, activity bar, status bar, palette
│     ├─ editor/                 Monaco host, models, tabs, diff view
│     ├─ terminal/               xterm host, profiles, shell integration
│     ├─ notifications/          notification system + sponsored kind
│     ├─ ai/                     chat widget, trace widget, diff widget
│     ├─ explorer/               file tree, search, git
│     └─ design/                 tokens + primitives
├─ packages/
│  ├─ ads/                       12 modules, zero UI imports
│  ├─ memory/                    store, index, MCP server
│  ├─ lsp/                       LSP client
│  ├─ dap/                       DAP client
│  ├─ settings/                  schema, defaults, migration
│  └─ design-tokens/             generated CSS custom properties
├─ mock-server/                  local serving contract implementation
└─ build/                        packaging, signing, update feed
```

`packages/ads` and `packages/memory` are plain TypeScript with no Electron, Monaco, or DOM
imports. That is what makes their logic testable in milliseconds, and it is why the UI layer
stays an adapter rather than a logic layer.

---

## 3. Design language — iOS-inspired

The whole workbench chrome, not just accents. Monaco's editor surface is themed to match.
The goal is an editor that looks designed rather than assembled, and that a Mac user
recognizes as native-adjacent without it being a skin.

| Aspect | Specification |
|---|---|
| **Type** | SF Pro Text/Display on macOS, Inter elsewhere. SF Mono / JetBrains Mono for code. Scale: 11 / 13 / 15 / 17 / 22 / 28px. |
| **Shape** | Continuous-curvature squircles (not `border-radius` circles). Radii: 10 / 14 / 20px. |
| **Material** | Translucent sidebar and titlebar via `backdrop-filter: saturate(180%) blur(20px)`, backed by Electron `vibrancy` on macOS and `backgroundMaterial: 'mica'` on Windows 11. Graceful opaque fallback on Linux. |
| **Motion** | `cubic-bezier(.32,.72,0,1)` for sheets, popovers, and widget entry. `cubic-bezier(.16,1,.3,1)` at 220ms for the sponsored toast. Exits 160ms ease-in. |
| **Elevation** | Two levels only: resting (no shadow, hairline border) and floating (soft large-radius shadow). No z-index sprawl. |
| **Controls** | iOS switch for booleans, segmented control for 2–4 exclusive choices, inset-grouped lists for settings, sheets for modals. |
| **Color** | Follows OS light/dark and the system accent color. One semantic token set, defined once in `packages/design-tokens`. |

**Settings are inset-grouped lists of switches**, organized by the six feature groups in §4,
with a search field at the top. Every toggle in §4 appears here. This screen is where the
"turn anything off" promise is actually kept, so it deserves real design attention rather
than a generated form.

**Density is a setting, not a decision.** iOS spacing is generous; developers with 13-inch
laptops are not. Ship `comfortable` and `compact` and let the user choose.

**Every feature must be discoverable.** Put a four-cell **All Features** icon directly
below Earnings and expose the same library through **View → All Features** and **Help →
Feature Guide**. Its searchable, categorized iOS-style popover contains every shipped
feature, including ordinary editing workflows, with **What it does**, **Why use it**, **How
to use it**, prerequisites, and a safe Open or Settings action. Generate the library, Help
guide, menu routes, and written feature inventory from one typed catalogue so they cannot
quietly disagree.

The title-bar field is **Universal Search** across features, commands, files, recent
projects, and workspace symbols, with grouped progressive results and stale-query
cancellation. Starting with `>` favours commands. Keep the focused tools and their muscle
memory: Quick Open `Ctrl+P`, Command Palette `Ctrl+Shift+P`, Symbol Search `Ctrl+T`, and
project Content Search `Ctrl+Shift+F`. Provider failure must not hide local results, and
selecting a result may dispatch only a registered command, a known setting, or a validated
workspace/file/symbol location.

---

## 4. Built-in feature roster

There is no extension marketplace. Everything below ships in the binary, and every item has
an `adcode.*` boolean or enum setting so the user can switch it off. Defaults are given.

**Editing** — bracket-pair colorization `on` · inline error/warning lens `on` · inline git
blame `off` · sticky scroll `on` · indent guides `on` · TODO/FIXME highlighting `on` ·
auto-rename paired tag `on` · path autocomplete `on` · trailing whitespace render `off` ·
minimap `on` · code folding `on` · multi-cursor and column select `on`

**Formatting** — built-in Prettier-equivalent formatter `on` · format on save `on` ·
LSP-driven lint diagnostics `on` · organize imports on save `off`

**Git** — gutter diff decorations `on` · blame `off` · stage/unstage/commit UI `on` ·
branch switcher `on` · merge-conflict resolution `on` · file timeline `on`

**Navigation** — fuzzy file open `on` · symbol search `on` · global regex search and
replace `on` · go to definition/references/implementations `on` · breadcrumbs `on` ·
outline `on`

**Language** — LSP client `on` · DAP client `on` · tree-sitter highlighting `on`. Bundle
servers for TypeScript/JavaScript, Python, Rust, Go, JSON, HTML/CSS, and Markdown. Allow
the user to register additional servers by command and args in settings — that is the
escape hatch that replaces an extension system for languages you did not bundle.

**Session** — workspace restore `on` · auto-save after delay `on` · local file history `on`
· crash recovery of unsaved buffers `on`

**AI** (see §5) — chat widget `on` · inline completion `on` · isolated workspaces `on` ·
Team suggestions `on` · review approval `on` · scheduled messages `on` · terminal agent
detection `on` · safe terminal continuation `off` · memory capture `on` · MCP server `on`

> Dropping the extension system removes the single biggest risk a VS Code fork carries —
> that Microsoft-licensed extensions (C/C++ tools, C# debugger, Pylance, Remote-SSH) cannot
> legally be used, leaving a gap users discover the hard way. In exchange, every language
> integration is now yours to bundle and maintain. Bundling the seven servers above covers
> the large majority of real use; the user-registered-server escape hatch covers the rest.

---

## 5. The AI layer

### 5.1 Shared memory

One local memory store, read and written by every AI the user works with — the built-in
chat, and any external CLI agent running in the terminal.

```
<workspace>/.adcode/memory/
├─ decisions/2026-08-15-chose-electron.md
├─ conventions/naming.md
├─ preferences/testing-posture.md
├─ sessions/2026-08-15T14-22-claude-code.md
├─ index.sqlite            FTS5 + embeddings, rebuildable from the .md files
├─ AGENTS.md               generated mirror, never hand-edited
└─ CLAUDE.md               generated mirror, never hand-edited
```

Memories are **plain markdown with frontmatter**, one fact per file:

```markdown
---
name: chose-electron-over-tauri
description: Why the shell is Electron and not Tauri
type: decision          # decision | convention | preference | session | index
created: 2026-08-15
agents: [claude-code]   # which agents have touched this
---

Electron was chosen over Tauri because node-pty and the LSP subprocess story are
first-class in Node and hand-rolled in Rust. Cost: ~75MB of installer size.

Related: [[terminal-architecture]]
```

Four kinds of content are captured, all of them:

| Kind | What it holds | Why it matters |
|---|---|---|
| **Project knowledge** | Architecture decisions, conventions, gotchas, "we tried X, it failed because Y" | The most expensive thing a fresh agent lacks, and the one it cannot derive from reading code |
| **Cross-agent session log** | A summarized record of what each agent did and why | This is what stops the second model from re-treading the first model's dead ends |
| **Code index** | Symbol graph plus embeddings | Any connected agent retrieves relevant files instead of re-scanning the tree |
| **User preferences** | Style, testing posture, comment density, preferred libraries, how much explanation is wanted | Applies across every project and every provider |

Design rules for the store:

- **Markdown is the source of truth; SQLite is a cache.** Deleting `index.sqlite` must be
  a fully recoverable operation — rebuild it from the files.
- **The store is git-diffable and human-readable.** "What does this thing know about me?"
  must have an answer the user can point at, open, edit, and delete.
- **`AGENTS.md` and `CLAUDE.md` are generated mirrors**, rewritten on every memory write.
  They exist so an agent that speaks neither MCP nor your schema still gets the context by
  reading a file it already looks for.
- **Nothing syncs anywhere.** Memory is local. It leaves the machine only inside a model
  request the user initiated, to a provider whose key the user supplied.

### 5.2 How agents connect

**Built-in agent** — an in-process agent loop with BYO API keys for Anthropic, OpenAI,
Google, and a local endpoint (Ollama or compatible). Keys are stored in the OS keychain,
never in settings JSON. The provider is a runtime choice, not a build-time one.

**External agents via MCP** — the main process runs an MCP server exposing the memory store
so Claude Code, Codex CLI, Gemini CLI, and anything else that speaks MCP read and write the
same memory. Expose exactly these tools, and resist adding more:

| Tool | Purpose |
|---|---|
| `memory_search(query, kind?, limit?)` | Semantic + full-text retrieval over the store |
| `memory_read(name)` | Fetch one memory in full |
| `memory_write(name, description, type, body)` | Create or update a memory |
| `memory_list(kind?)` | Enumerate names and descriptions |
| `session_append(agent, summary)` | Record what this agent just did |
| `project_context()` | The digest a fresh agent should read first |

Write the connection instructions into the IDE's own onboarding — a user who has to figure
out MCP configuration by themselves will not do it, and the entire feature dies there.

### 5.3 Widgets, not panels

The AI surface is **floating widgets**, not a docked side panel. Panels force a layout
decision on every session; widgets appear where the work is and get out of the way.

- **Chat widget** — a floating, draggable, resizable card summoned by keyboard shortcut.
  Remembers position per workspace. Dismisses on Escape without losing the conversation.
- **Trace widget** — shows operational events live: task and agent state, tools, files,
  reservations, proposals, merges, checks, refusals, errors, apply and rollback. Collapsed
  to one line by default, expandable to full detail. It never claims to expose a provider's
  private chain of thought. This is what makes the AI legible instead of magical.
- **Inline diff widget** — proposed changes appear at the edit site as a reviewable diff,
  accepted or rejected per hunk in the default Review mode. Opt-in Trusted mode may apply a
  completed proposal automatically, but only after isolation, overlap checks, and a durable
  rollback checkpoint.
- **Inline completion** — ghost text, tab to accept, debounced and cancellable. Subject to
  §1's rule that no AI feature may block a keystroke: the completion request is fired on an
  idle callback and abandoned the instant the user types again. Users can also request it
  with Alt+\; normal language-server, keyword, path, and human editing remain independent.
- **Terminal agents are first-class.** Detect when a known CLI agent is running in the
  built-in terminal, surface its filesystem edits as the same inline diff widgets, and log
  its session to the same memory store. A developer running `claude` in your terminal should
  feel like they are using your IDE's AI, not working around it.

### 5.4 Safe workspaces, Teams, and open-app automation

- Every built-in file-editing task starts in a detached Git worktree or shadow copy. The
  main process owns paths, budgets, checkpoints, apply, rollback, retention, and cleanup;
  the renderer receives bounded redacted views.
- ADCode may suggest several agents when independent work is likely to be faster or cheaper,
  and a user may request Team mode manually. No extra provider request begins until the user
  confirms the complete roles. Each role gets its own sandbox and allowance from one atomic
  team budget; compact handoffs replace repeated full transcripts.
- Team proposals merge deterministically into the ordinary review boundary. Overlapping
  changes become explicit conflicts; the coordinator never silently picks a winner.
- Task token ceilings are reserved before provider calls. Traces show usage and routes when
  known without pretending estimates are invoices.
- One-time scheduled prompts work only while ADCode, the project, and a compatible adapter
  are available. Missed items wait for **Run now**. Terminal delivery requires a one-time
  idle grant; unknown processes never receive typed input.
- Usage-limit continuation is opt-in, capped, and accepts only an unambiguous reset time from
  a recognized terminal agent. It sends the literal `continue` and cancels on state changes
  or app close.
- The editor breadcrumb is an interactive workspace > folder > file > symbol trail, with
  keyboard filtering, file actions, nearby/recent files, and symbol navigation. It uses the
  existing theme and motion system rather than creating an AI-only workbench.

---

## 6. Terminal

The terminal is a headline feature, not an afterthought. Build on **xterm.js with the WebGL
renderer and node-pty**.

- True color, font ligatures, GPU-accelerated rendering, smooth scrolling
- Splits and tabs; sessions persist across window reload
- **Shell integration** — command decorations in the gutter, exit-code marks, jump to
  previous/next command, working-directory detection, command duration
- Clickable links: URLs open in the browser; file paths open in the editor **at the right
  line and column**, including from stack traces and compiler output
- Auto-detected profiles: PowerShell, pwsh, cmd, Git Bash, WSL distros on Windows; zsh,
  bash, fish on macOS and Linux
- Scrollback search with regex, and select-to-copy conventions matching the host OS
- Run-in-terminal tasks defined in settings, with problem matchers feeding the diagnostics
  surface

---

## 7. Coding experience — as budgets

"Best coding experience" is only actionable as numbers. These are acceptance criteria, and
CI should measure the first two on every release build.

| Budget | Target |
|---|---|
| Keystroke → paint | **< 16ms** at p99 in a 5,000-line file |
| Cold start → window visible | **< 1s** |
| Cold start → editable | **< 2s** |
| Open a 100MB file | No freeze; degrade features, never the frame rate |
| Fuzzy file open, 50k files | First results **< 100ms** |
| Universal Search local results | First grouped results **< 100ms**; async sources cannot replace a newer query |
| Memory, 10 open editors | **< 600MB** RSS |

Ship the VS Code default keymap so muscle memory transfers on day one, with full rebinding
and importable `keybindings.json`.

---

## 8. The ad client

Twelve modules in `packages/ads`. Five are **pure** — no I/O, no clock reads, no UI imports —
which is what makes the interruption behavior exhaustively testable without launching an
editor.

| Module | Purity | Responsibility |
|---|---|---|
| `types.ts` | — | Shared types only. No logic. |
| `scheduler.ts` | **pure** | Decide whether to show an ad now; tighten caps from remote config |
| `validation.ts` | **pure** | Validate untrusted creatives from the network |
| `tagger.ts` | **pure** | Map language IDs + workspace filenames to a fixed tag vocabulary |
| `ledger.ts` | **pure** | Mirror the server balance; format micros for display |
| `sponsorsView.ts` | **pure** | Shape balance + history into view model data |
| `receiptQueue.ts` | I/O | Disk-backed, capped, deduped receipt queue |
| `auth.ts` | I/O | Firebase anonymous identity and ID-token refresh |
| `client.ts` | I/O | HTTPS serving-contract calls with timeout, backoff, validation |
| `assetCache.ts` | I/O | Fetch and cache creative assets so they are never hot-linked |
| `renderer.ts` | adapter | Creative → notification, via a swappable `NotificationSink` |
| `adService.ts` | wiring | Startup, 60s tick, IDE adapters. Thin. |

### 8.1 The scheduler

Signature: `decide(state: SchedulerState): { show: true } | { show: false; reason: SuppressReason }`

Suppression reasons, evaluated in this exact order — user intent first, then context, then
rate limits, then inventory, so the reason returned stays meaningful as telemetry:

`ads-disabled` → `kill-switch` → `frequency-off` → `settling` → `window-unfocused` →
`debug-active` → `do-not-disturb` → `daily-cap` → `min-interval` → `no-creative`

Frequency presets: `off` · `light` (60min / 4 per day) · `standard` (30min / 8 per day) ·
`max` (15min / 20 per day). Show projected hourly earnings beside each option in settings.
`off` is a real option and disables earnings accordingly.

`tightenCaps(local, remote)` takes the **stricter** of each value and clamps hostile input —
a negative remote interval or cap must never widen the local one.

### 8.2 The tagger

Language IDs and framework markers detected **by filename only** map into a compiled-in
vocabulary. The function's final step intersects its output against `TAG_VOCABULARY` and
slices to `MAX_TAGS`, so that even a carelessly edited mapping table cannot leak a tag that
was not compiled into the binary. Reduce every input to its basename before matching, so a
path arriving where a filename was expected cannot leak a directory name.

This module is why the privacy claim in §1 is structural rather than aspirational.

### 8.3 The sponsored notification

A first-class notification kind in your own notification system — logo slot, "Sponsored"
label, its own theme token, dismiss button.

```
                      ┌──────────────────────┐
   offscreen  ····▸   │ [logo]  Sponsored    │  ◂···· editor edge
   translateX(100%)   │ Sentry — catch       │
   opacity 0          │ errors before users  │
                      └──────────────────────┘
                      translateX(0), opacity 1
```

Enter: `translateX(calc(100% + 12px)) → 0`, `opacity 0 → 1`, 220ms,
`cubic-bezier(.16,1,.3,1)`. Exit: reverse, 160ms, ease-in. Existing toasts reflow with a
180ms transform transition. Creatives carry `logoLight` and `logoDark`; subscribe to theme
changes so a toast on screen when the OS flips at sunset swaps its logo live rather than
going invisible.

Zen mode, full-screen, and presentation mode suppress it at render time — a second layer
beneath the scheduler, so a bug in the scheduler still cannot put an ad over a demo.

### 8.4 Identity

First launch performs Firebase **Anonymous Auth** — no UI, no wall — yielding a UID and ID
token. Earnings accrue against that UID server-side. At cash-out, `linkWithCredential`
upgrades *the same UID* to a real account, so the balance carries over with no ledger-merge
logic.

**The UID is stable, not rotating, and this is a deliberate trade-off.** A ledger cannot
accrue against an identifier that rotates. The consequence is a persistent pseudonymous
identifier tied to one install. State this plainly in the privacy policy rather than
glossing it as "anonymous". Let the user reset the identifier from settings, warning first
that doing so forfeits any unclaimed balance.

The IDE **never talks to Firestore directly** — it calls the HTTPS API, which owns the
database. It does use the Firebase **Auth** SDK directly; Auth is designed for untrusted
clients, and a money ledger's security rules are not the place to find out whether that
generalizes. OAuth at cash-out goes through the system browser with a deep-link return on a
registered `adcode://` URL protocol, then a custom-token exchange. Credentials never transit
an embedded webview.

---

## 9. Failure modes

> **Governing rule: the ad client may fail in any way. The worst permitted outcome is that
> the user sees no ad.** No ad-side failure may ever degrade editing, startup, or the
> terminal.

| Failure | Required behavior |
|---|---|
| Ad module throws at startup | Isolated; editor and startup time unaffected. Never on the critical path to first paint. |
| Ad server down or slow | 3s fetch timeout. A prefetch cache of ~10 creatives means a display never waits on the network. Offline: serve from cache until exhausted, then go quiet. |
| Receipts cannot be sent | Queue to disk, capped at 500, oldest dropped. Flush on reconnect. Deduped server-side by receipt ID so users do not lose earnings to flaky wifi. |
| Malformed or hostile creative | Schema-validated before render: unknown fields rejected, `__proto__` rejected, text length capped, markup stripped, `https` only, assets restricted to the allowlisted host by **exact** hostname match. |
| Server tries to over-serve | Client-side caps are authoritative. A compromised ad server still cannot spam users. |
| Emergency | Remote kill switch plus a local `adcode.ads.enabled` setting. Either stops everything. |
| AI provider down or rate-limited | Chat and completion degrade silently. Editing, terminal, and memory reads are unaffected. |
| Memory index corrupt | Rebuild from markdown on next launch. Never block startup on it. |
| LSP server crashes | Restart with backoff, cap the retries, surface it once in the status bar. Never a modal. |

---

## 10. Serving contract

All requests carry `Authorization: Bearer <firebase-id-token>`. Identity comes from the
token, never from a body field.

| Endpoint | Purpose |
|---|---|
| `POST /v1/serve` | `{ tags[], themeKind, count }` → creatives with light and dark assets, each with `creativeId` and TTL. Fills the prefetch cache. |
| `POST /v1/receipts` | Batch of receipts. Idempotent by receipt ID. Returns `{ acked: string[] }`. |
| `GET /v1/balance` | Server-authoritative earnings: `{ availableMicros, lifetimeMicros }`. |
| `GET /v1/config` | Kill switch and cap ceilings. **May only tighten client caps, never loosen them.** |

Build `mock-server/` implementing all four endpoints plus an asset host and a
`POST /__test__/reset`. Node 24 runs TypeScript natively, so this needs no build step.

**The mock server must not import the client's types.** A mock that shares the client's
type definitions cannot catch a contract mismatch, which is the main thing it exists to do.

---

## 11. Testing

- **`scheduler.ts`** — exhaustive unit tests across the suppression matrix, plus a
  property test: *no sequence of events can exceed the daily cap or violate the minimum
  interval.* This is the behavior users judge the product on, so it carries the strongest
  guarantee in the codebase. Use fast-check, 500+ runs.
- **`tagger.ts`** — a property test asserting that for arbitrary hostile input, every
  emitted tag is in `TAG_VOCABULARY` and the count is within `MAX_TAGS`. 1000+ runs.
- **`validation.ts`** — hostile input: script tags in text fields, non-https URLs,
  `javascript:` URLs, prototype pollution, oversized strings, missing dark asset, and a
  host that merely *suffixes* the allowed host.
- **`client.ts`** — against the mock server: timeout, 5xx, malformed JSON, offline→online
  flush, receipt dedupe, token refresh.
- **Memory** — round-trip through markdown and index; index rebuild after deletion;
  concurrent writes from two MCP clients.
- **Firewall** — a CI rule asserting `packages/ads` has no import path to
  `packages/memory`. This test failing is a release blocker.
- **Performance** — automated measurement of the §7 budgets on every release build.
- **End-to-end** — Playwright against the packaged Electron app: open a folder, edit, run a
  terminal command, trigger a seeded creative in both themes, verify reduce-motion.
- **Manual gate, once per release** — a person uses the build as their actual editor for a
  full working day. No automated suite catches "this is annoying."

---

## 12. Distribution

Targets: Windows x64/arm64, macOS universal, Linux deb/rpm/AppImage.

| Platform | Requirement |
|---|---|
| Windows | Code-signing certificate. Unsigned installers hit a SmartScreen "unrecognized app" wall that kills conversion. Since 2023 these certs require hardware-token or HSM storage. **Budget 1–3 weeks of organization validation before anything can be signed — this is calendar time, not work. Start it on day one, in parallel with everything else.** |
| macOS | Apple Developer Program ($99/yr), hardened runtime, and notarization, or Gatekeeper refuses to open the app at all. |
| Linux | Free; a signing key is needed only to publish apt/yum repositories. |

Auto-update via `electron-updater` against a JSON feed plus artifact hosting, with staged
rollout and the ability to halt a bad release.

---

## 13. Definition of done

The build is complete when all of the following are true:

- [ ] A signed, notarized, installable app on Windows, macOS, and Linux
- [ ] It opens a folder, edits files, and saves them, holding every budget in §7
- [ ] Terminal with splits, profiles, shell integration, and clickable file links
- [ ] LSP and DAP working for the seven bundled languages; debugging hits a breakpoint
- [ ] Every feature in §4 present and individually switchable in an iOS-style settings screen
- [ ] Chat, trace, and inline-diff widgets working against at least two providers
- [ ] MCP server running; an external Claude Code session reads a memory written by the
      built-in chat, and vice versa
- [ ] Sponsored toasts sourced from the mock server, honoring every suppression rule
- [ ] Balance mirrored against an anonymous Firebase UID and shown in the status bar
- [ ] Scheduler and tagger property tests passing; the ads↔memory firewall test passing
- [ ] A person has used it as their only editor for a full working day and would do so again

---

## 14. How to proceed

**Do not start writing code from this document.** It is a brief, not a plan.

1. **Brainstorm.** Interrogate this brief. Where is it underspecified, internally
   inconsistent, or wrong? Ask about anything that would change the architecture. Push back
   on scope — this is a large build, and the first honest question is which slice ships
   first.
2. **Write a spec** to `docs/specs/YYYY-MM-DD-<topic>-design.md`. Commit it. Get it reviewed
   before planning.
3. **Write an implementation plan** broken into tasks small enough to complete and verify
   independently. Each task names its files, its interfaces (what it consumes, what it
   produces), and its verification command.
4. **Implement test-first.** Write the failing test, run it, confirm it fails for the right
   reason, implement, confirm it passes, commit. The pure modules in §8 are specified
   precisely enough to be written this way with no ambiguity — start there, because they are
   also the modules where a bug is most expensive.
5. **Sequence deliberately.** The ad modules and the memory store have zero UI dependencies
   and can be built and fully tested before the shell exists. The editor shell is the long
   pole. The Windows certificate is calendar time and should be started immediately.

Suggested first slice, if you need one: a window that opens a folder, edits a file with
Monaco, saves it, and runs a terminal — holding the §7 budgets. Everything else in this
document is worthless without that, and it is the part most likely to reveal that a
decision here was wrong.
