/**
 * The layer that turns reference pages into guides.
 *
 * `docsSeed.ts` carries what each feature IS - one honest paragraph per field, shared with
 * the editor's help system. This file carries what a guide needs on top: real numbered
 * steps for the features people actually open a manual for, the concrete benefits, and a
 * straight answer to "why is this better than what I use now".
 *
 * Anything without an entry here still gets the full page structure - steps derived from
 * the seed's own text and a comparison written for its whole section - so no doc page is
 * ever a stub.
 */

interface DocGuide {
  /** Numbered steps rendered verbatim. */
  readonly steps?: readonly string[];
  /** Concrete payoffs, bulleted. */
  readonly benefits?: readonly string[];
  /** The comparison paragraph, specific to this feature. */
  readonly betterThan?: string;
}

export const DOC_GUIDES: Readonly<Record<string, DocGuide>> = {
  /* ── Editing ─────────────────────────────────────────────────────────── */

  "editing-multi-cursor": {
    steps: [
      "Ctrl+click where you want a second cursor - everything you type now happens in both places.",
      "Select a word and press Ctrl+D repeatedly to place a cursor on each copy of it.",
      "Press Ctrl+Alt+Up or Ctrl+Alt+Down to stack cursors straight down a column of lines.",
      "Edit as usual - typing, pasting, and formatting apply at every cursor at once.",
      "Press Escape when you are done to collapse back to a single cursor.",
    ],
    benefits: [
      "Renaming a repeated word takes one edit instead of six.",
      "Lining up data or stripping a common prefix across many lines happens in a single action.",
      "Every cursor shares one undo step, so one Ctrl+Z undoes the whole batch cleanly.",
    ],
    betterThan:
      "Most editors bolt multi-cursor on through extensions or hide it behind modes. In ADCode the three ways of adding a cursor work identically everywhere, and Escape always gets you out - there is no mode to get stuck in.",
  },

  "editing-suggestions": {
    steps: [
      "Type - the suggestion list appears after a couple of characters.",
      "Keep typing to narrow the list; the best match is highlighted.",
      "Press Tab or Enter to take the highlighted suggestion.",
      "Press Escape to dismiss the list and keep typing on your own.",
      "If Enter should mean a new line rather than taking a suggestion, turn off \"Accept suggestion with Enter\" in Editing settings.",
    ],
    benefits: [
      "You stop retyping long names - and stop mistyping them.",
      "The list draws on the language server when one exists, so suggestions are accurate, not guesses.",
      "Even in languages with no tooling, words already in the file are offered.",
    ],
    betterThan:
      "Out of the box, most editors suggest nothing until you have installed a language extension. ADCode falls back to suggesting real words from your file, then quietly upgrades to full language intelligence when a server is available - useful at zero configuration, sharper with it.",
  },

  "editing-plain-english-errors": {
    steps: [
      "Write code that produces a compiler or linter error as usual.",
      "Read the first line under the squiggle - that is the plain-English rewrite.",
      "Hover the error, or check the Problems panel, to see the compiler's exact original wording underneath.",
      "Search for the original wording when you need the deeper explanation the compiler links to.",
    ],
    benefits: [
      "You get the meaning immediately, not after decoding jargon.",
      "The original message is never hidden, so web searches and issue reports still work.",
      "It applies to every diagnostic - errors, warnings, and lint output alike.",
    ],
    betterThan:
      "Other editors show you the compiler's raw output and leave the translating to a search engine. ADCode does the translation in place, keeps the source text for when precision matters, and never lets the rewrite replace the truth - it sits above it.",
  },

  /* ── Finding your way ────────────────────────────────────────────────── */

  "navigation-fuzzy-file-open": {
    steps: [
      "Press Ctrl+P.",
      "Type two or three letters of the file's name - order does not matter.",
      "Arrow through the ranked results; the path is shown so similarly named files are easy to tell apart.",
      "Press Enter to open the highlighted file.",
    ],
    benefits: [
      "The tree becomes somewhere you browse, not somewhere you hunt.",
      "Misspellings still find the file - 'ushnd' finds 'useHandler.ts'.",
      "Recent files rank higher, so 'the one I just had open' is usually result one.",
    ],
    betterThan:
      "This used to be the headline feature of a paid IDE. Here it is built in from the first launch, with no indexing pause on big projects - the ranking runs off the file tree you already have.",
  },

  "navigation-global-search": {
    steps: [
      "Press Ctrl+Shift+F.",
      "Type the text, or a regular expression pattern if you need one.",
      "Narrow the scope with include/exclude patterns - say, only *.tsx files.",
      "Review the matched lines grouped per file before touching anything.",
      "Type the replacement and press Replace All, or replace just the matches you approve one file at a time.",
    ],
    benefits: [
      "You see every hit before anything changes - no surprise diffs.",
      "Pattern search catches variants a plain find misses.",
      "Results stay live as you edit, so renames across many files stay trackable.",
    ],
    betterThan:
      "Where many editors push you to an extension for project-wide replace with review, ADCode treats preview-before-change as the default path. Combined with gutter diffs and git, every mass edit stays visible and reversible.",
  },

  /* ── Formatting ──────────────────────────────────────────────────────── */

  "formatting-format-on-save": {
    steps: [
      "Open any file and edit it as usual.",
      "Save with Ctrl+S.",
      "The formatter tidies the file first; then the save lands.",
      "Prefer to tidy manually? Press Shift+Alt+F any time, or turn format-on-save off in Formatting settings.",
    ],
    benefits: [
      "Your files never drift out of house style - nobody has to remember anything.",
      "Diffs stay about your change, not about whitespace.",
      "If a formatter cannot handle the language, the save proceeds untouched rather than mangling the file.",
    ],
    betterThan:
      "Zero install is the difference. Most setups need a formatter extension, a config file, and a settings toggle before the first save formats anything. In ADCode the formatter is built in, defers to a language server when one exists, and works from the very first Ctrl+S.",
  },

  "formatting-lint-diagnostics": {
    steps: [
      "Type as usual - problems underline themselves while you work.",
      "Red means broken, yellow means suspicious.",
      "Hover an underline for the detail, rewritten in plain English above the original message.",
      "Open the Problems panel to see every finding across the project in one list.",
    ],
    benefits: [
      "Mistakes cost seconds, not test runs.",
      "Findings arrive as you type, so context is still in your head when you fix them.",
      "Everything collects in one panel - nothing hides in a tab you forgot to open.",
    ],
    betterThan:
      "Linters elsewhere are an install-and-configure ritual. ADCode surfaces diagnostics from the tools already on your machine, the moment they exist, and explains them in sentences before showing you raw codes.",
  },

  /* ── Languages ───────────────────────────────────────────────────────── */

  "language-lsp-client": {
    steps: [
      "Install your language's language server once, the way its documentation says (for Rust that is rust-analyzer, for TypeScript it is usually already present).",
      "Open a file in that language - ADCode starts the server automatically.",
      "Suggestions, go-to-definition, rename, and precise errors upgrade immediately.",
      "For a language ADCode does not know yet, add its server under Additional language servers - one line, no restart.",
    ],
    benefits: [
      "Real understanding instead of word-matching: definitions resolve, renames are safe.",
      "You pick the server version - upgrades happen on your schedule.",
      "Nothing phones home; the helper runs on your machine, reading your project locally.",
    ],
    betterThan:
      "Typical editors bundle their own forks and decide what you get. ADCode speaks the standard protocol and uses the servers you already have - the same intelligence the CLI tools use, with no second copy to maintain.",
  },

  "language-dap-client": {
    steps: [
      "Click left of a line number to set a breakpoint - a red dot appears.",
      "Press F5 to run under the debugger.",
      "When the program stops, read every value in scope in the side panel.",
      "F10 steps over the next line, F11 steps into a function call.",
      "Press F5 again to continue to the next breakpoint or the end.",
    ],
    benefits: [
      "You see the real state of the program, not whatever print statements you remembered to add.",
      "Breakpoints survive restarts, so repeat runs stop in the same places.",
      "Languages without a debug adapter say so honestly instead of offering dead buttons.",
    ],
    betterThan:
      "Print-debugging is guessing with extra steps; most light editors leave you to it because a real debug adapter client is hard to build. ADCode includes one, wired for JavaScript, TypeScript, and Python out of the box.",
  },

  /* ── The assistant ───────────────────────────────────────────────────── */

  "ai-connect": {
    steps: [
      "Open Settings and choose Connect a model.",
      "Pick a provider - or choose Custom and paste any endpoint that speaks the OpenAI format, including one on localhost.",
      "Paste your API key, or use Sign in where the provider offers account login.",
      "ADCode checks the key against the provider right away and tells you before saving anything.",
      "Pick a model from the list of ones your key can actually reach.",
    ],
    benefits: [
      "A mistyped key fails at setup, with a clear message - not silently on your first question.",
      "Bring-your-own means the model bill comes from your provider at their price, with no markup.",
      "Keys live in your operating system's password store, never in a plaintext settings file.",
    ],
    betterThan:
      "Subscription AI editors lock you to one vendor's models and resell access at a margin. ADCode takes no cut: connect Anthropic, OpenAI, Google, a local Ollama, or any gateway - and switch between them per question if you like.",
  },

  "ai-inline-completion": {
    steps: [
      "Connect a model once (see Connect a model).",
      "Type the start of a line or function - grey ghost text appears ahead of your cursor.",
      "Press Tab to accept the whole suggestion.",
      "Just keep typing to ignore it - it fades as soon as you diverge.",
    ],
    benefits: [
      "Boilerplate, repetitive blocks, and obvious next lines finish themselves.",
      "The suggestion is visible before you commit to it - accept only when it is right.",
      "Turn it off per machine without touching chat; the two features are independent switches.",
    ],
    betterThan:
      "Inline completion usually arrives bundled with a subscription and a data-sharing agreement. Here it runs against whichever model YOU connected, and whether code leaves your machine follows the provider you chose - a decision that stays yours.",
  },

  "ai-chat-widget": {
    steps: [
      "Press the chat shortcut (or pick it from the command palette) to summon the card.",
      "Ask about the code in front of you - the assistant can see the open project.",
      "Drag the title bar to park it wherever it stays out of the way.",
      "Press Escape to dismiss it; the conversation survives dismissal.",
      "Reopen later, or find older conversations in the history list beside it.",
    ],
    benefits: [
      "No copy-pasting context into a browser window - it already has the project.",
      "Conversations are stored per project, on your machine, and never uploaded.",
      "The history is searchable, renameable, and clearable - including a single button that wipes memory.",
    ],
    betterThan:
      "Web AI chats know nothing about your files unless you paste them, which trains you to leak code into somebody else's logs. The widget answers in place, with the project as context, and shows you exactly what it remembers.",
  },

  /* ── Git ─────────────────────────────────────────────────────────────── */

  "git-stage-commit-ui": {
    steps: [
      "Open the Source Control panel from the activity bar.",
      "Review the changed files; click any one to see its diff side by side.",
      "Tick the changes that belong together - that is staging.",
      "Write a short message saying what this set does.",
      "Press Commit. The set enters your project's history as one labelled step you can return to.",
    ],
    benefits: [
      "History becomes readable steps instead of one pile of edits.",
      "Partial commits let you split unrelated changes apart honestly.",
      "Gutter marks in the editor keep showing what is still uncommitted while you work.",
    ],
    betterThan:
      "Everything here drives real git on your machine - no proprietary VCS, no lock-in, no account. If you leave for another editor tomorrow, the repository is exactly as standard as it was.",
  },

  "git-merge-conflict": {
    steps: [
      "Pull or merge as usual; conflicted files are listed in Source Control.",
      "Open one - both versions appear clearly marked, side by side.",
      "Above each conflict choose Keep yours, Keep theirs, or Keep both.",
      "Hand-edit the merged result where none of the buttons fit.",
      "Save, stage the file, and commit the merge.",
    ],
    benefits: [
      "You resolve conflict by conflict without losing your place.",
      "Both sides stay visible while you decide - no mental diffing of marker soup.",
      "Manual editing stays available for the cases no button anticipates.",
    ],
    betterThan:
      "Raw conflict markers ('<<<<<<< HEAD') are git's most notorious reading experience, and lightweight editors leave them untouched. ADCode renders the choices as buttons over both versions - the thing paid IDEs charge for, included.",
  },

  /* ── Your session ────────────────────────────────────────────────────── */

  "session-crash-recovery": {
    steps: [
      "There is nothing to do beforehand - backups of unsaved buffers are kept continuously.",
      "If ADCode closes unexpectedly, simply reopen it.",
      "It offers your unsaved work back, file by file.",
      "Accept what you want; your editor returns to where the interruption found you.",
    ],
    benefits: [
      "A power cut costs seconds, not an hour.",
      "Works even for files you never saved at all.",
      "Plays well with workspace restore - tabs and layout come back too.",
    ],
    betterThan:
      "Editors that autosave to temp files often restore silently or not at all; either extreme surprises you. Here recovery is explicit - it asks, shows what it has, and never writes recovered content over your files uninvited.",
  },

  /* ── The workbench ───────────────────────────────────────────────────── */

  "workbench-terminal": {
    steps: [
      "Open the panel at the bottom of the window, or run Terminal: New from the command palette.",
      "The shell starts already cd'd into your project folder.",
      "Run commands as usual - build, test, git, package managers.",
      "Split or add terminals as needed; each remembers its own state.",
      "Switch between them from the terminal list on the panel's right.",
    ],
    benefits: [
      "Editor and shell share one window - alt-tabbing between them stops.",
      "Real pty, real colors, real interactive programs - not a command box pretending.",
      "AI agent tools started here are detected and can be connected to your project notes.",
    ],
    betterThan:
      "A terminal that is genuinely integrated - pointed at your workspace, restorable with your session, and wired into Run and the debugger - versus an embedded afterthought. It is a full node-pty terminal, the same class of integration the heavyweight IDEs ship.",
  },

  "workbench-command-palette": {
    steps: [
      "Press Ctrl+Shift+P.",
      "Start typing what you want - 'format', 'branch', 'fold'...",
      "The matching commands appear with their keyboard shortcuts shown alongside.",
      "Press Enter to run, or take note of the shortcut and use keys next time.",
    ],
    benefits: [
      "Every capability in ADCode is reachable without memorizing menus.",
      "The palette teaches shortcuts as you use it - muscle memory builds itself.",
      "Fuzzy matching forgives approximate naming.",
    ],
    betterThan:
      "Menus cap out; palettes scale. ADCode's palette indexes every command including ones from settings and language tooling, and prints each shortcut beside its name so discovery and learning happen in the same gesture.",
  },

  "workbench-collab": {
    steps: [
      "One of you starts a session from the command palette and shares the invitation.",
      "The other joins from their machine - same network, no account needed.",
      "Open the same files; cursors and edits appear live for both sides.",
      "Close the session when done - nothing persists on any server.",
    ],
    benefits: [
      "Pair-debug without screen sharing or reading code over a call.",
      "Code travels peer-to-peer over your local network - never through anybody's cloud.",
      "No seats, no subscriptions, no meeting links.",
    ],
    betterThan:
      "Popular collab tools route every keystroke through a vendor's servers and price real-time editing per seat. ADCode does it over the network you are already on, with the bytes never leaving the room.",
  },

  "workbench-run": {
    steps: [
      "Open the project or file you want to execute.",
      "Press Run - ADCode works out the command from the project's shape (package.json, main file conventions, and so on).",
      "Output streams into the integrated terminal.",
      "If a required tool is missing, ADCode names it and says where to get it.",
    ],
    benefits: [
      "No remembering whether this project runs with npm, cargo, python, or make.",
      "The failure mode for missing tools is instructions, not a cryptic exit code.",
      "Runs land in a real terminal, so follow-up commands are right there.",
    ],
    betterThan:
      "Task runners elsewhere want a config file describing your build. ADCode infers the boring case instantly and stays out of the way for custom setups - one button for the common path, a terminal for everything else.",
  },

  /* ── Ads and earnings ────────────────────────────────────────────────── */

  "ads-enabled": {
    steps: [
      "Open Settings > Sponsored messages.",
      "Leave it on to earn; each verified card credits your ledger.",
      "Or switch it off - ads stop, and nothing else about the editor changes.",
      "Set Frequency to control how often cards may appear when enabled.",
    ],
    benefits: [
      "Half of every advertiser payment lands in your ledger, shown to six decimals.",
      "Cards never interrupt typing, debugging, running commands, or an unfocused window.",
      "Off means off - no nag screens, no locked features, no countdown to a paywall.",
    ],
    betterThan:
      "Ad-supported software usually means the user is the product and the terms are one-sided. Here the schedule is enforced on your machine, the server can only tighten limits - never loosen them - and turning the whole thing off costs you nothing but the earnings.",
  },

  "ads-frequency": {
    steps: [
      "Open Settings > Frequency.",
      "Standard caps cards at one per 30 minutes, 8 a day - that is the default.",
      "Light is one an hour and 4 a day; Max is one per 15 minutes and 20 a day.",
      "Off stops cards entirely (see Sponsored messages).",
    ],
    benefits: [
      "The cadence is counted on your machine, not promised from a server.",
      "Limits can be made stricter than your setting at any time - never looser.",
      "You trade interruption for earnings consciously, at a rate you chose.",
    ],
    betterThan:
      "Frequency capping in ordinary ad software protects the advertiser's spend, not your attention. These caps protect you, they are enforced locally where you can verify them, and no server response can widen them.",
  },

  /* ── Understanding a project ─────────────────────────────────────────── */

  "structure-popup": {
    steps: [
      "Open Structure from the activity bar, or its keyboard shortcut.",
      "Use the This file tab for the current file's functions, classes, and sections as a tree.",
      "Use the This project tab to navigate the whole codebase the same way.",
      "With a function selected, see what it calls and what calls it.",
      "Click any row to jump straight there.",
    ],
    benefits: [
      "A file list says what exists; Structure says what it IS and how it connects.",
      "Stylesheets get the same treatment: rules to elements, elements to rules.",
      "Orientation in an unfamiliar codebase takes minutes instead of an afternoon.",
    ],
    betterThan:
      "Call hierarchies and CSS cross-referencing are premium-IDE territory, usually requiring language plugins per framework. ADCode links styles to markup across HTML, JSX, Vue, Angular, and Handlebars templates out of the box, in one popup.",
  },
};

