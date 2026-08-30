/**
 * Blog posts.
 *
 * Two sources, in order: the API, where the admin panel writes them, and a small set of
 * files in this repo as a fallback.
 *
 * The fallback is not a hedge - it is what keeps the marketing site standing when the
 * API is down or not yet deployed. A blog that 500s because a backend is unreachable is
 * worse than one showing three slightly old posts, and search engines punish the former
 * far more than the latter.
 *
 * Reads are revalidated rather than cached forever, so publishing from the admin panel
 * appears without a deploy.
 */
import { API_ORIGIN } from "./site";

export interface Post {
  slug: string;
  title: string;
  description: string;
  published: string;
  updated?: string;
  readingMinutes: number;
  body: string;
  /** Where this appears. Absent on the bundled posts, which are blog-only. */
  surface?: "blog" | "docs" | "both";
  /** Docs sidebar group. Only meaningful when the surface includes docs. */
  section?: string;
  order?: number;
  related?: string[];
}

interface PostSource {
  slug: string;
  title: string;
  description: string;
  published: string;
  updated?: string;
  body: string;
  /** Set when the piece belongs on a surface other than the blog alone. */
  surface?: "blog" | "docs" | "both";
  /** Docs sidebar group. Only meaningful when the surface includes docs. */
  section?: string;
  order?: number;
  related?: string[];
}

/** How long a published post may be stale on the public site. */
const REVALIDATE_SECONDS = 60;

