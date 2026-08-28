# ADCode

An ad-supported, AI-native IDE. See `2026-08-15-scratch-ide-build-prompt.md` for the brief.

**Status: the editor is real.** It opens folders, edits in Monaco, runs several terminals,
stages and commits, searches and replaces across a workspace, explains your errors in plain
English, previews your site on a built-in server, suggests completions in every language it
highlights, talks to four AI providers, remembers what you were doing, and installs as a
Windows app.

**The advertiser platform is real too.** `services/api` serves ads, verifies receipts, and
keeps an append-only money ledger; `apps/web` is the marketing site, advertiser portal,
user dashboard, and admin panel. Not built: full language intelligence (LSP, DAP), and
paying users out.

**Deploying it?** `SETUP.md` is the ordered list of everything that needs your account,
your card, or a lawyer. Nothing in it is a coding task.

**AI edits are isolated.** The built-in assistant prepares file changes in a private task
workspace, shows them in the existing chat review flow, and writes only accepted hunks after
a durable rollback checkpoint. See [Safe AI workspaces](docs/features/ai-workspaces.md) and
the [security boundary](docs/architecture/ai-workspace-security.md). This is the
single-agent foundation; Team mode, trusted apply, schedules, external-agent adapters, and
automatic continuation are still planned rather than implied here.

