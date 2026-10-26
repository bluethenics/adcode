# Changelog

All notable changes to ADCode. Dates are the date the version was prepared; a version is
only public once its installers are attached to a GitHub release.

## 2.4.2 — 2026-10-27

- **Update now.** A new-version notice offers Update now or Later, with background download progress. On Windows, an explicit update protects unsaved work in every window, closes ADCode, shows installation progress and opens the updated app automatically. Store and portable users get the appropriate update destination.
- **AI plans and tokens.** Heabsy models include 10M free tokens each week. Weekly ($3/week) and Monthly ($9/month) raise that to 60M/week; Pro ($19/month) gives 150M/week. One-time packs never expire and are used after the weekly allowance. The composer meter, AI usage and Upgrade Plan action make the balance and next step clear. Tagflow AI keeps its existing free access.
- **Codes and invitations.** Redeem promo codes for tokens or plan days. A Pro subscriber can invite two friends; each friend's first eligible subscription rewards both accounts with 4M tokens while the inviter's Pro plan is active. Administrators can gift plans, boost allowances and reset eligible weeks, including bounded batches with retry.
- **Provider connections.** Administrators can connect compatible documented ad-serving and event-verification APIs with encrypted keys and per-network payout rules. Imprezia and beehiiv have clearly marked previews; these previews do not bill desktop impressions or promise earnings.
- Busy included models hand off to an available fallback promptly. Interrupted or cancelled answers finish cleanly with a readable error, and valid final answer data is preserved. A task paused by an account allowance rechecks soon after the allowance changes; real provider throttling remains distinct.
- Account changes during a task are explained, temporary failures use bounded retries, and settings and automation schedules recover from redirected Windows folders. File watching falls back when a native watcher fails. Checklist compatibility and repeated-tool-failure recovery are improved.
- Scroll overflowing chat tabs with the mouse wheel. Update preparation can be retried safely after a window refuses to close.
- Updated Electron, Next.js, DOMPurify and affected dependencies to patched versions. Release preparation supports fresh daily patch versions, and release checks verify installer metadata and the installed Windows upgrade before producing a draft.

## 2.4.1 — 2026-10-26 (build withheld)

- **Update now.** A new-version notice offers Update now or Later, with background download progress. On Windows, an explicit update protects unsaved work in every window, closes ADCode, shows installation progress and opens the updated app automatically. Store and portable users get the appropriate update destination.
- **AI plans and tokens.** Heabsy models include 10M free tokens each week. Weekly ($3/week) and Monthly ($9/month) raise that to 60M/week; Pro ($19/month) gives 150M/week. One-time packs never expire and are used after the weekly allowance. The composer meter, AI usage and Upgrade Plan action make the balance and next step clear. Tagflow AI keeps its existing free access.
- **Codes and invitations.** Redeem promo codes for tokens or plan days. A Pro subscriber can invite two friends; each friend's first eligible subscription rewards both accounts with 4M tokens while the inviter's Pro plan is active. Administrators can gift plans, boost allowances and reset eligible weeks, including bounded batches with retry.
- **Provider connections.** Administrators can connect compatible documented ad-serving and event-verification APIs with encrypted keys and per-network payout rules. Imprezia and beehiiv have clearly marked previews; these previews do not bill desktop impressions or promise earnings.
- Busy included models hand off to an available fallback promptly. Interrupted or cancelled answers finish cleanly with a readable error, and valid final answer data is preserved. A task paused by an account allowance rechecks soon after the allowance changes; real provider throttling remains distinct.
- Account changes during a task are explained, temporary failures use bounded retries, and settings and automation schedules recover from redirected Windows folders. File watching falls back when a native watcher fails. Checklist compatibility and repeated-tool-failure recovery are improved.
- Scroll overflowing chat tabs with the mouse wheel. Update preparation can be retried safely after a window refuses to close.
- Updated Electron, Next.js, DOMPurify and affected dependencies to patched versions. Release preparation supports fresh daily patch versions, and release checks verify installer metadata and the installed Windows upgrade before producing a draft.

## 2.4.0 — 2026-10-21