const SOURCES: readonly PostSource[] = [
  {
    slug: "installing-adcode",
    title: "Installing ADCode from a terminal",
    description:
      "One command on Linux or Windows: what it verifies before it runs, where things land, and how to update or remove the editor afterwards.",
    published: "2026-08-30",
    surface: "docs",
    section: "Start here",
    order: 0,
    related: ["getting-started-with-adcode"],
    body: `
ADCode installs from one command. This page is the whole of it: what the command does, where things land, and how to look after the editor afterwards.

## The command

**Linux**

    curl -fsSL https://adcode.bluethenics.com/install.sh | sh

**Windows**, in PowerShell

    irm https://adcode.bluethenics.com/install.ps1 | iex

**macOS is not published yet.** Signing and notarising a macOS build needs a paid Apple Developer membership, and an un-notarised app is not merely warned about - macOS refuses to open it. Rather than hand you a file your machine will reject, the installer says so and stops.

## Why the terminal is the better route today

ADCode's installers are not code-signed yet, and on Windows that would normally mean the "Windows protected your PC" dialog, which hides the Run button behind More info.

That dialog fires on the Mark of the Web - a zone tag Windows attaches to files a *browser* downloaded. A file fetched by \`Invoke-WebRequest\` does not carry it, and ADCode installs per-user, so it asks for no administrator prompt either. The terminal install is not a way around a warning; it is the route that does not produce one.

## What the script actually does

Worth knowing, because you are piping it into a shell:

1. Asks GitHub for the latest release.
2. Picks the artifact for your platform - a \`.deb\` where \`dpkg\` exists, an AppImage otherwise.
3. Downloads it into a private temporary directory.
4. Verifies it against the checksum published with the release. A tampered mirror or a truncated download is caught before anything runs.
5. Installs it, and prints what to do next.

If the checksum does not match, nothing is installed and the file is deleted.

## Where it lands

- **Debian and Ubuntu** - an ordinary package, with \`adcode\` on your PATH.
- **Other Linux** - the AppImage goes to \`~/.local/bin/adcode\`. If that is not on your PATH the script says so, and how to add it.
- **Windows** - a per-user install, in the Start menu and on your PATH as \`adcode\`.

## Using it

- \`adcode\` opens the editor.
- \`adcode open .\` opens it on the current folder.
- \`adcode help\` lists every command.

The editor's Help menu has a Feature Guide listing every feature with what it is for and how to reach it. That is the fastest way to find something you suspect exists.

## Updating

ADCode updates itself. New versions download quietly and apply the next time you start it - it will not restart itself and will not interrupt you to ask.

To update by hand, run the install command again. To stop automatic updates, turn them off in Settings, Updates.

## Removing it

- **Debian and Ubuntu** - \`sudo apt remove adcode\`
- **AppImage** - \`rm ~/.local/bin/adcode\`
- **Windows** - Settings, Apps, Installed apps, ADCode

## Options the scripts honour

Set these before running if you need to point the installer elsewhere:

- \`ADCODE_SITE\` - the site the script names in its messages.
- \`ADCODE_GH_OWNER\` and \`ADCODE_GH_REPO\` - the repository releases are fetched from.

## If something goes wrong

**"is not on your PATH"** - the AppImage installed correctly and your shell cannot find it. Add \`~/.local/bin\` to your PATH, or run it by full path.

**dpkg reports missing dependencies** - the script already runs \`apt-get install -f\` to resolve them. If it still fails, use the AppImage from the [downloads page](/versions) instead.

**The checksum did not match** - nothing was installed, and this is worth telling us about at [support](/support). It means the file you received was not the file that was published.

**No release for your platform** - check [what is published](/versions). Linux arm64 has no build yet.

## One thing to know about ads

ADCode shows an occasional sponsored card while you work, and credits you half of what it pays. That is how a complete IDE is free.

You can turn ads off entirely in Settings, Ads and Earnings, and the editor stays complete - nothing is withheld behind them.
`,
  },
  {
    slug: "why-the-ledger-is-append-only",
    title: "Why the ledger is append-only",
    description:
      "An administrator who can edit a balance is an administrator who can steal from you. Here is how ADCode makes that structurally impossible rather than merely discouraged.",
    published: "2026-08-18",
    surface: "docs",
    section: "How ADCode works",
    order: 1,
    body: `
Most systems that owe you money store a number and update it. A credit arrives, the number goes up. A correction arrives, the number goes down. The number is the truth, and the history — if there is one — is a log written alongside it, for support staff to read when someone complains.

That design has a problem nobody likes to say out loud: **the person running the system can change what you are owed, and the only record of the change is one they also control.**

## What ADCode does instead

Every event that moves money is a row. Rows are never updated and never deleted.

- An ad you viewed writes an \`impression\` row with the exact amount.
- A clawback writes a \`reversal\` row that points at the row it reverses.
- An administrative correction writes an \`adjustment\` row carrying a reason and the identity of the administrator who made it.

Your balance is not stored as an authority. It is a fold over your rows — add them up and that is what you have. There is a cached copy for speed, and when the cache and the rows disagree, **the rows win** and the cache is rebuilt.

## Why reversals instead of edits

If a credit turns out to be fraudulent, the obvious fix is to delete it. We do not, because a deleted row is indistinguishable from a row that never existed, and that is precisely the ambiguity a person disputing their balance cannot resolve.

Instead you see both rows: the original credit, and the reversal that took it back, with the reversal naming what it reversed. You can disagree with the reversal. You cannot be confused about whether it happened.

## The part that makes it real

None of this matters if there is a back door. So there is no operation in the system that edits a ledger row — not in the API, not in the admin panel, not for anyone. The absence of the feature is the guarantee.

And because administrators can still *read* your history, every administrative read of another person's ledger writes its own audit row: who looked, at whom, when.

## What you can check yourself

Open the earnings view in the editor, or the dashboard on the web. The rows you see are the rows the system has. The description you read — \`Ad from Vercel, 4.2s\` — is generated once, on the server, and shown identically to you and to us. There is no internal view with different numbers in it.
`,
  },
  {
    slug: "what-an-ad-supported-editor-owes-you",
    title: "What an ad-supported editor owes you",
    description:
      "Four commitments ADCode makes about when ads appear, what leaves your machine, and what you get paid — and how each one is enforced rather than promised.",
    published: "2026-08-18",
    surface: "docs",
    section: "How ADCode works",
    order: 0,
    body: `
"Ad-supported" has earned its reputation. It usually means the product is worse on purpose, and that the thing being sold is you.

We think an ad-supported editor is defensible, but only if it commits to a few things and then actually enforces them. Here is what ADCode commits to.

## 1. Ads stay in the corner, and stay out of the way

A sponsored card appears in the corner of the window while you work. It never takes focus, never covers the editor, and never blocks a keystroke — you can ignore it completely and it will leave on its own.

It does not appear during a debug session, when the window is not focused, in the first minute after launch, or twice in a row without a gap.

That focus rule matters more than it sounds: an ad shown to an unfocused window is one nobody saw, so paying for it would be fraud against the advertiser and showing it would be noise for you. It is simply not served.

An earlier version of this page said cards also wait for you to stop typing. They do not, and they never did — the scheduler has no typing rule in it. We have corrected the claim rather than quietly leave it standing: a card that only ever arrived once you had stopped working would be a card shown to somebody who had already left, and that is not a promise worth keeping even if we had built it. These rules are the ones actually evaluated, in a fixed order, in the editor's scheduler.

## 2. Your code stays on your machine

Targeting uses a closed list of 45 generic tags — the language and framework currently open. \`lang:rust\`. \`fw:react\`. \`tool:docker\`. That is the entire vocabulary, and it cannot be extended by a server response.

File contents, file paths, and project names never leave the machine. Not hashed, not truncated, not "anonymised". They are never sent.

## 3. You get a real share, stated plainly

Advertisers compete in a second-price auction starting at $1.00 per 500 impressions. You get 50% of the winning ad's clearing price, credited to your ledger when the receipt is verified.

At the default cadence of six cards an hour, that is about **$0.024** for an hour of active editing.

We would rather print that number than let you discover it. ADCode is a way to use a capable editor for free with some money coming back. It is not a way to earn a living, and any product in this category telling you otherwise is doing arithmetic it hopes you will not repeat.

## 4. You can turn it down, or off

Cadence is a setting: off, light, standard, or max. Off means no ads and no earnings, and the editor is otherwise identical — no nag screens, no reduced features, no countdown to a paywall.

The server can make the limits *stricter* than your setting. It can never make them looser. A compromised or misconfigured server cannot be used to flood you with ads, because the client refuses any configuration more permissive than the one it shipped with.
`,
  },
  {
    slug: "how-targeting-works-without-reading-your-code",
    title: "How targeting works without reading your code",
    description:
      "Advertisers want to reach Rust developers. ADCode makes that possible with 45 tags and nothing else — no file contents, no paths, no project names.",
    published: "2026-08-18",
    surface: "docs",
    section: "How ADCode works",
    order: 2,
    body: `
An advertiser selling a Postgres product wants to reach people writing backend code, not people writing shaders. That is a reasonable thing to want, and serving it badly is how ad systems end up reading everything.

## The whole vocabulary

ADCode's editor derives tags from what you have open, drawn from a fixed list of 45:

- **Languages** — \`lang:rust\`, \`lang:typescript\`, \`lang:python\`, and 18 more.
- **Frameworks** — \`fw:react\`, \`fw:django\`, \`fw:rails\`, and 8 more.
- **Tools** — \`tool:docker\`, \`tool:cargo\`, \`tool:terraform\`, and 6 more.
- **Platforms** — \`platform:web\`, \`platform:backend\`, \`platform:mobile\`, \`platform:desktop\`.

That is the complete list. It is compiled into the editor, and the server cannot add to it. A tag the server does not recognise is dropped; a tag the *client* does not recognise was never sent.

## What the server receives

A request for an ad contains the tags, whether your theme is light or dark, and how many cards to return. That is all of it.

It does not contain a filename. It does not contain a repository name. It does not contain a line of code, a symbol, an error message, or a commit. There is no field in the request where those could be put.

## Why this is enough

An advertiser targeting \`lang:rust\` reaches people with Rust open. That is a better signal than most ad networks manage from far more invasive collection, because it is *current* — not inferred from browsing history six weeks ago.

The trade-off is that targeting cannot get more specific than the vocabulary allows. An advertiser cannot reach "people whose tests are failing" or "people working on a payments service". We think that ceiling is a feature.

## Verification, not trust

The other half of the system is that an advertiser only pays for a card that was really served and really seen. Every serve writes a record; a receipt that does not match one earns nothing and bills nobody.

That protects the advertiser from paying for fabricated views, and it protects you, because it means the system has no incentive to serve ads it cannot verify.
`,
  },
  {
    slug: "getting-started-with-adcode",
    title: "Getting started with ADCode in five minutes",
    description:
      "From download to a running program: installing ADCode, opening a project, and finding every switch you will actually use. The long version of what the editor shows on first launch.",
    published: "2026-08-20",
    surface: "docs",
    section: "Start here",
    order: 1,
    body: `
ADCode is a full desktop IDE - Monaco editing, real terminals, git, debugging, four ways to connect AI - that funds itself with an occasional sponsored card and pays you half of every advertising dollar. This guide takes you from download to working code, and tells you where everything lives.

## 1. Install it

Press the download button on the [home page](/) - it detects your operating system and fetches the right installer directly. Windows gets an executable installer, Linux an AppImage, and macOS users can grab a disk image from [the downloads page](/download) or install with one line of shell.

The first launch creates an anonymous account so your earnings have somewhere to go. There is nothing to sign up for, no card to add, and no wizard to click through.

## 2. Open something

Open a folder the way you would expect - File, then Open Folder, or drag one onto the window. Everything restores between sessions: the same folder, the same tabs, the same terminal history. Closing ADCode is safe at any moment; unsaved work is kept and offered back if anything closes unexpectedly.

New file? Known extensions get sensible boilerplate automatically - the doctype for HTML, the main function for C. One Ctrl+Z empties it if you would rather start clean.

## 3. Edit

Most of the editor works with zero configuration because the defaults are the product:

- Suggestions appear as you type; Tab takes one, Escape dismisses the list.
- Format on save is on - Ctrl+S tidies the file first, using your language server when there is one.
- Errors underline themselves while you type, and confusing compiler messages are rewritten into plain English above the original wording.
- Multi-cursor works the way you expect: Ctrl+click places cursors, Ctrl+D grabs the next copy of the selected word.

Every one of these is a switch in Settings, each documented in [the docs](/docs). Nothing requires an extension.

## 4. Run things

The terminal at the bottom is a real shell pointed at your project folder. The Run button above it works out the command from the project's shape - npm, cargo, python - and if a tool is missing it tells you which one and where to get it instead of failing cryptically. For JavaScript, TypeScript, and Python, F5 runs under a real debugger: click left of a line number to set a breakpoint.

## 5. Connect AI (or don't)

The assistant is bring-your-own: Settings, then Connect a model, then pick a provider or paste any OpenAI-compatible address - including a local model on your own machine. Your key is checked before saving and stored in your operating system's keychain. Inline completion and the chat widget both work off whichever model you connected, per project. Skip this entirely and the editor loses nothing.

## 6. Let it pay you back

A sponsored card appears occasionally in the corner. It never takes the caret, never steals focus, and never blocks what you are typing - it animates in at the edge and dismisses itself after eight seconds, or the moment you close it. It stays away entirely while you are debugging, and while your editor is not the window in front. Each verified view credits half the advertiser's payment to [your ledger](/dashboard), visible to six decimals, row by row. Standard cadence is at most one card per ten minutes. Turn the frequency down, or turn ads off completely, and the editor does not change in any other way.

## Where to go next

Every feature has its own page in [the documentation](/docs), each with steps, benefits, and an honest note on how it compares. The sidebar groups them the way Settings does, so the page about a switch is always findable from the switch itself.
`,
  },
  {
    slug: "how-you-get-paid-step-by-step",
    title: "How you get paid, step by step",
    description:
      "The complete journey of one advertising dollar: serve, view, receipt, ledger row, balance - with the exact numbers at every step.",
    published: "2026-08-21",
    surface: "docs",
    section: "Earning and advertising",
    order: 0,
    body: `
The earnings system sounds like marketing until you trace one real payment through it. Here is the whole path, with the arithmetic shown along the way.

## The numbers up front

Advertisers set a maximum bid per 500 impressions and compete in a **second-price auction** with a **$1.00 per 500 impression floor**. You receive **50% of the clearing price** for each verified view. The exact amount varies with live demand and is recorded on your ledger.

## Step 1: the editor asks for a card

Every so often - never while debugging, and never when your editor is not the window in front - the editor requests a card matching the generic tags of what you have open. That request contains tags like \`lang:rust\` and whether your theme is dark. No filenames, no code, no paths: those fields do not exist in the request.

## Step 2: the server serves, and writes it down

The server picks a campaign whose targeting matches, serves the card, and records the serve. This record is what makes verification possible later - a receipt that does not match a recorded serve earns nothing and bills nobody.

## Step 3: you see the card, and a receipt comes back

The card sits in the corner for a few seconds. When the viewing conditions are verified, your editor sends a receipt referencing the serve. Matching receipts are what convert a served card into a paid impression - fabricated ones are worth exactly nothing, which removes any incentive to fabricate them.

## Step 4: the ledger gets a row

The moment the receipt verifies, two things happen atomically: the advertiser's budget decreases, and your ledger gains a row crediting your half. The row carries the exact amount to six decimals and joins an append-only list - rows are never edited or deleted, only added to. Corrections arrive as new reversal rows that point at what they reversed, so nothing disappears quietly.

Your balance is not an authority that happens to have history; it is the sum of the rows. If the cached total and the rows ever disagree, the rows win.

## Step 5: watch it happen

Two windows show the same truth:

- In the editor, the earnings view shows your balance and recent rows.
- On the web, [your dashboard](/dashboard) shows available and lifetime totals plus the full ledger, paged through 25 rows at a time.

Administrators can read your ledger under audit - and their reading writes its own audit row. There is no internal view with different numbers.

## Step 6: control the trade-off

Settings gives you the dial: Off, Light, Standard, or Max. Standard means at most one card per 30 minutes and eight a day, counted on your machine. The server may make limits stricter than your setting - it is structurally unable to loosen them. Turning ads off changes nothing else about the editor: same features, no nag screens.

## What it adds up to

ADCode is not a salary. It is a capable editor whose price is a few small cards an hour, refunded to you at half rate, on a ledger you can check line by line. Any product telling you more is doing arithmetic it hopes you will not repeat.
`,
  },
  {
    slug: "publish-your-first-campaign-in-ten-minutes",
    title: "Publish your first campaign in ten minutes",
    description:
      "Sign in, name the account, create the campaign, attach a creative, fund it, go live - the whole advertiser flow, with what each step costs and when.",
    published: "2026-08-22",
    surface: "docs",
    section: "Earning and advertising",
    order: 1,
    body: `
Advertising in ADCode buys verified attention from developers in their actual work environment - a small card in the corner of the editor, matched against what they currently have open. Here is the entire process, start to live.

## Step 1: create the campaign directly

Go straight to [the new-campaign form](/portal/campaigns/new) - you do not need to tour the portal first. Signed in, submit the form; if this is your company's first campaign it asks for an advertiser name inline, creates the account, and finishes the campaign in the same submission. That name is what developers see on your cards, so pick something you want on a business card.

## Step 2: name and scope the campaign

Give the campaign a name only you will see ("Rust developers, Q3"), and choose who sees it from the tag picker: languages (\`lang:rust\`), frameworks (\`fw:react\`), tools (\`tool:docker\`), platforms (\`platform:backend\`). Leave targeting empty to reach everyone. There are 45 tags and that is all of them - targeting is based on what is open in the editor right now, not browsing history.

## Step 3: set your economics

Choose a maximum bid of at least $1.00 per 500 impressions and a total budget starting at $1.00. A second-price auction decides what winning views actually cost, and half of that clearing price goes to the developer. The budget is reserved while the campaign is live and serving stops the instant it is spent.

Campaigns are created paused. Nothing spends until you deliberately go live.

## Step 4: attach a creative

On the campaign page, add the creative: a headline, an optional line of body text, a link, and logos for light and dark themes. Small on purpose - the placement has to sit in a corner without shouting, and cards that shout perform worse anyway. Creatives are reviewed before serving; nothing serves unreviewed.

## Step 5: add funds

[Add funds](/portal/billing) from the portal. You are paying a payment provider directly for credit into your account; the funded balance is what campaigns reserve against. Available minus committed is always visible at the top of the portal.

## Step 6: go live

Set the campaign active once its creative is approved. From that moment:

- Cards serve only into matching, focused, non-working moments - the same respect rules users get.
- Every serve is recorded, and a view bills only when its receipt matches a record.
- Serves, views, clicks, and spend update on the campaign page as receipts verify.

## Step 7: read the results honestly

Reporting is aggregate: impressions, clicks, and spend per campaign and creative. Because billing follows verified receipts, the numbers reflect attention that actually happened - if a card was served to nobody, it cost nobody anything.

## The short version

Create the campaign (account included), target from 45 tags, pay per thousand real views, stop the moment the budget is gone. Half of every payment goes to the developer - which is exactly why they leave the cards switched on.
`,
  },
  {
    slug: "adcode-vs-vs-code-vs-cursor",
    title: "ADCode vs VS Code vs Cursor: an honest comparison",
    description:
      "Where ADCode matches the big editors, where it differs, and where it deliberately will not compete - written to be argued with.",
    published: "2026-08-23",
    surface: "docs",
    section: "Comparisons",
    order: 0,
    body: `
People choosing an editor are really choosing a bundle: editing core, language intelligence, AI, and ecosystem. Here is how ADCode stacks up against the two defaults, claimed plainly enough to be checked.

## The editing core

VS Code and ADCode share a heritage: both build on Monaco, the editor component behind vscode.dev. Folding, multi-cursor, minimap, sticky scroll, bracket colourisation, indent guides - the muscle memory transfers one-to-one. Nobody switches editors over these; the differences are elsewhere.

## Language intelligence

All three speak LSP. The difference is philosophy: VS Code routes intelligence through its marketplace extensions, Cursor layers its fork over VS Code's model, and ADCode talks to the language servers already installed on your machine - rust-analyzer, typescript-language-server, whatever your language's docs recommend - plus one config line for anything unusual. You use the exact servers the CLI tools use, with no marketplace deciding what is available.

Debugging tells the same story: ADCode includes a debug adapter client wired for JavaScript, TypeScript, and Python out of the box, and says so honestly for languages it cannot debug rather than showing dead buttons.

## The AI question

This is where the products genuinely diverge:

- **VS Code** offers Copilot subscriptions inside the extension model.
- **Cursor** is a subscription product built around hosted models - the bundle IS the business model.
- **ADCode** is bring-your-own: connect Anthropic, OpenAI, Google, any OpenAI-compatible gateway, or a local model via its address. Keys live in your OS keychain, conversations stay in files on your disk, and the memory the assistant keeps is plain markdown you can read and delete.

No vendor lock-in cuts both ways: you manage your own keys and see the provider's raw pricing instead of a bundled margin.

## Privacy posture

All three will tell you they respect privacy; compare the mechanics. ADCode's ad targeting reads 45 compiled-in tags about what is open - no filenames, paths, or contents ever leave the machine, and there is no request field where they could ride along. Chat context stays local unless you connect a cloud provider yourself, and even then it is per-project, reviewable, and clearable.

## Ecosystem

Here VS Code wins and we will say so: hundreds of thousands of extensions beat dozens. ADCode's counter-argument is that the extensions people actually install - formatters, linters, themes, keymaps - are largely built in and on by default. Check what remains of YOUR extension list after subtracting those.

## The part nobody else has

Both other editors are free-or-subscription. ADCode inverts the ledger: a sponsored card appears a few times an hour, at the edge of the window and never in the way of the caret - and half of every advertiser payment lands in YOUR account, on an append-only ledger you can audit row by row. Not a salary - but no other editor pays you anything, and none lets you turn its business model off without losing features.

## The honest scorecard

Choose VS Code for the ecosystem, Cursor for a managed AI experience you pay monthly for. Choose ADCode for built-in tooling with no extension ritual, AI on your own key with no markup, a hard privacy ceiling - and an editor that pays you back for the interruption it asks.
`,
  },
  {
    slug: "every-feature-the-full-tour",
    title: "Every feature, explained: the full ADCode tour",
    description:
      "All twelve feature areas in one walk-through - what each group does, why it exists, and where its documentation lives.",
    published: "2026-08-24",
    surface: "docs",
    section: "Start here",
    order: 2,
    body: `
ADCode documents every switch it has - seventy-plus pages in [the docs](/docs), each with steps, benefits, and a comparison. This tour walks the twelve groups in the order the settings do, so you know what exists before you need it.

## Editing

Nineteen pages covering typing itself: suggestions and word completion, multi-cursor and column selection, auto-close and auto-rename of tags, code folding, sticky scroll, indent guides, bracket colours, TODO highlighting, path autocomplete, file templates, and the error lens that puts messages at the end of the line they describe. The theme of the group: helpful by default, one switch each when you disagree. Start with [multi-cursor](/docs/editing-multi-cursor) and [plain-English errors](/docs/editing-plain-english-errors).

## Finding your way

Breadcrumbs, fuzzy file open (Ctrl+P), symbol search (Ctrl+T), global search-and-replace with preview, outline, and go-to-definition that tells you whether an answer was *resolved* by a language server or merely *matched by name*. Navigation answers "where am I" and "where is it" without the mouse.

## Formatting

The built-in formatter, format-on-save, organize-imports-on-save, and live lint diagnostics. Zero configuration: Ctrl+S tidies the file, deferring to your language server when one knows better, and saving unchanged when nothing can.

## Understanding a project

The CSS-aware group: tree lines in the explorer, missing-class detection, unused-selector detection, and the two-way link between style rules and the elements they touch - across HTML, JSX, Vue, Angular, and Handlebars. See [Structure](/docs/structure-popup) for the popup that ties it together.

## Languages

Standards, not forks: the LSP client uses language servers installed on your machine, unknown languages take one config line, tree-sitter parses highlighting properly, and F5 debugs JavaScript, TypeScript, and Python. See [language server intelligence](/docs/language-lsp-client).

## The assistant

Ten pages, one idea: AI on your terms. Connect any major provider, an OpenAI-compatible gateway, or localhost; chat in a dockable widget with searchable local history; inline completion on Tab; memory capture that writes decisions to markdown files in your repo; MCP support so external agents share those notes; and detection that offers the connecting command when an agent starts in your terminal. Begin at [Connect a model](/docs/ai-connect).

## Git

Stage-commit UI, branch switcher, blame, gutter diffs, file timeline, and side-by-side merge conflict resolution with Keep yours / Keep theirs / Keep both buttons. Plain git underneath - the repository stays perfectly portable.

## Your session

Auto-save after a pause, crash recovery that offers unsaved buffers back, local file history separate from git, and full workspace restore. The group whose job is that nothing you type is ever lost.

## The workbench

Real terminals (several, stateful, pointed at your project), the Run button that infers the command, live preview beside your code, keyboard-shortcut editing with conflict warnings, and peer-to-peer collaboration over your local network - no relay server. See the [built-in terminal](/docs/workbench-terminal) and [Run](/docs/workbench-run).

## Appearance

Light, dark, or system-following - accent colour included - plus Comfortable/Compact density. Two switches, applied instantly.

## Ads and earnings

[Sponsored messages](/docs/ads-enabled) and their [frequency](/docs/ads-frequency): the card schedule counted on your machine, the server able to tighten limits but structurally unable to loosen them, and off meaning off. Each verified view pays half the CPM to an append-only ledger.

## Updates

Background downloads applied on reopen, never mid-thought; release notes shown at most once per version and only when worth reading, with security fixes the single exception allowed to hurry.

---

Seventy-two pages later, the pattern should be visible: every feature ships on by default, every default has one switch, and every page says what it costs you. That is deliberate - an editor you can fully understand is an editor you can trust with your work.
`,
  },
];

