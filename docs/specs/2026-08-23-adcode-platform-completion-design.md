# ADCode platform completion — design

**Date:** 2026-08-23
**Status:** approved, in build
**Scope:** nine subsystems, six phases, one branch

---

## What this is

Every feature the settings screen still labels "Soon", plus an explanation layer, a docs
site, an update-announcement channel, a monochrome restyle, a new mark, and a rebuilt AI
chat. Decided by twenty questions asked before any code was written; the answers are
recorded inline as **Decision** notes so a later reader knows which choices were the user's
and which were mine.

## The problems being solved

1. Fifteen settings rows render disabled with a "Soon" pill. They are honest, and they are
   also a list of unbuilt work that has stopped shrinking.
2. Nothing in the product explains itself. A setting called "Sticky scroll" means nothing
   to somebody who has never seen it, and there is no Help content at all beyond a
   shortcuts sheet.
3. The blog is built; the docs site does not exist, and `DocsSidebar.tsx` is a stub
   pointing at `/blog`.
4. `autoUpdate.ts` is deliberately silent and `notices.ts` is once-per-machine-ever.
   Neither can announce a release, and there is no way for a human or an agent to write one.
5. The site's look is iOS-flavoured but not black and white, and the mark is the old
   geometry.
6. The AI chat has no persistence of any kind — `aiReset()` clears an in-memory array — and
   its provider list is hardcoded in `main/ai.ts`.
7. Reading unfamiliar code still means searching it. `packages/structure` can answer
   "who calls this" but nothing in the editor surfaces it on a click.

## Non-goals

- Reverse-engineered OAuth flows (Claude Pro/Max, Copilot). **Decision:** documented
  device-code flows only; everything else takes a key.
- Renaming `PostRecord`. Adding fields is a smaller change than a store migration and buys
  the same thing.
- Bundling language servers into the installer. Unchanged from the current honest wording.
- Any change to the ads, ledger, or earnings promises. They are restyled, never restated.

---

## Architecture

Four new packages, all pure — no Electron, no DOM, no Node I/O — because that is what lets
them be tested against strings instead of by opening an editor.

| Package | Owns | Depends on |
|---|---|---|
| `packages/help` | One `HelpEntry` per feature and per setting | nothing |
| `packages/format` | Formatters for JS/TS/JSON/CSS/HTML/Markdown, import organiser | nothing |
| `packages/debug` | DAP wire codec and session state machine | nothing |
| `packages/highlight` | tree-sitter host: grammar registry, token mapping | `web-tree-sitter` |

`packages/structure` gains reverse selector resolution and template-attribute parsing. It
stays pure.

### The dependency rule

New packages register in `.dependency-cruiser.cjs` and `tsconfig.json` paths, following the
existing FAT32 constraint: **no npm workspaces, no symlinks.** `npm run firewall` enforces
that a package never reaches into an app.

---

## P1 — The explanation layer

### `packages/help`

```ts
interface HelpEntry {
  readonly id: string;              // "editing.stickyScroll" or a settings id
  readonly title: string;
  readonly plain: string;           // one sentence a child understands
  readonly why: string;             // when you would want it
  readonly how: string;             // how to use it, including the shortcut
  readonly group: SettingGroupId | "workbench" | "ai" | "account";
  readonly settingIds: readonly string[];
  readonly shortcut?: string;
  readonly related: readonly string[];
}
```

**The guarantee is a test, not a habit.** `help.test.ts` asserts that every id in
`SETTINGS_SCHEMA` has an entry, that every `settingIds` member exists, and that every
`related` id resolves. A new setting without an explanation fails `npm run verify`.

**Decision:** one catalogue, three surfaces. Writing tooltip text in the schema, the Help
guide separately, and the docs by hand produces three copies that drift the first time a
feature changes.

### Three surfaces

1. **`?` on every settings row.** A button after the label opens a popover: `plain`, then
   `why`, then `how`. Dismissed on Escape, on outside click, and on scroll. Keyboard
   reachable, `aria-describedby` wired to the row.
2. **Help → ADCode Guide.** A sheet with the same shape as Settings: search field, the same
   group order, one card per entry. Each card has an "Open its setting" link that closes the
   guide and opens Settings scrolled to that row with it briefly highlighted.
3. **`/docs` seed.** P6 generates a docs page per entry on first deploy. Admin edits win
   from then on.

---

## P2 — The fifteen, and the structure work

### 2a · Editing