- **The assistant uses ADCode for you.** Ask it to connect a tool such as Roblox Studio, change a setting or open a view, and it does it instead of telling you where to click. It looks ADCode's own features up before it answers, and asks first for anything that changes ads, updates or what runs as a command. Roblox Studio is in the Connectors catalogue.
- Calmer chat: quieter composer, spacing and motion in the conversation, the timeline and the live agents window.
- **A new look for the Vibe window.** An icon rail on the left for Chat, Agents, Tools, Changes, Preview and Automations; a sidebar card with your project and chats; and a tab for each open chat along the top. New type throughout (Manrope, Space Grotesk, Geist Mono), quieter borders, and small, quick motion that stays still when you ask for reduced motion. The app's menus open from the button beside the ADCode name. The IDE window is unchanged.
- **Chats keep working in the background**, several at once. A spinner in the chat list (and on its tab) shows which are working, and a dot marks one that finished while you were elsewhere.
- **Each answer is a timeline**: what the assistant read, ran and changed, step by step, folded once it is done.
- **Helpers.** The assistant can split a big job across up to four helper agents that work at the same time, each with a fresh context: explore helpers read, build helpers change files. Their progress shows in the conversation, Undo covers their edits and Stop stops them all. Ask with `/helpers`.
- **AGENTS.md.** The assistant follows your project's `AGENTS.md` (and `CLAUDE.md`, `GEMINI.md`, Copilot instructions, and your own `~/.adcode/AGENTS.md`). `/init` writes one for your project.
- **Rules and hooks for agents.** Allow, ask or deny tools per command and path, and run your own hooks before and after tool calls, from `.adcode/settings.json`.
- **Prompt caching** keeps long agent runs cheaper and faster on providers that support it; cached tokens show in AI usage.
- **Connectors**: MCP servers, Claude Desktop extensions, Claude Code plugins and OpenAI-style actions can be added from Tools → Connectors.
- **Included AI** has no ADCode usage limit, and the model menu lists every included model rather than the first three.

## 2.3.2 — 2026-10-14

- A dropped connection no longer ends a free AI task. The request is retried inside the same turn for about two minutes, with a status line and Stop, and completed tool steps are not repeated. If the connection stays down, the message names the network error.
- A network drop while ADCode refreshes your sign-in no longer asks a signed-in person to sign in again; it is retried like any other dropped connection.
- While agents are working, their live card moves down with the conversation and stays just below the newest message instead of being left above it.
- Bold text that starts or ends with inline code (`**`fitLine` was broken**`) renders as bold instead of showing the asterisks.

## 2.3.1 — 2026-10-13

- Slash commands typed with words (`/fix the login bug`) now work exactly like commands picked from the menu, and `/new hello` starts a fresh chat and sends "hello". Messages and history titles show the command you typed; only the model receives the full instruction.
- `/review` and `/commit` send as soon as they are picked, and `/team` with no task waits in the composer for one. The composer hint mentions `/` and `@` again and no longer gets stuck after a fast send.
- Images and files attached to a message stay visible after sending, and attachment names no longer appear in history titles.
- The **Edited files** card with Undo shows at full size in long conversations, and reopening a chat from History restores its card and Undo state.
- Local models (Ollama) get a smaller core toolset, a list of the project's files, and a lower temperature, and a tool call written as text is run when it names a real tool. Every edit stays undoable.
- Answers render Markdown tables as real tables, and the main assistant shows its edit activity while a file is being written.
- A first message to free AI before signing in no longer says your "key" was rejected. The chat offers **Sign in** with Google or GitHub, and sends the message again by itself once you are signed in.
- Partner models with their own daily allowance, such as Heabsy, show that allowance in the composer meter and AI usage, and a limit message says which allowance ran out.

## 2.3.0 — 2026-10-12

- Agent activity now scrolls inside the conversation instead of occupying a fixed panel above messages. Solo runs use a compact status card with the same Stop controls.
- Edited files appear in a themed summary with per-file added and removed lines, expandable file rows, recorded diffs and conflict-aware Undo. Malformed tool arguments recover literal JSON line breaks safely; incomplete calls retry as smaller edits without writing partial files.