```
npm install
npm start               # build if needed, then launch
npm run package         # installer + portable .exe into release/

npm run verify          # typecheck + architecture rules + full suite (1666 tests)
npm run smoke           # launch the built app and drive it (96 checks)
npm run smoke:ads       # prove an ad reaches the user as a notification (23 checks)
npm run smoke:all       # both smoke runs, in order
npm run icons           # rasterise build/icon.svg into icon.ico and icon.png
npm run dev             # electron-vite dev server, with hot reload
npm run mock-server     # ad serving contract on :8787, no build step
npm run web             # the site, portal, dashboard and admin on :3000
npm run test:emulator   # the Firestore adapter (needs firebase-tools and a JDK)
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
| `packages/search` | Fuzzy file ranking and workspace search/replace. 61 tests. |
| `packages/structure` | Outlines for 40 languages, reference classification, CSS selector matching, tag closing, folder explanations, file templates. 120 tests. |
| `packages/memory` | Shared memory store, frontmatter, mirrors, FTS index, MCP server. 116 tests. |
| `packages/settings` | 55 settings across 10 groups. 61 tests. |
| `packages/collab` | Live-session wire protocol, permissions, roster, invite codes, cursor colours. 81 tests. |
| `packages/diagnostics` | The `Diagnostic` type, plain-English rewrites of ~40 compiler errors, grouping. 35 tests. |
| `packages/lsp` | LSP framing, message building, position conversion, server registry. 49 tests. |
| `packages/ai` | Completion state machine, diff review, agent loop, four providers. 70 tests. |
| `mock-server` | All four `/v1/*` endpoints, an asset host, fault injection. 21 tests. |
| `services/api` | The real backend: auth, serving, receipts, campaigns, advertiser funding, the admin surface, and an append-only money ledger. Firestore behind a port, so it tests with no cloud project. 294 tests. |
| `apps/web` | adcode.bluethenics.com: marketing site, blog, advertiser portal, user dashboard, admin panel. Next.js, 23 routes. |
| `apps/desktop` | The shell: menu bar, command centre, command palette, tabs, tree with right-click actions and drag-and-drop, git and search panels, commit browser, Problems panel, Structure popup, editable keyboard shortcuts, live preview, multi-terminal with a shell launcher, resizable layout, settings, chat, session restore. |

**Not built:** the DAP client and tree-sitter highlighting; the Navigation rows that
genuinely need a language server — go-to-definition and workspace symbol search — and, the
important one, **bundling the language servers themselves**. The LSP client is real and
works against any server on your PATH; shipping `rust-analyzer` and friends inside the
installer is a packaging job of several hundred megabytes per platform and has not been
done.

The outline was on that list and is not any more. It turned out not to need a language
server at all: `packages/structure` reads a file's declarations with one line-oriented
engine and a table per language, which keeps working on the file *as it is being typed* —
the state a real parser handles worst and an outline spends most of its life in. What that
buys and what it costs is under **Structure** below.

**What is built but never run against real infrastructure:** the Firestore adapter (its
emulator suite needs a JDK, which this machine lacks) and the Dodo Payments adapter
(written from the published reference, never exercised with live credentials). Everything
above those two ports is covered by tests that need no cloud account.

**What still needs a person, not code:** creating the GCP, Firebase, Dodo, and Wise
accounts; registering the domain; and a lawyer reading `apps/web/src/app/terms/page.tsx`
before real money moves. Paying users out is built and needs a person by design — a user
requests, the ledger holds the amount, an administrator sends the Wise transfer by hand and
records its reference. See `services/api/src/withdrawals.ts` and SETUP.md step 19.

## The learner surfaces

Design in `docs/specs/2026-08-17-learner-surfaces-design.md`.

**Structure.** A popup — Ctrl+Shift+U, or View ▸ Structure — with two tabs.

*This file* is what you are looking at, drawn as a tree with rails. Functions, classes and methods in forty languages; tags in HTML, nested as the
page nests and named the way dev tools name them (`div#hero.card`); rules and at-rules in
CSS; headings in Markdown; keys in JSON and YAML. It reads the *buffer*, not the file, so it
describes what is on screen including edits you have not saved, and it redraws on a pause in
typing rather than on every keystroke.

Every row answers a second question on request, which is the part other outlines do not do:

- **A function** lists what it calls — read straight out of its own body, no search — and
  where it is called from, found by a project-wide search with each hit classified as a
  definition, a call, an import or a mention.
- **A CSS rule** lists what it sets, and *which elements it lands on*: the selector is
  reduced to its rightmost compound, searched for across the project's markup, and every hit
  line is parsed as HTML and judged. `.card__title--muted` stops being a string nobody can
  trace and becomes three elements you can click.
- **An HTML element** lists the stylesheet rules that can reach it — the same question from
  the other side.

None of this resolves scope, and the panel says so rather than implying otherwise: two files
can each define `handle`, and both appear. The honest version of that is more useful than a
confident wrong one.

*This project* is the other tab, and answers a question no editor answers: what are all
these folders. It reads the root, names what kind of project it is from the manifests it
finds, says where to start reading, and writes a sentence beside every folder and file it
recognises — `node_modules` is "every library this project installs, downloaded by npm";
`dist` is "the finished version, generated from `src`; editing it is always a mistake". What
was generated rather than written is dimmed, which is the fastest way to see that half of a
project root is not yours to read. It is a dictionary of about eighty entries, not an
inference: a name with no entry gets no note rather than a guess.

**New files start from a template.** Create a `.html` and it opens with the doctype, the
charset, the viewport meta and a `<body>` — with the caret already inside it. Twenty-five
languages have one, each a complete working program of its kind, and Ctrl+Z undoes it. Three
rules kept them honest: only what is always true, it must actually run, and the caret lands
where you would have put it. Languages with no always-true skeleton — a Dockerfile, a YAML
file — deliberately have none.

**Closing your tags.** Type `<h1>` and `</h1>` is there with the cursor between them; type
`</` and the tag still open completes itself. It knows void elements (`<br>` gets no
partner), self-closing tags, comments, doctypes, PHP tags, half-typed attributes containing
a `>`, and — the one that catches every naive implementation — the difference between a JSX
element and a TypeScript generic, which is the character before the `<`.

**Keyboard shortcuts you can change.** Help ▸ Keyboard Shortcuts was a toast that dumped
every accelerator into a notification and dismissed itself after fifteen seconds. It is now a
searchable dialog of all 87 commands grouped by menu, and every shortcut is a button: press
it, press the keys you want, done. Backspace clears one, conflicts are called out, and the
rows Electron implements natively (Copy, Paste) are shown and refused with the reason rather
than hidden.

Making that real required deleting a duplicate: the menu's accelerators and a `KEYBINDINGS`
array in the renderer were two lists of the same thing that could drift. `shared/keybindings.ts`
now resolves every chord from the menu model, so a remap moves the key, the drawn menu's
printed label, and Electron's own accelerator registration together. A conflict test over the
shipped defaults found two collisions the moment it was written — one of them pre-existing,
where `search.open` and `view.search` both claimed Ctrl+Shift+F and one of them silently
never fired.

**A missing interpreter, explained.** Pressing Run asks whether the program it needs is
actually installed before it types anything. If it is not, ADCode says which program, gives
the one-line install command for *your* platform, and offers to open the download page —
instead of `'python' is not recognized as an internal or external command`, which is written
for an operating system rather than a person and reads to a beginner as the editor being
broken. The check can be overruled: a program installed somewhere only your shell profile
knows about is real, and refusing to run on the strength of our own guess would be worse
than the message this replaces.

**Problems.** A sidebar view, badged in the activity bar, listing every error in the open
files with the compiler's sentence rewritten into one that assumes nothing. "Type 'string'
is not assignable to type 'number'" becomes "You're putting text where a number belongs",
with a suggestion under it and a Fix button when the language worker vouches for an edit.
Hovering a squiggle shows the same words in place.

The rewrite never replaces the original, only outranks it — the compiler's own text stays
on the row. That is the entire reason a translation layer is safe to ship: when the rewrite
is wrong, the truth is one glance away. The same rule makes coverage a non-issue, since an
error the table has never seen simply shows what it always would have.

**Its data source is Monaco's language workers, which means it sees open files only.** A
workspace-wide sweep needs the language server that is not built. The empty state says so
in those words rather than implying it looked everywhere.

**Live preview.** A static server over the open folder, bound to `127.0.0.1` on an
ephemeral port, with a reload script injected into every HTML response and an SSE channel
behind it. It renders in a cross-origin iframe beside the editor. It is deliberately not a
framework dev server: it does not run `npm run dev`, bundle, or resolve bare specifiers. A
promise that broad cannot be kept across every toolchain; "a static server over your folder"
can be.

**Suggestions.** Monaco already had real completions for the five languages with workers.
The other seventy it can highlight had nothing but words already typed, which is least
useful on the first line of an empty file. They now get keywords and construct snippets
from a compiled-in table — `for`, `def`, `if __name__ == "__main__"` with the body already
indented. Enter accepts, which is what was asked for, and has its own setting because it is
the one preference with a real cost: with the widget open, Enter is not a newline.

**Language servers.** Above the keyword tables, a real LSP client: one server per language,
full-text sync, completions and hover, diagnostics into the same Problems panel, restart
with backoff capped at three. `packages/lsp` holds the parts that actually break — byte
framing across chunk boundaries, zero-based to one-based conversion, URI encoding on
Windows — as pure functions, which is the only way any of them get tested at all.

No server ships in the binary. What ships is knowing how to start ten of them, and what to
say when one is missing: opening a Python file with no Pyright installed puts one `info`
row in the panel reading *"Smarter help for this language needs Pyright. Install it with:
npm install -g pyright"*. An `info`, never an error — a tool you have not installed is not a
problem with your code, and the badge is reserved for things that are. Languages nobody
bundled go in `Settings → Language → Additional language servers`, one per line as
`language: command args`, which is §4's escape hatch in place of an extension system.

**Go Live / Run.** One button in the bottom-right corner of the status bar, where Live
Server has trained everyone to look. It reads the file in front of you and says what
pressing it will do: **Go Live** on a page, **Run Python** on a script, **Run Rust** on a
crate. VS Code splits this across two controls in two places, which means a beginner has to
already know which category their file is in.

Twenty-seven languages run, from a compiled-in table of single-file recipes — `python3 x.py`,
`go run x.go`, `gcc x.c -o x && ./x`, `cargo run` when there is a `Cargo.toml`. They run in
the terminal panel, because the output *is* the feature: the traceback, the compiler error,
the exit code, and paths in that output already resolve into clickable links back into the
editor. `Ctrl+F5` and Terminal → Run Active File go through the same code path as the button.

The one judgement call is a `style.css` or a `script.js`: part of a page, or a program? It
previews when there is an `index.html` at the workspace root and runs when there is not.
Where nothing honest can be offered — a `.json`, a loose `.cs` with no project — the button
hides rather than sitting there greyed out.

**Project preview.** Alongside the static file server, the preview can run the project's own
dev script and watch its output for the address it prints, with that output kept in a drawer
— because a dev server that fails to start is the commonest wall a beginner hits, and
`Error: Cannot find module 'vite'` is worth more than anything we could write instead.

It starts on its own **only when a framework config is present**. A `vite.config.ts` means
static serving cannot work, so running the dev server is the only useful move. A bare `dev`
script means nothing of the sort — ADCode's own launches Electron and serves no page — so it
is offered in the bar and never run unasked. Pressing preview must not mean "execute an
arbitrary command".

Settings for unbuilt features are shown with an `available: false` flag rather than hidden,
so the roster stays honest about what the toggle would do.

Design decisions and the nine documented deviations from the brief are in
`docs/specs/2026-08-16-ad-core-design.md`. The build order is in
`docs/plans/2026-08-16-ad-core.md`.

## Sharing a folder, and the floating preview

Design in `docs/specs/2026-08-17-live-collaboration-design.md`.

**The preview floats.** One button in its toolbar pops the preview column out into a draggable,
resizable card and back, remembered per folder. The iframe never moves in the DOM, because
reparenting one destroys its document and reloads it — so undocking would silently throw away the
page's scroll position and any state its JavaScript was holding, on the one surface whose whole
job is showing the effect of your last edit. Only the positioning changes. `npm run smoke` proves
it by comparing the frame's node identity and `src` across the move, which is the only way a
reload is visible from outside. **Open in browser** was already there and still is.

**Live sessions.** Share the open folder with people on your network: they open and edit the
files on *your* machine, with everyone's cursor and selection drawn in their own colour, and two
people typing on the same line converge instead of overwriting each other. That last part is
`yjs`, a CRDT, and it is a dependency rather than something written here because concurrent
editing across three peers is a real distributed-systems problem whose failure mode is silent
corruption of your source.

Guests never clone anything. There is one working tree, one git state, and one place a permission
check can live — which is the host's main process, **not the guest's UI**. A greyed-out button on
someone else's computer is a hint to a cooperative peer and no obstacle to a modified one, so a
viewer's edit is refused on the host after parsing and before it reaches a document. The test
suite proves this by telling a demoted guest to send an edit anyway and asserting the file on disk
did not move.

Three roles — host, can-edit, view-only — plus one capability that is deliberately not a role:
typing into the host's terminal. It is per-person, never granted on join, revoked automatically
on demotion, and asks for confirmation in blunt words, because it is not a degree more access
than editing but a different kind. **The shared terminal itself is not built**; what is built is
the permission model around it and an honest refusal.

**This feature inverts a decision documented two sections down.** The live preview binds
`127.0.0.1` on purpose. A session cannot — a guest is on another machine — so it binds beyond
loopback, and pays for it: never on by default, behind a confirmation that says what becomes
reachable and by whom, every message carrying a session token from `randomBytes`, every
peer-supplied path checked twice, and a plain HTTP probe of the port told nothing but `426`.

**LAN traffic is not encrypted.** Anyone able to capture packets on the network sees the invite
code and then the file contents. On your own Wi-Fi that is the trust boundary the preview server
already assumes; in a café it is not. The panel says so next to the address rather than letting a
padlock-free UI imply otherwise. TLS is the fix and it is not built. Neither is a relay, so this
is same-network only — the transport is behind an interface so one can be added without touching
the CRDT, the presence layer, or the editor.

**Earnings.** A pop-up under the Problems icon showing what the ad side has actually paid: the
available and lifetime balances, and the server's own hourly projection for each frequency
preset. Built around one rule — never show a number the server did not send. There is no daily
chart and no impression counter, because neither can be built from what this machine knows: the
receipt queue is an outbox, not a history, so it reports what is *waiting to sync* and is never
labelled as ads seen. A figure the server sent is green; an unknown one is a grey dash. Payout
history needs the advertiser backend, and the panel says that instead of drawing an empty chart,
which would read as "you have earned nothing".

## Getting in and out of a project

**A welcome screen that does things.** The empty window used to say "Open a folder, pick a file,
and start editing" and then offer no way to do any of them — accurate, and inert. It now has the
`<$>` mark, the version, and four starting points: recent folders first (after the first week it
is the only one anybody uses), then Open Folder, Open File, and Clone from GitHub. The version is
there because it is what a bug report asks for, and hunting for it is where people give up and
file one without.

The container it lives in is `position: absolute; inset: 0` over the editor and stays in the DOM
when hidden, which is why it carries `pointer-events: none` — a decorative placeholder could
afford that and a screen full of buttons cannot. The two properties now sit on different
elements, and `visibility: hidden` takes the whole thing out of hit-testing while it is faded
out, so there is no state where an invisible welcome screen eats a click aimed at the editor.
Both halves are asserted in smoke, because this repository has already shipped a hidden overlay
that made the window unclickable once.

**Recent folders** are remembered on every route that opens one, *including session restore* —
which is the route that gets forgotten, and the one that matters most for someone who only ever
reopens the same project. Deduplicated case- and separator-insensitively, because `E:\Work\Proj`
and `e:/work/proj` are one folder on the platform this ships on and three rows in a naive list.

**Switching folders closes the editors.** It did not, and tabs from the previous project stayed
open pointing at files outside the folder on screen — saving one wrote somewhere the tree could
not show. Unsaved buffers have their drafts flushed before the close rather than left to the
autosave timer, since "typed something, immediately switched project" lands exactly in that gap.

**Connecting to GitHub.** `git init` leaves a repository with nowhere to push, and until now
nothing in the window could fix that: Push answered *"No configured push destination"* and
advised `git remote add`, a command a GUI cannot run. Initialising now offers to connect a
repository URL, and a **Connect to GitHub** button stays in the panel for as long as there is no
remote. The URL goes through the same guard `clone` uses — `ext::` transports turn a later fetch
into arbitrary command execution, and the check has to happen before the value is written into
the repository's config rather than when it is next used.

**The first push sets its own upstream.** `git push` on a branch that has never been pushed fails
with advice to run `git push --set-upstream origin main`. Now it just does it, but only when the
choice is unambiguous — `origin`, or the single remote if there is exactly one. Two remotes and
no upstream is a real decision, and guessing would push someone's work somewhere they did not
choose, so that case falls through to git and its message becomes the honest answer.

## The three rules that shape this codebase

**The firewall.** `packages/ads` may never import from `packages/memory`, `packages/ai`, or
`packages/collab`, in either direction. The ad side promises that nothing from the user's code
leaves the machine **through an ad request**; the AI and memory sides are full of exactly that,
and `collab` exists to send the user's source code to another computer on purpose. That last one
is the sharpest edge and the reason the promise has to be stated precisely rather than as "nothing
leaves the machine": a live session sends code to peers the user explicitly invited, and the ad
pipeline still sends nothing. Two different promises, and the document must not blur them.
`.dependency-cruiser.cjs`
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

**Ads get their own smoke run.** `npm run smoke:ads` starts a real ad server, launches the
built app pointed at it, and watches a sponsored card arrive: it asserts the toast painted
and is on screen, that its logo is an inline `data:` URL rather than a request to an
advertiser, that the serve request went out carrying real vocabulary tags and the theme the
user is actually looking at, and that the receipt came back and moved the balance. It exists
because `packages/ads` tests the ad client against fakes for the two ports the IDE supplies
— `IdeSignals` and `NotificationSink` — so a total failure on the far side of that seam
stays green. Four did: nothing answered the signals port at all, so every request was
untargeted with a hard-coded dark theme; `debugActive` was still pinned to `false` long after
the debugger landed; and the balance and remote config were read once at launch and never
again, so earnings never moved while the app was open and the kill switch needed a restart.
Unlike `npm run smoke`, only `true` passes it — a check that reports a problem as prose
fails the run rather than being printed and ignored.

**Drive at coordinates, not at nodes.** The menu bar shipped completely unclickable while its
check stayed green, because the check called `element.click()` — which dispatches straight at
a node and so cannot see that a `-webkit-app-region: drag` region was swallowing every real
press before the renderer got it. Smoke now clicks real coordinates through CDP's Input
domain, and asserts the geometry that CDP *cannot* reach: no drag region may overlap any
title-bar control, and an open menu must be the topmost thing at its own centre.

**"The icons look off-centre" was not about the icons.** Four close buttons drew their mark as
the character `×` — U+00D7 MULTIPLICATION SIGN, a maths operator that a font positions on the
maths axis rather than in the middle of the em box, so it rides high in a square button whatever
the CSS says. They are stroked paths now, drawn symmetric about (8, 8), because geometry has no
baseline. But the *measured* error was somewhere else entirely: smoke was taught to compare each
icon's centre against its button's centre in a real laid-out window, and reported `.tree-action`
off by 3px and `.tab-close` by 2.5px, horizontally only. **The user agent gives every `<button>`
`padding: 1px 6px`.** Every one of these already said `place-items: center` and every one honoured
it — centring the icon inside a *content box* that twelve pixels of horizontal padding had
narrowed to 4px, so a 9px icon overflowed it one way. The vertical padding is 1px and symmetric,
which is why the error was horizontal-only, and that asymmetry is the fingerprint no amount of
eyeballing would have produced. One `button { padding: 0 }` in the reset was the whole fix.

**A green assertion on the wrong element proves nothing, in both directions.** Two checks written
on the same day made opposite versions of one mistake. The preview's undock check called
`preview.start()` — which starts the *server* and never unhides the *pane* — so every assertion
ran against an element `[hidden]` had collapsed to 0×0, and three of them passed for that reason.
The welcome screen's check ran with a restored file open, so the screen it was hit-testing was
faded out and `visibility: hidden`, and it reported a perfectly clickable button as unreachable.
A measurement is only worth its name once you have asserted the thing being measured is on
screen: both now check `hasSize` and visibility before anything else.

**The route nobody thinks about is whichever one no user action triggers.** The README already
recorded this about language servers and session restore. It then happened three more times in a
day, and once in the exact mirror image: `openWorkspace` set the module's `workspaceRoot`
variable *directly* instead of calling `setWorkspaceRoot`, so the notification that exists to
prevent this fired on session restore and on closing a folder — but not on opening one by hand,
which is the commonest route of all. Language servers kept indexing the previous project. The
new-file and new-folder buttons and the recents list had the original version of the bug, working
everywhere except on launch. One function owns the change; the fix is that no caller gets to opt
out of it.

**A test that checks the outcome and not the message is half a test.** `git commit` with nothing
staged had a test asserting it failed. It passed throughout, while what the user actually saw was
`Command failed: git commit -m ood` — Node's own string, not git's. The assertion was true and
useless.

**A passing unit test is not a working keystroke.** Alt used to open the menu bar on
*keydown*, which broke every Alt chord the Selection menu owns — Alt+Up, Shift+Alt+Up,
Ctrl+Alt+Up — because the `Alt` keydown always arrives before the key it modifies, so the bar
opened and pulled focus off Monaco while the arrow walked a menu. Moving the decision to
keyup fixed the logic, and sixteen unit tests over `altMenuActivation.ts` all passed while
the app stayed just as broken: Monaco calls `stopPropagation()` on every key it handles, so a
bubble-phase listener never saw the `ArrowUp` that made the press a chord. The tracking has to
run in the **capture** phase. Only `npm run smoke` dispatching real key events found that.

**One call site is never the place to notice something changed.** Language servers are
per-workspace, so `setLspWorkspace` was called from the two IPC handlers that change the
open folder. There is a third route nobody thinks about, because no user action triggers
it: session restore, on launch. The result worked perfectly when you opened a folder by
hand and did nothing at all on every launch after the first — which is the ordinary case.
`onWorkspaceRootChanged` now fires from `setWorkspaceRoot` itself, so the notification
cannot be missed by whoever adds the fourth route.

**A panel full of true statements can still be worthless.** The Problems panel passed 35
unit tests and then opened, in the real app, showing twenty-five errors across three files —
in `tsconfig.json`, which is JSONC and is allowed its comments; and in `vitest.config.ts`,
where every `import` failed because a language worker in a browser has no `node_modules` to
resolve against, and every modern expression failed because Monaco's stock compiler options
are ES5 and CommonJS. Each diagnostic was a true statement about the worker's world and a
false one about the user's. That is worse than showing nothing: one false alarm on a file
they did not write teaches a beginner to ignore the panel, and after that the real error is
invisible too. `languageDefaults.ts` exists to suppress only what is unanswerable by
construction, and only `npm run smoke` could have found any of it.

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

It is a function of runtime state rather than a constant, because one part of it — the
recent folders — is not knowable when the module loads. Both consumers rebuild: the main
process when the list changes, the renderer when a folder is opened. Rows that act on
something carry an `arg` (a folder's path) rather than getting a command id each, so ten
recents do not become ten entries in the command palette.

Keyboard navigation is Windows': Alt focuses the bar and underlines the mnemonics without
opening anything, Alt+letter opens the menu that claims it, arrows walk both axes, Home and
End go to the ends, and a letter typed in an open menu runs its row when only one row claims
it. Which row a keystroke lands on is decided by `menuKeyboard.ts`, which is pure and
tested; the bar itself only owns the DOM.

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