| Setting | Built as |
|---|---|
| `inlineErrorLens` | Monaco `after` decorations on the diagnostic's line, truncated, muted, suppressed on the cursor's own line while typing |
| `todoHighlighting` | A Monaco decoration provider over TODO/FIXME/HACK/XXX inside comment ranges only — `packages/structure`'s `lineComment` says where those are |
| `autoRenamePairedTag` | Extends `autoCloseTags.ts`; edits inside an opening tag name mirror to the closing tag in one undo step |
| `pathAutocomplete` | A completion provider inside string literals and import specifiers, backed by a directory-listing IPC that is already path-safety checked |

### 2b · Formatting

**Decision:** LSP first, own fallback.

```
format(document)
  ├─ language server running and advertises documentFormattingProvider?
  │    └─ textDocument/formatting  ──▶ apply edits
  └─ otherwise packages/format ──▶ whole-document replacement
```

`packages/format` ships printers for JS/TS, JSON, CSS/SCSS/LESS, HTML, and Markdown.
Every printer is a pure `(text, options) => string` and is tested for **idempotence**
(`format(format(x)) === format(x)`) with fast-check, which is the property that catches
almost every real formatter bug.

`organizeImportsOnSave` uses the LSP code action when offered, and otherwise
`packages/format`'s sorter for the languages whose import syntax `packages/structure`
already parses. `lintDiagnostics` surfaces what the server already publishes; it is a
filter on the existing diagnostics pipeline, not a new linter.

### 2c · Navigation and peek

**Decision:** LSP when running, structure-based always, and the UI says which answered.

```
definitionOf(symbol)
  ├─ server running? textDocument/definition ──▶ result labelled "resolved"
  └─ packages/structure name match           ──▶ result labelled "matched by name"
```

That label is not decoration. `relations.ts` already states the rule: *"a tool that quietly
implies it resolved something it guessed at is worse than one that shows its working."*

**Peek widget.** Click a symbol → the definition's real source renders inline beneath the
line, in a bordered strip with the file path in its header. Click the header, or Ctrl+click
the symbol, to navigate for real. Escape closes. A read-only Monaco instance rather than a
text dump, so highlighting and folding are free.

Outline, breadcrumbs, and symbol search all read `packages/structure`'s existing
`outlineOf`, so they agree with the Structure popup by construction.

### 2d · Highlighting and debugging

**tree-sitter.** `web-tree-sitter` plus grammars for the languages ADCode already knows.
WASM lives in `build/grammars/`, is loaded on first use of a language, and is registered as
a Monaco semantic-tokens provider layered over Monarch — so a grammar that fails to load
degrades to what happens today rather than to nothing.

**Debug adapter.** Node (`js-debug`) and Python (`debugpy`). `packages/debug` owns the DAP
codec and the session state machine; the Electron main side spawns the adapter and pipes
stdio. UI: gutter breakpoints, a toolbar (continue, step over, step into, step out, stop),
call stack, variables tree, and watch expressions. A language with no adapter says so
plainly rather than offering a button that does nothing.

### 2e · Terminal agent detection

Matches known agent process names in the built-in terminal and shows a strip offering to
share the project memory with it — the MCP command the settings screen already prints.

### 2f · Structure, rails, and the CSS connection

**Decision:** rails, not padding — the tree connectors drawn as spans, because which
ancestors still have siblings below is per-row data a stylesheet cannot know.
`structurePanel.ts` already does this for the file outline; P2 brings it to the project tree
and the explorer sidebar.

**CSS ↔ markup, both directions**, plus unused-selector and missing-class hints, plus JSX
`className`, Vue, Angular, and Handlebars template attributes. `styles.ts` already resolves
a selector to elements; the reverse index and the template parsers are new.

**Decision:** every one of these is switchable, with granularity. New settings include rail
depth, peek-on-click vs Ctrl+click, which CSS directions are live, and whether
unused-selector hints reach the Problems panel. Each arrives with its `packages/help` entry,
enforced by the P1 test.

---

## P3 — AI chat

### Connection

**Decision:** catalogue + any endpoint + documented OAuth only.

- **Catalogue.** models.dev, fetched and cached, with a snapshot bundled so the connection
  screen is fully populated offline and on first launch. The fetch is an upgrade, never a
  requirement. This replaces the hardcoded `MODELS` map in `main/ai.ts`.
- **Any OpenAI-compatible endpoint.** Base URL + key + model. `packages/ai` already has
  `openaiCompatible`; this is UI, keychain storage, and validation.
- **Validation.** The Connect screen sends one real minimal request and reports what came
  back. A key that does not work says so at the moment it is pasted.
- **OAuth.** A pluggable `AuthFlow` interface with GitHub's documented device-code flow
  implemented. Providers with undocumented flows register a slot that says "paste a key".

### Sessions

Persisted per workspace under `userData/ai-sessions/`, one JSON file per session, written on
turn completion. The chat card gains a history sidebar: search, resume, rename, delete, and
Clear all. Titles are auto-generated from the first user message.