- Free AI includes 1,000,000 tokens per account per day and unlimited request counts. The usage view separates the daily balance from local history, and explains repeated input context and estimated counts. Allowance reservations and context checks now use the same token estimate, then settle against provider-reported usage.
- Chats and agent runs wait for recoverable free AI limits and resume automatically at the reset time while ADCode stays open. Stop cancels the wait; completed tool operations are not replayed.
- Switching models carries the conversation, compacted summary and completed tool results to the new model. Selecting another model during a limit wait continues the pending task.
- Privileged database functions are restricted to the server role, with fixed search paths. Public clients cannot call balance or administrative functions directly.
- Admin provider reports cover every free model: demand, usage, distinct and returning accounts, peak load, reliability, response speed and voluntary feedback, with full HTML/PDF, CSV and JSON exports. Audience tables include network country, optional user role and experience, AI assistant persona, workflows, declared purpose and desktop platform, with coverage and unknown groups. Users can opt into or remove a profile in AI usage. Tagflow Code 27B uses its owner-confirmed 256k context window. Model-level collection starts October 11; older account totals are not presented as model history.
- Included AI response ratings can include an optional comment. Provider reports include comments only with explicit user permission; conversations and project files are never attached. The privacy policy dated October 11 explains the new operational metadata and feedback.
- Included Tagflow AI is selected by default for new users and older unconnected default profiles. Sign in with a verified account to use the included allowance; existing connected providers stay selected.
- Connect a model separates **Free · no API key** from **Bring your own key**. Admin manages both catalogs, including new models, defaults, availability and per-account limits. Supported server connections are Tagflow, OpenAI, Gemini, Groq and OpenRouter.
- AI usage adds a yearly activity calendar, current and longest streaks, active days, and account allowance meters. Daily details are accessible by pointer and keyboard; live updates keep focus and scroll position.
- Agent cards separate model and tool access, use consistent actions, and fit smaller windows. Starter specialists appear before model discovery and follow the current model; their editor can also pin a fixed model.
- Edit an agent or revise and delete a stopped run directly from its card or popup. Active runs must be stopped first, and deleting a run preserves changes already applied to the project.
- The chat composer shows separate circular meters for context, Included AI allowance and requests. Personal providers and local models show recorded usage without inventing account limits.
- Included AI distinguishes oversized context, unsupported images and unavailable models. Valid coding tool loops no longer fail because byte size was mistaken for token count, and failed plans stop showing an active spinner.
- When Included AI cannot read a browser screenshot, the assistant explains that limitation and continues with the tool's text findings instead of failing the turn.
- Failed file edits return the current text and a precise recovery read, so the assistant can retry with a correct match. Permission errors no longer look like missing files.
- Quality tools discover and run the project's existing checks, and audit local pages at phone, tablet and desktop widths. Product design guidance covers visual hierarchy, interaction states, accessibility, restrained motion and release verification.
- The editor bundles DOMPurify 3.4.16 with its latest sanitization fixes. Release security checks include dependencies that ship in the app even when they are listed as development tools.
- Google and GitHub account pages use the current ADCode logo, clearer status and accessible layouts. Google waits for the token exchange before confirming approval; GitHub opens completion after the account connects, and respects cancellation and code expiry.
- Motion preferences cover decorative transitions and animations across the app.
- The website introduces founder Sinan Faizal Bayan and ADCode’s mission, with a **Talk to the team** booking link.
- See [the new feature guide](docs/features/ai-activity-and-free-models.md) for usage, privacy and administrator setup.

## 2.2.0 — 2026-10-09

- Watch your agents work. When the assistant writes a file, a live window in the
  conversation shows the code typing in as the model writes it, then the command it runs
  and its output, the files it touched, and whether it checked its work: Checks passed,
  Check failed or Unverified, from the commands it actually ran - never from what it says.
- Every agent at work gets a window. Agents from the Agents page, a Team, a race or Team in
  the terminal appear in a live room above the chat, their mascots side by side. When one
  agent messages another, hands its work on, or edits a file a teammate already changed, a
  speech bubble crosses between them and the line stays underneath. Settings > AI > Live
  agent view turns it off.
