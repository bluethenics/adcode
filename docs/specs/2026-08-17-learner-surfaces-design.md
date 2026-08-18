# Learner surfaces: problems, preview, suggestions

**Date:** 2026-08-17
**Status:** approved, implementing

Three features aimed at one goal from the brief's framing — an IDE a beginner can use
without already knowing what a compiler is talking about. They are independent subsystems
and were designed as three slices, but they share one type and one destination, which is
the whole reason they are specified together.

| Slice | What it adds | New infrastructure |
|---|---|---|
| 1. Problems panel | Sidebar view listing every error in plain English | `packages/diagnostics` |
| 2. Live preview | A static server over the workspace, with reload | `main/liveServer.ts` |
| 3. Suggestions | Completions in every language, Enter to accept | `renderer/editor/completions/` |
| 4. Project preview | Runs the project's own dev server, watches for its address | `main/devServer.ts` |
| 5. Language servers | Real LSP diagnostics, completions and hover | `packages/lsp` |
| 6. Go Live / Run | One status-bar button that names what it will do | `renderer/run/` |

Slices 4–6 were added after the first three shipped; their sections are at the end.

The ordering is not arbitrary. Slice 1 defines the `Diagnostic` type and the panel that
displays it; slice 2 emits `Diagnostic`s for its own failures into that same panel; slice 3
is the only one that touches neither. Building the panel first means the preview server has
somewhere honest to report to on day one instead of a second, parallel error surface.

---

## 1. Problems panel

### The data that already exists

`editorHost.ts` loads Monaco's TypeScript, JSON, CSS and HTML workers. Those workers already
type-check and already publish diagnostics; nothing in this repo has ever read them.
`monaco.editor.getModelMarkers()` and `onDidChangeMarkers` are the entire data source for
v1 — no new backend, no subprocess, no language server.

The honest limit of that: **Monaco only has markers for files open in a tab.** VS Code shows
workspace-wide problems because a language server crawls the tree. Until the LSP slice lands,
this panel shows errors in open files, and the empty state says so in those words. The same
posture the settings roster already takes with `available: false` — a surface that overstates
its coverage is worse than one that admits it.

### `packages/diagnostics` (pure)

Plain TypeScript. No Electron, no Monaco, no DOM — the same rule that makes every other
package testable in milliseconds. It owns three things.

**The type every source produces:**

```ts
type Severity = "error" | "warning" | "info";

interface Diagnostic {
  readonly file: string;      // workspace-relative
  readonly line: number; readonly column: number;
  readonly endLine: number; readonly endColumn: number;
  readonly severity: Severity;
  readonly source: string;    // "ts" | "json" | "css" — later "pylsp", "preview"
  readonly code: string;      // "2322"
  readonly message: string;   // raw compiler text, verbatim
}
```

`message` is never discarded, only demoted below the rewrite. If a translation is wrong the
real text is one glance away, which is what makes a rewrite layer safe to ship at all.

**The translation table.** Keyed `"ts:2322"`. Entries cannot be static strings: TS2322's
message carries the actual type names, and "You're putting text where a number belongs"
requires reading them out of it. So an entry is a `RegExp` plus a pure renderer over its
captures, with a small primitive→English map (`string`→"text", `number`→"a number").

**Three functions:** `explain(d): Explanation | null`, `groupByFile(ds)` (errors before
warnings before info, then path, then line), and `countBySeverity(ds)` for the badge.

`explain` returning `null` is a designed path, not a coverage gap. Unknown code → raw message
plus an "Explain this" button wired to the existing AI providers. The panel is therefore never
*worse* than VS Code's, at any table size; the table is upside only. v1 targets roughly the
forty highest-frequency beginner errors across the languages Monaco already covers rather than
attempting completeness.

### The shell

- **Activity bar:** a fourth button between Search and Source control, carrying a count badge
  — red with any error, amber for warnings only, hidden at zero. The badge is the entire
  discoverability answer: it is visible without the user knowing what the icon means.