A **memory strip** above the composer names exactly what is going into the turn — the open
file, the project memory entries, the session so far — so "clear session memory" is a button
whose effect is visible rather than claimed.

The menu-bar assistant icon becomes the ADCode mark.

---

## P4 — Releases and the update popup

### Record

```ts
interface ReleaseRecord {
  version: string;          // semver, the key
  title: string;
  body: string;             // markdown
  highlights: string[];
  announce: boolean;        // false = installs silently, no popup
  critical: boolean;        // bypasses quiet-moment gating
  status: "draft" | "published";
  authoredBy: "human" | "agent";
  publishedAt: number | null;
  updatedAt: number;
}
```

`/v1/releases` public and published-only; `/v1/admin/releases` for CRUD; an agent-token
endpoint that can create **drafts only**.

**Decision:** an agent drafts, a human publishes. An AI-written note that reaches every user
with no human read cannot be unsaid.

`scripts/release-note.mjs` reads the git log since the last tag, groups by
conventional-commit type, writes a draft, and POSTs it.

### Desktop popup — the anti-spam rules

**Decision:** three rules, all required before anything appears.

1. **Once per version, ever, per machine.** A dismissed-versions file, the same mechanism
   `notices.ts` already uses.
2. **Never while you are working.** Held back while typing, while a terminal command runs,
   during a debug session, or when the window is unfocused — the rules `packages/ads`
   already enforces, reused rather than reimplemented. Shown at the next quiet moment.
3. **Only when the admin ticked announce.** Patch releases install silently.

`critical: true` bypasses rule 2 only. Nothing bypasses rule 1.

### Web

A dismissible bar for the newest announced release, remembered in `localStorage` per
version, plus an indexed `/changelog` page in the sitemap and in `llms.txt`. **Decision:** a
bar rather than a modal — a modal interrupts somebody who came to read the docs.

---

## P5 — Monochrome, and the mark

**Decision:** monochrome UI, money stays green.

Every accent, link, button, focus ring, and pill becomes black, white, or grey. `--money`
survives **only** on real currency figures — the rule `globals.css` already states, and the
one colour cue that says a number is money. `--accent` is redefined to ink rather than
deleted, so no component needs to change to stop being blue.

Scope: every page, including `/portal` and `/admin`.

**The mark.** New geometry — wider brackets, a redrawn dollar sign — replacing the old path
for path in `build/icon.svg`, `Mark.tsx`, and `brandMark.ts`, then regenerating `icon.png`
and `icon.ico`. **Decision:** the black rounded plate for app icon, taskbar, favicon, OG
image, and install pages; the bare mark inheriting `currentColor` for site nav, footer,
welcome screen, and menu bar. `brandMark.ts` already has a `plate` option, so the split is
geometry only.

---

## P6 — Docs, blog, SEO

### One record, two surfaces

**Decision:** add fields rather than rename.

```ts
interface PostRecord {
  // ... existing
  surfaces: ("blog" | "docs")[];   // admin ticks either or both
  section: string | null;          // docs sidebar grouping
  order: number;                   // within the section
  related: string[];               // slugs, cross-linked both ways
}
```

The admin panel gets one editor with surface checkboxes. A post can be a blog entry, a docs
page, or both. `/docs` is seeded from `packages/help`; an admin edit to a seeded page wins
permanently from then on.

### SEO and machine readability

Everything indexed, and everything an AI crawler can read:

- `sitemap.ts` covers docs, changelog, and blog.
- JSON-LD: `TechArticle` for docs, `BlogPosting` for posts, `BreadcrumbList` for docs
  hierarchy, `SoftwareApplication` for the product.
- `llms.txt` expanded, plus a new `llms-full.txt` carrying the full text of docs and posts.
- RSS for the blog and the changelog.
- Canonical URLs, OG and Twitter cards per page, and a shared markdown renderer so docs and
  blog read as one publication.

---

## Testing

| Layer | How |
|---|---|
| Pure packages | vitest, plus fast-check for formatter idempotence and the DAP codec |
| Help coverage | a test that fails when a setting has no explanation |
| API | the existing contract suite, extended for releases and content surfaces |
| Desktop UI | `scripts/smoke.mjs`, extended per phase |
| The app itself | run at every phase boundary, and reported before the next phase starts |

## Sequencing

Commit the existing WIP on main, branch, then P1 → P6. `npm run verify` and `npm run smoke`
at each boundary. Anything that needs the user's hands — an account, a key, a card, a
signature — is appended to `SETUP.md` as it arises, since that file is the single ordered
checklist of everything a human has to do.