- Team agents talk while they work: they message each other, receive messages with their
  next step, and hear when a teammate already edited the same file. They share the
  project's memory, keep a plan, and run the project's checks before they report done.
- A first run that builds something: pick an idea, connect a free AI, and ADCode makes the
  project and opens it running in the preview. Sponsored cards wait until something has
  worked.
- Continue reopens a project on the conversation it was left on. Follow-ups typed while the
  assistant works wait their turn, and the model chip under the composer switches model.
- When a turn stops because a model is out of credit, rate-limited or gone, choosing
  another model carries the turn on from where it stopped.
- The models on the list work: fixes for each provider, room for a longer answer when a
  reply is cut off, the recommended model first, and an honest Ollama status. Continue can
  no longer loop.
- The chat reads like prose, with one spacing for the whole conversation, and the parts of
  Vibe that popped in now move.
- The sponsored card shows your share of it, has a real button, and its countdown waits for
  you.
- Invite & earn: your invite link, who joined and what it earned. Someone who installs from
  your link has the invite picked up from their clipboard when ADCode first starts.
- The assistant sees the app you are building. It opens any page of your live preview in a
  browser of its own, clicks and types through it, and reads the console, failed requests,
  broken images and the layout at phone width - with a screenshot - before it says a page
  works. Type /check, or run AI: Check My Running App, to have it look over the app and fix
  what is broken.
- "Open the about page" opens the about page: the preview goes to the page the assistant
  names and waits for a framework's dev server to start. The preview's address bar takes a
  path - type /about.html and press Enter.
- The assistant can delete, move and rename files, and Undo puts them back. Dev servers
  keep running in the background while it works, commands may run for up to ten minutes
  and report their real exit code, and Stop ends a command and everything it started.
- For bigger jobs the assistant keeps a Plan checklist in the chat. Its search shows the
  lines around each match, its edits survive an indentation mismatch, and documentation it
  reads arrives as clean text.
- A commit asks for the name and email it needs instead of sending you to a terminal.
  Ctrl+V in the terminal no longer pastes twice, and commands that quote a path with a
  space work on Windows.
- Connect an external agent works in installed builds: the project-memory server ships with
  the installer and is copied to ~/.adcode/mcp, so its command survives updates. The
  command says it needs Node.js 22.13 or newer, and on Windows ADCode says when Node is
  missing or too old.
- Search, Ctrl+P and the assistant's file tools skip agent worktrees and folders your
  .gitignore leaves out, and never open an image to search it.
- One identity per install: no second account from a retried sign-up, and no new account
  when the server has a bad moment.
- A report that leads to a fix gets a thank-you, and Microsoft Store users who are enjoying
  ADCode may be asked, once, for a rating.
- ADCode runs on Electron 43.7.9, and the project-memory server and other bundled
  dependencies carry the latest security fixes.
- ADCode is open source under the Apache License 2.0. The repository has a licence, a
  notice, a trademark policy, a contributing guide, a security policy and CI for pull
  requests. Help > Open Source Licences shows ADCode's licence, its notice and the licence
  of every package built into it; installers carry the same files under
  `resources/licenses`. The website's terms now say the source code is governed by the
  Apache licence.

Known limitations: macOS builds remain unsupported, and the portable build still does not
update itself. The assistant deletes and moves files only when AI edits apply
automatically. Agent CLIs in Team in the terminal show their output live but cannot be
messaged mid-task.

## 2.1.1 — 2026-09-29

- Updates you can see: while a new version downloads, the status bar shows its progress;
  when it is ready it reads Restart to update, and one quiet card offers Restart now or
  Later - once per version, never while you are typing, and in one window only.
- Restart now writes a recovery draft for anything unsaved first, installs silently and
  reopens ADCode. Later, or ignoring it, installs the update when you next close ADCode.
  Restart to Update is also a command, and the Feature library finds it.
- The first update check runs 10 seconds after launch instead of 45, so a short session
  still finishes the download.
- Small updates work again after a manual install: a cached blockmap that no longer
  matched the installed version sent every update down the full 115 MB path. ADCode now
  notices the mismatch and lets the updater fetch the right one.