- **`renderer/diagnostics/markerAdapter.ts`** is the single seam where Monaco and the panel
  touch. It subscribes to `onDidChangeMarkers`, maps `IMarker` → `Diagnostic`, and makes paths
  workspace-relative. Keeping it to one file is what lets the preview server and a future
  language server push into the same panel without knowing Monaco is behind it. It takes a
  structural marker type rather than importing Monaco, so it is unit-testable without a window.
- **`renderer/panels/problemsPanel.ts`** renders `groupByFile` output. Row: severity glyph,
  plain-English line, hint line, `[Fix]` when available, `[Explain this]` always. Click jumps
  to the position through the existing editor host.
- **Hover:** a hover provider over the covered languages renders the same `Explanation` at the
  squiggle, falling through to Monaco's default when `explain` returns `null`. A beginner who
  never finds the sidebar icon still gets the plain-English text where their eye already is.

### Fix

`monaco.languages.typescript.getTypeScriptWorker()` → `getCodeFixesAtPosition()` is public,
typed API in monaco-editor 0.56 and returns the same quick fixes VS Code's lightbulb shows.
v1 offers `[Fix]` for `ts`/`javascript` markers only; every other language shows no button
rather than a button that does nothing. Edits apply through the model, so they land in the
normal undo stack.

Code fixes are resolved **on click**, not on render. Resolving per visible marker would mean
a worker round trip for every row in a file with fifty errors, on a surface that redraws on
every keystroke.

---

## 2. Live preview

### Scope

A static file server over the workspace root, plus reload on change. **Not** a framework dev
server: it does not run `npm run dev`, does not bundle, and does not resolve bare module
specifiers. A beginner writing `index.html`, `style.css` and `script.js` gets a working
preview with one click; a Vite project is already served by Vite, in the terminal that
already exists.

Naming this boundary is the whole design. "Live server that runs your project" is an
unbounded promise across every toolchain; "static server over your folder" is a promise that
can be kept.

### `main/liveServer.ts`

- `node:http` over `127.0.0.1` on an ephemeral port. Never `0.0.0.0` — binding a beginner's
  project folder to their LAN is not a default anyone asked for.
- Every request path resolves through the existing `isInsideWorkspace` check before a byte is
  read. The server is reachable by anything on the loopback interface, so its path handling is
  held to the same standard as an IPC handler.
- Directory request → `index.html` if present, else a generated listing.
- HTML responses get a small reload script injected before `</body>`.
- A `node:fs` watcher over the workspace debounces changes and pushes to connected clients
  over Server-Sent Events. SSE rather than a WebSocket: one-directional, no handshake, no
  dependency, and the client is four lines.
- Failures — port in use, watcher limit, no workspace — surface as `Diagnostic`s with
  `source: "preview"` in the panel from slice 1, and as a toast. Never a modal.

### The preview surface

An in-window iframe tab alongside the editor, plus "Open in browser" for real device testing.
The iframe's origin (`http://127.0.0.1:port`) differs from the renderer's (`app://adcode`), so
same-origin policy already isolates the user's page from the workbench.

This requires one CSP change: `frame-src` moves from `'none'` to the loopback origins. That is
a deliberate, minimal widening — loopback only, frames only — and is documented at the policy.

---

## 3. Suggestions

### What is already true

JS, TS, JSON, CSS and HTML have had full completions since the workers were added. The gap is
not "no suggestions" — it is that Monaco's defaults do not accept on Enter, and that everything
outside those five languages gets nothing at all.

### Three layers, in priority order