/** Roughly 220 words a minute, rounded up, minimum one. */
function readingMinutes(body: string): number {
  const words = body.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 220));
}

function hydrate(source: PostSource): Post {
  const post: Post = {
    slug: source.slug,
    title: source.title,
    description: source.description,
    published: source.published,
    readingMinutes: readingMinutes(source.body),
    body: source.body,
    ...(source.surface === undefined ? {} : { surface: source.surface }),
    ...(source.section === undefined ? {} : { section: source.section }),
    ...(source.order === undefined ? {} : { order: source.order }),
    ...(source.related === undefined ? {} : { related: [...source.related] }),
  };
  return source.updated === undefined ? post : { ...post, updated: source.updated };
}

/** What the API returns. Timestamps are millisecond epochs there, ISO dates here. */
interface ApiPost {
  slug: string;
  title: string;
  description: string;
  body: string;
  surface?: unknown;
  section?: unknown;
  order?: unknown;
  related?: unknown;
  publishedAt: number | null;
  updatedAt: number;
}

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function fromApi(post: ApiPost): Post {
  const published = isoDay(post.publishedAt ?? post.updatedAt);
  const updated = isoDay(post.updatedAt);

  const surface =
    post.surface === "docs" || post.surface === "both" ? post.surface : ("blog" as const);

  const hydrated: Post = {
    slug: post.slug,
    title: post.title,
    description: post.description,
    published,
    readingMinutes: readingMinutes(post.body),
    body: post.body,
    surface,
    ...(typeof post.section === "string" ? { section: post.section } : {}),
    ...(typeof post.order === "number" ? { order: post.order } : {}),
    ...(Array.isArray(post.related)
      ? { related: post.related.filter((one): one is string => typeof one === "string") }
      : {}),
  };

  return updated === published ? hydrated : { ...hydrated, updated };
}