- Why an update failed is now recorded in the debug log that Help > Report a Problem
  sends, instead of being thrown away.
- Restart now is offered on Windows. On Linux a ready update says so and installs when
  you close ADCode. With crash recovery switched off, ADCode asks you to save before it
  restarts, because nothing would be offered back.
- The portable build no longer runs the updater, which used to install a second, ordinary
  copy of ADCode as the portable one closed.

Known limitations: macOS builds remain unsupported, and the portable build still does not
update itself.

## 2.1.0 — 2026-09-28

- Agents page: every run is a box on a board - Needs you, Working, Ready - with its
  agent's mascot, live status, spend and actions. Five starter agents (Reviewer,
  Tester, UI polish, Bug fixer, Docs writer), agents of your own with a model, tool
  access and a usual cost cap, and several running at once (three by default).
- Proof of work on every finished box: the tests, type checks and linters the agent
  actually ran, and warnings for a possible secret, sign-in or payment code, removed
  tests, new dependencies or a very large change. With Apply automatically on, a
  failed check or a possible secret holds the run for you instead of applying it.
- Stuck and collision guards: an agent repeating the same failing step is stopped and
  offers Try another way; two agents editing the same file both warn you.
- Race mode: give one task to two or three agents, compare their work side by side
  with proof and cost, and keep the best - the other lanes are discarded.
- Point-and-fix: pick an element in Preview with Inspect and choose Change this with
  AI; the task knows exactly which element you mean.
- Tools page: ADCode's built-in tools, MCP servers (with a one-click catalogue of
  servers that need no credentials), skills, and an editable project memory.
- No right sidebars: the IDE assistant, Preview, Changes, Project overview and
  Activity float as panels you can move, resize from any edge and maximise.
- Long chat memory: reopening a conversation, restarting ADCode or switching model no
  longer forgets the conversation - the assistant carries on where you left off.
- Auto-compact: when a chat nears the model's context size (80% by default), ADCode
  summarises the older part with the same model and keeps the newest turns word for
  word. A meter beside the composer shows how full the context is; /compact (with an
  optional focus) and Compact now make room on demand, and View summary shows what is
  carried forward. Long Agents-board runs compact the same way instead of stopping.
- Motion: Vibe moves with some life - boxes glide between columns and celebrate a
  finished run, mascots blink, pages slide, panels grow out of what opened them, new
  messages rise in and streamed text fades up. Code stays crisp. Everything respects
  the system's reduce-motion setting and ADCode's own Reduced motion switch.
- The bundled model catalogue is refreshed to 2026-09-28 and now records each
  model's context size.
- Ad views count correctly: a sponsored card appears in one window only instead of
  both the Vibe and IDE windows, and moving between the two windows no longer breaks
  the "focused for the whole time" rule, so a view you really saw reaches the
  advertiser.
- Advertiser reports on the website no longer count admin delivery tests as verified
  views costing $0.00; views, clicks and spend now agree.
- Opening a campaign's row in the advertiser portal no longer crashes the report.
- Website: comparison pages no longer 404 when the cache misses, and the home page's
  product images load lighter.

Known limitations: macOS builds remain unsupported. Context sizes come from the
catalogue; models it does not list are assumed to read 128k tokens. Token counts on
the meter are estimates.

## 2.0.0 — 2026-09-24

- Vibe assistant toolset: find files by pattern, outline a file's symbols, run tests and
  typechecks inside the task sandbox, and fetch documentation pages. Listing and search
  accept the workspace root in every spelling, large reads page, and the assistant does
  the work with sensible defaults instead of interviewing you first.
- Task token budget is Unlimited by default, so tasks never pause for tokens; the strip
  still counts spend, and a 25k/100k/250k cap stays one switch away. Hitting a cap you
  set offers removing it, raising it, or starting fresh, right in the chat.
- Every proposed file announces itself in the conversation with what changed and where
  to apply it, so created files are never silently waiting in the task workspace.
  Code mode raises its own review toast that opens the changes view.
- Unsaved files no longer brick the assistant with a bare error: the block names the
  files, and the chat offers saving them or answering anyway without file tools.