1. **Language workers** where they exist — real, type-aware completions. Untouched.
2. **Keyword completions** for languages with no worker, from a compiled-in per-language table
   (Python, Rust, Go, Markdown, shell, and the rest of Monaco's built-in grammars). Keywords
   and their common snippets, not semantic analysis. Honest and useful; a beginner writing
   Python gets `def`, `for`, `if __name__ == "__main__"` with a body stub.
3. **Word-based completions** from the open document as the floor, so an unknown language still
   completes identifiers the user has already typed.

The table lives in `packages/diagnostics`' sibling, `renderer/editor/completions/keywords.ts` —
pure data plus a pure lookup, tested without a window.

### Enter to accept

`acceptSuggestionOnEnter: "on"` is the explicit ask. It carries a real cost worth stating: with
the suggest widget open, Enter takes the suggestion instead of inserting a newline. Monaco's
`"smart"` value only accepts when the completion changes the text, which is the compromise VS
Code ships. The user asked for Enter; v1 ships `"on"` with an `adcode.editing.acceptOnEnter`
setting so it can be moved to `"smart"` or `"off"`.

---

## Testing

Per the repo's third rule, a green suite is not a working app.

- **Unit** — the table, grouping, counting, marker adaptation, keyword lookup, and the server's
  path resolution are all pure and tested directly.
- **Purity** — `packages/diagnostics` carries the same source-reading assertion `packages/ads`
  uses, proving no module in it reaches for `Date`, `Math.random`, `process` or `fetch`.
- **Smoke** — the badge appears on a file with a known error, the panel lists it, clicking a row
  moves the cursor, the preview server answers a request and the iframe paints. Driven at real
  coordinates, per the rule that a node-dispatched click cannot see a dead region.

## What implementation changed

Two things the design did not anticipate, both found by `npm run smoke` against the real app
rather than by any unit test.

**A model inside the workspace is not the same as a file the user has open.** The adapter's
`resolveFile` originally accepted anything under the workspace root. Monaco holds models for
more than the visible tabs, and every one of them gets type-checked, so the panel listed
errors in files the user had never opened. `DiagnosticsHostDeps.includeFile` now narrows it
to *editable tabs*, which is what the empty state had been promising all along.

**Monaco's workers judge files by rules that are not the project's.** They have no
`node_modules`, so every real import reported "Cannot find module"; and their stock compiler
options are ES5 and CommonJS, so `import.meta` and modern syntax reported as errors in files
that compile fine. `renderer/editor/languageDefaults.ts` sets modern compiler options,
suppresses the three codes that are unanswerable without a filesystem, tolerates comments in
the tsconfig family, and turns off schema fetching — which the CSP would refuse anyway, as a
console error, on whatever day a user first opened a file with a `$schema` in it.

The rule both share: a diagnostic that cannot be acted on is worse than no diagnostic. It
spends the user's trust and returns nothing.

---

## 4. Project preview (follow-up slice)

The static server covers a folder of HTML, CSS and JavaScript. This covers a project with a
build step, where the thing that serves the site is the project's own dev server.

`main/devCommand.ts` is pure: lockfile → package manager, config filename → framework, and
the parsing of a dev server's banner for the address it printed. `main/devServer.ts` spawns
it through node-pty — already a dependency, gives tools a real terminal so they print their
normal banner, and on Windows takes the whole process tree down on kill, which plain
`spawn` does not. `main/preview.ts` keeps exactly one engine alive and hands the renderer a
single status either way.

**Output is surfaced, not swallowed.** A dev server that fails to start is the commonest
wall a beginner hits, and the toolchain's own words beat anything we could write. The drawer
opens by itself when something goes wrong.

**Two passes over the banner, and the order is the point.** Vite, Next, Astro and Nuxt all
print `Local:` beside `Network:`. The network address is the machine's LAN IP, which the
preview frame may not reach and which is not what a person means by "my site". So: prefer a
line saying Local, fall back only after.

**Automatic only behind a framework config.** A `vite.config.ts` means static serving cannot
work — the `index.html` beside it is an unbuilt shell that renders blank, which is the worst
outcome available because there is no error anywhere. A bare `dev` script means nothing of
the sort: ADCode's own runs Electron. Pressing preview must not become "run whatever this
project calls dev", so that case is offered in the bar and never started unasked.

## 5. Language servers (follow-up slice)

`packages/lsp` is pure: framing, message building, position conversion, the mapping into
`Diagnostic`, and the server registry. That split is not ceremony — the parts of a language
client that actually break are all pure, and none can be exercised comfortably with a real
server attached:

- **`Content-Length` counts bytes, not characters.** A diagnostic mentioning `café` is
  longer in UTF-8 than in UTF-16 units, so slicing by string index misaligns every message
  after it. The stream dies silently with nothing in any log.
- **A chunk is not a message.** Half a header, three messages at once, a body across four
  reads — all normal.
- **LSP counts from zero; everything a person reads counts from one.** An off-by-one that
  escapes the two conversion functions becomes "the squiggle is on the wrong line".

`main/lsp.ts` owns one server per language, request correlation, full-text sync (incremental
sync cannot drift out of step; full text cannot), and §11's restart-with-backoff capped at
three. `main/executables.ts` resolves the command against PATH honouring PATHEXT, because
npm-installed servers are `.cmd` shims that `spawn` cannot find or run.

**No server is bundled.** That is the brief's end state and it is a packaging job of
hundreds of megabytes per platform, not a TypeScript file. What is built is the client, the
lookup, and the answer when a server is absent: one `info` row naming the program and the
exact command that installs it. `info`, never `error` — a tool the user has not installed is
not a problem with their code. Languages nobody bundled are registered in settings as
`language: command args`, which required adding a `text` setting kind and is §4's escape
hatch in place of an extension system.

---

## 6. Go Live / Run (follow-up slice)

One button at the far right of the status bar. VS Code puts Live Server's "Go Live" there
and its Run control somewhere else entirely, which requires the user to already know which
of the two categories their file belongs to. This one reads the active file and names what
pressing it does — "Go Live", "Run Python", "Run Rust" — so the label is the documentation.

`renderer/run/runCommands.ts` is pure: language id, path, the names of the files at the
workspace root, and the platform, in; a mode and a command line, out. Twenty-seven languages,
each a *single-file* recipe, because that is what the button is for — a beginner checking
whether the thing they just wrote works. Build systems and task runners are a different
feature, and pretending otherwise here would produce a button that behaves differently in
every project.

Three details in the table earn their comments:

- **`{stem}` expands unquoted** so a template can write `"{stem}.jar"` and get one quoted
  token. A pre-quoted stem produces `"App".jar`, which a POSIX shell concatenates and
  cmd.exe does not.
- **`{exe}` is `"x.exe"` on Windows and `"./x"` elsewhere.** Without the `./`, a POSIX shell
  searches PATH and reports "command not found" for a binary sitting in the directory.
- **Paths are quoted, and a path containing `"` or a newline yields `null`.** The command
  line reaches a shell; a filename that could close the quote would be handing it a second
  command nobody typed.

**Where it runs: the terminal panel.** The output is the feature — traceback, compiler
error, exit code — and the terminal already turns paths in that output into links back into
the editor. A hidden process with a captured result would be a worse version of this.

**The one guess** is a `.css` or `.js` file: part of a page, or a program? It previews when
an `index.html` sits at the workspace root and runs when one does not. Everything else is a
lookup. Where nothing honest can be offered the button hides rather than greying out — a
permanently disabled control is a standing invitation to wonder what you did wrong.

`languageForFilename` gained about thirty extensions in the same change, because the two
lists have to agree: an extension missing there means the file opens as plain text, the
button silently never appears, and it reads as "this editor does not support Swift".

## What implementation changed (slices 4 and 5)

**Root changes have three routes, and one of them is invisible.** `setLspWorkspace` was
wired into the two IPC handlers that change the open folder. Session restore is the third,
and no user action triggers it — so language servers worked when you opened a folder by hand
and never started on any launch after the first. The notification now fires from
`setWorkspaceRoot` itself.

**A predicate that is true later is not true yet.** The language bridge gated tracking on
"is there an editable tab for this model", reusing the Problems panel's predicate.
`onDidCreateModel` fires *before* the shell registers the tab, so every document was rejected
at the one moment it mattered and nothing retried. It now gates on the path being inside the
workspace, which is time-independent and filters the historical buffers anyway — they are
keyed `adcode-commit-diff:…` and do not resolve inside the root.

**Two copies of a validator drift.** `settingsStore.ts` had its own copy of the settings
value check, which did not learn about the new `text` kind and silently rejected every write
to it. The package's own `isValidSettingValue` is now exported and used in both places.

## Deliberately not built

Bundled language server binaries, the DAP client, tree-sitter highlighting, the Navigation
rows that need symbol indexes, workspace-wide diagnostics without an open file, problem
matchers over terminal output, AI-authored fixes beyond what a language worker vouches for,
and HTTPS for the preview. Each is a later slice, not a gap in these.