const fileposts = (): Post[] =>
  SOURCES.map(hydrate).sort((a, b) => b.published.localeCompare(a.published));

/**
 * Newest first. The bundled posts are always included; the API adds to them and wins
 * on slug, so a page the admin has edited replaces the one shipped with the build.
 *
 * `surface` filters to one of the two places a page can appear. A page marked `both` is
 * returned by either, which is the point of the setting: one piece of writing, two homes,
 * rather than a copy in each that drifts.
 */
export async function allPosts(options?: { surface?: "blog" | "docs" }): Promise<Post[]> {
  const wanted = options?.surface;
  const onSurface = (post: Post): boolean =>
    wanted === undefined || post.surface === "both" || (post.surface ?? "blog") === wanted;

  try {
    const response = await fetch(`${API_ORIGIN}/v1/posts`, {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!response.ok) return fileposts().filter(onSurface);

    const body = (await response.json()) as { posts?: ApiPost[] };
    const posts = Array.isArray(body.posts) ? body.posts.map(fromApi) : [];

    /*
     * The bundled writing is always present; the API adds to it and wins on slug.
     *
     * This used to be either/or, with the docs surface deliberately refusing the bundled
     * fallback because the essays were blog-only and would have landed under a reference
     * section. They are filed under real docs sections now - Start here, How ADCode works,
     * Earning and advertising, Comparisons - and either/or meant a reachable API returning
     * nothing for a surface silently withdrew eight published articles from the site.
     *
     * An admin editing a bundled slug still replaces it wholesale, which is what the admin
     * panel is for.
     */
    const merged = new Map(fileposts().map((post) => [post.slug, post]));
    for (const post of posts) merged.set(post.slug, post);

    return [...merged.values()]
      .filter(onSurface)
      .sort((a, b) => b.published.localeCompare(a.published));
  } catch {
    return fileposts().filter(onSurface);
  }
}

export async function getPost(slug: string): Promise<Post | null> {
  try {
    const response = await fetch(`${API_ORIGIN}/v1/posts/${encodeURIComponent(slug)}`, {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (response.ok) return fromApi((await response.json()) as ApiPost);
  } catch {
    // Fall through to the bundled posts.
  }

  const found = SOURCES.find((p) => p.slug === slug);
  return found === undefined ? null : hydrate(found);
}