- The assistant never claims it created or saved a file - proposals stay proposals
  until you apply them.
- The assistant changes existing files with exact replacements instead of rewriting
  them, reads several files in one parallel step, and works up to 50 steps per request.
  If a long task stops at a limit, a Continue button picks up where it stopped.
- Code mode gains inline AI edit: select code, press Ctrl+E, describe the change, and
  accept or reject the highlighted rewrite in place. Ctrl+L adds the selection to the
  conversation as a chip.
- The composer understands / commands (/review and /commit attach the real uncommitted
  diff; /fix, /test, /plan, /refactor, /explain, /optimize, /security, /docs and /build
  write the careful prompt for you) and @ file mentions with unsaved editor text.
  Empty-composer Up arrow recalls earlier prompts.
- Every message carries editor context: the file on screen, cursor, selection, open
  tabs, and reported problems - so "fix this" just works.
- Connect a model walks you through three live steps with a progress bar, pins popular
  providers first, marks the recommended model, and offers thinking effort (Auto to Max)
  for reasoning models from OpenAI and Anthropic. Custom endpoints get a numbered guide
  and an explicit save. The bundled model catalogue is refreshed to 2026-09-24.
- Clipboard copy and paste go through Electron first, so chat, settings, key paste, and
  the preview inspector stop failing silently.
- Vibe mode is restored after a restart, its sidebar drags wider or narrower, and
  switching modes fades instead of jumping. History and Inspector float over the
  conversation as popups with a click-to-dismiss dimming.
- Code mode top bar, assistant dock, and composer refined: wrapping toolbar, visible
  keyboard focus, an honest model pill with chevron and ready dot, and pill-shaped
  starter actions.

Known limitations: thinking effort applies to reasoning models from OpenAI and Anthropic
only and is never sent to local Ollama; macOS builds remain unsupported; Claude Sonnet
5.5 and Haiku 5.5 were announced but unreleased at preparation time.

## 1.0.4 — 2026-09-24

- Make Check for Updates perform a fresh check, including when automatic checks are off, and report a downloaded update instead of incorrectly calling the installed version current.

## 1.0.3 — 2026-09-24

- Show sponsored messages in the Vibe sidebar when there is room, with the existing notification placement as a fallback. The same local frequency limits and impression rules apply in both modes.
- Tighten sent-message spacing in Vibe, expose conversation actions in its sidebar, and add direct Assistant and Terminal controls in Code mode.
- Include the unreleased 1.0.2 default-setting changes in the next public installers.

## 1.0.2 — 2026-09-20

- Quiet by default: format on save, auto-save, AI inline completion, the inline error
  lens, sticky scroll, the minimap, and Enter-to-accept no longer switch on for a fresh
  install. Saving never rewrites a file uninvited; Shift+Alt+F still formats on demand.
- Help entries, guides, and generated docs now describe those seven as opt-in.

## 1.0.1 — 2026-09-13

- Update assistant messages with formatted code, copy actions, and grouped conversation history.
- Pass the Google Desktop OAuth credential into release builds and stop packaging when it is missing.
- Generate the syntax-highlighting runtime and grammars before packaging, including on clean CI runners.
- Exclude ADCode's internal tool and build cache from workspace file and symbol searches.
- Prevent hidden editor splitters from intercepting welcome-screen buttons after all files are closed.
- Add terminal uninstall commands and production analytics verification instructions.
- Surface the terminal uninstall commands on the website's versions page.
- Wait for the restored editor before beginning desktop startup smoke assertions.
- Make descriptive desktop smoke failures fail the run and update checks for the current editor panels.

## 1.0.0 — 2026-09-10

### Release refresh

- Consolidates the current desktop work and all branch histories into the 1.0.0 candidate.
- Adds clickable code references in assistant replies and copying Markdown links to editor lines.
- Updates terminal installation instructions and verifies the selected Windows or Linux package before installation.
- Updates dependencies to address the reported critical and high-severity production advisories.
- Requires typechecking, architecture checks, tests, and the production security audit before release builds.

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

### Initial release contents (2026-08-30)

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