/**
 * The comparison paragraph for features without their own - written once per section,
 * because the honest argument at section level is usually the same one.
 */
export const SECTION_COMPARISONS: Readonly<Record<string, string>> = {
  Editing:
    "Other editors give you this through a stack of extensions that each need installing, updating, and reconciling with each other - and half of them reset when a colleague opens the project. ADCode ships these behaviours in the box, on by default, identical on every machine that opens your folder, and each one is a single switch away if you disagree.",
  "Finding your way":
    "Fast navigation is the feature paid IDEs advertise and free editors approximate. ADCode treats fuzzy open, symbol search, and go-to-definition as core paths, tuned to work from the first launch with no indexing wait and no plugin hunt.",
  Formatting:
    "Elsewhere, consistent formatting is a ritual: pick a formatter, install it, write a config, wire it to save. ADCode ends the ritual - a built-in formatter, on by default, that defers to your language server when one knows better and never mangles a file it cannot handle.",
  "Understanding a project":
    "Knowing what a style rule touches, or which classes nothing defines, normally needs a bespoke extension per framework - if it exists at all. ADCode reads HTML, JSX, Vue, Angular, and Handlebars templates natively and connects markup to styles both ways, with findings surfaced in the same Problems panel as everything else.",
  Languages:
    "Instead of bundling its own forks of every toolchain, ADCode speaks the standard protocols - LSP for intelligence, DAP for debugging, tree-sitter for highlighting - and uses the servers installed on your machine. You get the same understanding the CLI tools have, one config line for anything unsupported, and no second copy of anything to maintain.",
  "The assistant":
    "Most AI editors rent you a subscription, choose your models, and take a margin on every token. ADCode connects to the provider you pick - major labs, a gateway, or a model on your own machine - stores your key in your OS keychain, keeps conversations on your disk, and shows you exactly what its memory holds.",
  Git:
    "ADCode's source control drives plain git - no proprietary VCS, no account, no lock-in. Staging, committing, blame, timelines, and conflict resolution get the visual treatment heavier IDEs charge for, and the repository stays exactly as portable as git itself.",
  "Your session":
    "Losing work is a policy choice. Auto-save after a pause, continuous backup of unsaved buffers, local file history, and full workspace restore are all on by default - so a crash costs seconds and a reopened window looks exactly like the one you closed.",
  "The workbench":
    "Terminal, run button, live preview, collaboration, and a command palette that indexes everything: the pieces that make an editor a workbench are built in rather than assembled from extensions, and each one degrades honestly - telling you what is missing instead of failing mysteriously.",
  Appearance:
    "Light, dark, or following your system - including its accent colour - with a density setting that respects both large monitors and small laptops. Two switches, applied everywhere instantly, with no theme marketplace required.",
  "Ads and earnings":
    "Ad-supported usually means the terms are one-sided and the schedule is whatever pays best. ADCode enforces its ad cadence on your machine, can only ever tighten it from the server, credits half of every payment to an append-only ledger you can audit row by row - and switching the whole thing off removes nothing else.",
  Updates:
    "Updates download in the background and apply when you reopen - never mid-thought, never a modal demanding a restart. Release notes reach you at most once per version, only when worth reading, and security fixes are the sole exception allowed to hurry.",
};
