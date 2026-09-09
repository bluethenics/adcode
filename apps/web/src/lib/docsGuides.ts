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

  "editing-accept-on-enter": {
    steps: [
      "Type until the suggestion list appears, then keep typing to narrow it.",
      "Press Enter to take the highlighted suggestion at once.",
      "If you actually wanted a new line there, press Escape first, then Enter.",
      "Prefer Enter to always mean a new line? Turn this off in Editing settings - Tab still takes suggestions either way.",
    ],
    benefits: [
      "Fast typists stop paying an extra keystroke for every accepted suggestion.",
      "It is a separate switch from suggestions entirely, so you tune one habit without losing the other.",
    ],
    betterThan:
      "Editors that hard-wire Enter to accept suggestions make the trade-off for you. ADCode treats it as a per-person habit: one switch, and both keys keep a useful meaning.",
  },

  "editing-auto-rename-paired-tag": {
    steps: [
      "Click into the name of an opening tag and start typing its replacement.",
      "The matching closing tag changes character for character as you type.",
      "If the rename went wrong, one Ctrl+Z undoes both sides together.",
      "It works in HTML, XML, JSX, and template languages out of the box.",
    ],
    benefits: [
      "Halved tags never drift apart, so the 'mismatched tag' error stops existing.",
      "Undo treats the pair as one edit - you never end up with a half-renamed element.",
    ],
    betterThan:
      "Manual renaming means hunting the closing tag by eye in nested markup. Pairing the rename at edit time removes a whole class of breakage that template engines then report at the wrong site.",
  },

  "editing-auto-close-tags": {
    steps: [
      "Type an opening tag like <section> and finish it with >.",
      "The closing tag appears immediately, cursor left in the middle.",
      "Type </ to close a tag yourself and ADCode finishes the rest.",
      "On by default in HTML, XML, JSX, and template files.",
    ],
    benefits: [
      "The most common way markup breaks - a forgotten closing tag - stops happening.",
      "You never type a closing tag twice; the editor and you stay out of each other's way.",
    ],
    betterThan:
      "Editors without this rely on the browser or compiler to catch the imbalance later. Writing the closing tag at the same moment as the opening means the file is well-formed after every keystroke.",
  },

  "editing-bracket-pair-colorization": {
    steps: [
      "Nothing to do - it is on. Look at any nested expression.",
      "Each bracket and its partner share a colour; deeper levels take the next colour.",
      "If the colours ever feel noisy, switch it off in Editing settings.",
    ],
    benefits: [
      "Matching a bracket to its partner becomes spotting a colour, not counting depth.",
      "Works everywhere - code, config, JSON - with no per-language setup.",
    ],
    betterThan:
      "Editors that colour every bracket the same force you to count. Colour-coding by depth turns bracket-matching from an exercise into a glance.",
  },

  "editing-code-folding": {
    steps: [
      "Hover the margin beside a function or block - the fold arrow appears.",
      "Click it to collapse the block to one line. Click again to expand.",
      "Prefer keys? Ctrl+Shift+[ folds the block at the cursor; Ctrl+Shift+] opens it.",
      "Folded state is yours alone - it never changes the file on disk.",
    ],
    benefits: [
      "Long files become skimmable: fold everything except what you are working on.",
      "The structure stays visible as '...' markers instead of vanishing entirely.",
    ],
    betterThan:
      "Scrolling a 2,000-line file costs attention every time. Folding lets the file stay long where it needs to be and short where you are.",
  },

  "editing-comment-tones": {
    steps: [
      "Turn it on in Editing settings - it is off by default.",
      "Start a line comment with ! for a warning, ? for a question, or * for a highlight; each takes its own colour.",
      "A comment starting with // extra slashes fades instead, marking code you commented out.",
      "Block comments are deliberately untouched: their leading asterisk is a convention, not an intent.",
    ],
    benefits: [
      "Warnings, open questions, and dead code stop rendering as the same grey sentence.",
      "Intent travels with the comment itself - no plugin, no config file per project.",
    ],
    betterThan:
      "TODO-highlighters catch tags but lump every other comment together. Toning by the first character makes the whole comment stream readable at a skim, including the 'this is commented-out code' case everyone gets wrong.",
  },

  "editing-column-selection": {
    steps: [
      "Turn it on in Editing settings when you need it.",
      "Drag with the mouse: the selection is a rectangle - a straight column down the lines.",
      "Type or paste to edit every row of the rectangle at once.",
      "Turn it back off afterwards - while on, every drag is a box, which is not what you want normally.",
    ],
    benefits: [
      "Stripping the same prefix, or aligning a column of values, is one drag instead of one edit per line.",
      "It is a mode you toggle deliberately, so it never surprises you mid-edit.",
    ],
    betterThan:
      "Most editors bury column selection behind an undocumented modifier key where it fires by accident or stays undiscovered. ADCode makes it an explicit mode you choose for a job and put down afterwards.",
  },

  "editing-indent-guides": {
    steps: [
      "On by default - faint vertical lines mark each indentation level.",
      "The guide for the block your cursor is in highlights brighter than the rest.",
      "In brace languages they follow the structure; in Python and friends they are the structure.",
    ],
    benefits: [
      "You can see which lines belong together without selecting anything.",
      "The active-block highlight answers 'which loop am I in' continuously.",
    ],
    betterThan:
      "Guides that show all levels equally just add visual noise. Highlighting the enclosing block turns guides from decoration into orientation.",
  },

  "editing-inline-error-lens": {
    steps: [
      "Write code - errors and warnings render their message at the end of the offending line.",
      "The text is dimmed and truncated so code always wins the space.",
      "The lens hides on the line you are typing on, and returns when you move away.",
      "Hover, or open the Problems panel, for the full detail.",
    ],
    benefits: [
      "You find out a line is broken while your eyes are still on it.",
      "No hover-hunting and no panel-diving for the one-line answer.",
    ],
    betterThan:
      "A squiggle demands a hover; a panel demands a click. Putting the message at the end of the line costs zero interaction - the error announces itself where you will fix it.",
  },

  "editing-inline-git-blame": {
    steps: [
      "Turn it on in Editing settings - it is off by default, because it adds text all day.",
      "Click any line; a quiet note at its end says who last changed it and when.",
      "Need the full story? The Git section's blame and timeline pick up from here.",
    ],
    benefits: [
      "'Why is this line here' is answered without leaving the file.",
      "Off by default stays out of the way of people who never ask that question.",
    ],
    betterThan:
      "Opening a blame view splits you out of the file. An inline note answers the everyday question - who, when - exactly where the question arose.",
  },

  "editing-minimap": {
    steps: [
      "On by default - the right edge shows the file reduced to a thumbnail.",
      "Click anywhere on the minimap to jump straight there.",
      "Drag the highlighted viewport box to scrub through the file.",
      "Turn it off in Editing settings to reclaim the width.",
    ],
    benefits: [
      "You navigate by shape - 'the dense block near the top' - which is how you actually remember code.",
      "Big files become one gesture instead of a search or a scroll journey.",
    ],
    betterThan:
      "A scrollbar tells you where you are; a minimap tells you where everything is. Shape-based navigation beats position guessing on any file longer than a screen.",
  },

  "editing-path-autocomplete": {
    steps: [
      "Start typing a path in an import, require, or quoted string.",
      "The real files and folders from your project appear as suggestions.",
      "Pick one, or type / to descend into a folder and keep going.",
      "It only offers what exists, so a completed path cannot be wrong.",
    ],
    benefits: [
      "Broken-import-from-typo stops being possible at the point of typing.",
      "You stop memorising directory layouts - the project itself fills in its own shape.",
    ],
    betterThan:
      "Typo'd paths fail loudly only at build time, one step removed. Completing from the actual file tree moves the guarantee to the first keystroke.",
  },

  "editing-spell-check": {
    steps: [
      "Turn it on in Editing settings - it is off by default.",
      "Or run Edit - Check Spelling in Comments on demand; results land in the Problems panel, including an explicit 'nothing found'.",
      "Misspelled words get a wavy underline; click the lightbulb for the fix.",
      "Only real comments are checked, and only words with a known correction are flagged - library names and product names pass.",
      "Code is never spell-checked: an identifier is named, not spelled.",
    ],
    benefits: [
      "The one class of typo no compiler can see finally gets a check.",
      "Conservative flagging means the check never becomes the noise you switch off.",
    ],
    betterThan:
      "Most spell plugins underline everything unfamiliar, training you to ignore the colour entirely. Flagging only correctable words keeps every underline worth clicking.",
  },

  "editing-sticky-scroll": {
    steps: [
      "On by default. Scroll down inside a long function.",
      "The enclosing context - function, class, loop headers - stays pinned at the top.",
      "Click a stuck line to jump straight back to it.",
    ],
    benefits: [
      "You never lose which function you are inside, however deep in it you scroll.",
      "The pinned headers double as one-click navigation back up.",
    ],
    betterThan:
      "Scroll-up-to-check is the default workflow everywhere without this, and it costs your place twice. Pinning the context removes the question entirely.",
  },

  "editing-todo-highlighting": {
    steps: [
      "On by default - write TODO, FIXME or HACK in a comment and it takes a colour.",
      "Only real comments count; the word TODO inside a string is left alone.",
      "Edit - List TODOs and FIXMEs gathers every one from your open files into the Problems panel, and says so plainly when there are none.",
      "The list doubles as a checklist: close the loop on each and watch the panel empty.",
    ],
    benefits: [
      "Notes-to-self stop dissolving into the mass of ordinary comments.",
      "One command turns scattered intentions into a project-wide index.",
    ],
    betterThan:
      "Leaving TODOs invisible means relying on memory or grep later. Highlighting plus a one-command index means the notes actually get read - which is the only reason to write them.",
  },

  "editing-trailing-whitespace": {
    steps: [
      "Turn it on in Editing settings - off by default, since it is noise while you are not hunting.",
      "Spaces and tabs stranded at line ends render as faint marks.",
      "Clean them up by hand, or let format-on-save trim them from then on.",
    ],
    benefits: [
      "Diffs stop containing invisible space changes nobody meant to make.",
      "Whitespace-sensitive formats stop hiding their fragility.",
    ],
    betterThan:
      "Configured into most editors globally, visible whitespace becomes permanent noise. As an off-by-default lens for when you care, it is a tool, not a wallpaper.",
  },

  "editing-word-suggestions": {
    steps: [
      "Keep typing - words you have already used in the file appear as suggestions.",
      "Press Tab or Enter to take one, Escape to keep typing on your own.",
      "No configuration; it is the automatic floor under every language.",
    ],
    benefits: [
      "Long project-specific names stop needing to be retyped perfectly.",
      "Even languages with zero tooling get a useful suggestion list.",
    ],
    betterThan:
      "Editors with no completion fallback leave un-tooled languages completely unassisted. Suggesting words already in the file is always right about spelling and always local.",
  },

  "editing-file-templates": {
    steps: [
      "Create a new file with a known extension - say index.html or main.c.",
      "The standard opening boilerplate is already there.",
      "Want it empty instead? One Ctrl+Z clears the template cleanly.",
    ],
    benefits: [
      "The least memorable lines of every language stop having to be remembered.",
      "Boilerplate arrives with the cursor in the right place, so you start writing immediately.",
    ],
    betterThan:
      "Snippet systems make you define or import templates before any exist. Shipping sensible ones per extension means the first file of every kind starts right.",
  },

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

  "navigation-breadcrumbs": {
    steps: [
      "Look above the editor - the trail reads workspace, folder, file, then the symbol your cursor is in.",
      "Click the workspace or a folder to browse its files and sibling folders.",
      "Click the file for sibling and recent files, Quick Open, copy path, reveal, rename, and compare or history actions.",
      "Click a symbol crumb to search that file's outline.",
      "From the keyboard: focus the trail, use Left and Right between levels, Down or Enter to open one, then type to filter the list.",
    ],
    benefits: [
      "'Where am I' is answered without touching the explorer.",
      "Every crumb is a menu - navigation, file actions and structure all hang off the same line.",
    ],
    betterThan:
      "Static breadcrumb trails are decoration: text you can read but not use. Here every segment is a working menu, so the trail is the shortest path to everything above your cursor.",
  },

  "navigation-go-to-definition": {
    steps: [
      "Click a name - a preview of its definition opens under the line, keeping your place.",
      "Click the preview's title, or Ctrl+click the name, to actually jump there.",
      "Press Escape to close the preview when it answered the question.",
      "Read the honesty label: 'resolved' means a language server found it for certain; 'matched by name' means same-name candidates.",
    ],
    benefits: [
      "Following a call to its source takes one click, not a search-and-scroll.",
      "The resolved/matched label tells you when to trust the answer fully.",
    ],
    betterThan:
      "Most editors either have a server and get this right, or silently guest-match by name and get it plausibly wrong. Showing which kind of answer you got removes false confidence from the fallback.",
  },

  "navigation-outline": {
    steps: [
      "On by default - open the Structure popup from the activity bar.",
      "The current file's functions, classes and sections draw as a tree.",
      "Click any entry to jump straight to its line.",
      "Swap to the project tab for the same view across the whole codebase.",
    ],
    benefits: [
      "Every file gets a table of contents generated from its real structure.",
      "Jumping inside a long file replaces scrolling entirely.",
    ],
    betterThan:
      "A scrollbar presumes you remember where things are; an outline presumes nothing. Tree view with jump-on-click turns 'long file' from a hazard into a non-issue.",
  },

  "navigation-symbol-search": {
    steps: [
      "Press Ctrl+T.",
      "Type the name of the function, class or variable - you do not need to know what holds it.",
      "Results show the kind of thing and the file it lives in; arrow through them.",
      "Enter lands you exactly on the definition, regardless of where it lives.",
    ],
    benefits: [
      "Names are how you remember code - this search matches how memory works.",
      "Cross-file search by symbol beats knowing a directory tree.",
    ],
    betterThan:
      "File-based navigation asks you to remember two things - the name and its container. Symbol search asks for only the one you actually remember.",
  },

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

  "formatting-formatter": {
    steps: [
      "Press Shift+Alt+F anywhere in a file.",
      "If a language server is running for that language, ADCode asks it - it understands the language more precisely.",
      "Otherwise ADCode's own built-in formatter does the tidying.",
      "A language nothing can format is left untouched rather than damaged.",
    ],
    benefits: [
      "One shortcut ends spaces-versus-tabs debates permanently.",
      "Zero installation - the formatter ships inside the editor, with language-server upgrade built in.",
    ],
    betterThan:
      "Configuring a formatter per language is the setup chore that eats an afternoon. A built-in default that defers to a language server when one exists gives you the right answer from the first file.",
  },

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

  "formatting-organize-imports-on-save": {
    steps: [
      "Turn it on in Formatting settings; it is deliberately off by default.",
      "From then on, every Ctrl+S also sorts the import block and drops imports nothing uses.",
      "Want it once rather than always? Edit - Organize Imports does it on demand, and tells you when everything was already tidy.",
      "Off by default because it can delete a line you did not ask it to - that choice should be yours.",
    ],
    benefits: [
      "Import lists stop accumulating the debris of past refactors.",
      "Sorted imports make scanning dependencies instant and diff-clean.",
    ],
    betterThan:
      "Import tidying is either automatic-and-silent (deleting things by surprise) or manual-and-never-done. Offering both - on command by default, on save by choice - is the honest middle.",
  },

  /* ── Understanding a project ─────────────────────────────────────────── */

  "structure-project-tree-lines": {
    steps: [
      "On by default - look at the file explorer.",
      "Connecting lines join each file to the folder it lives in.",
      "Turn it off in Settings for plain indentation instead.",
    ],
    benefits: [
      "Nesting is readable at a glance instead of an estimation exercise.",
      "Deep module trees stop collapsing into a wall of indented names.",
    ],
    betterThan:
      "Indentation-only trees make you measure depth by eye. Drawing the lines removes the measuring, which is all the treelines ever needed to do.",
  },

  "structure-missing-classes": {
    steps: [
      "On by default - a class name that no stylesheet defines is flagged.",
      "Open View - Find Classes Nothing Defines to check the file in front of you on demand.",
      "Results appear in the Problems panel alongside everything else; it says so plainly when every class resolves.",
    ],
    benefits: [
      "The silent 'looks unstyled for no reason' bug becomes a named line in Problems.",
      "Typos in class names are caught where they are typed, not on some page later.",
    ],
    betterThan:
      "A mistyped class fails silently - the element simply stays unstyled. Flagging names that resolve to nothing turns a browser-console mystery into an editing-time fix.",
  },

  "structure-unused-selectors": {
    steps: [
      "Off by default. View - Find Unused CSS Rules runs it on the open stylesheet on demand, whatever the setting.",
      "It answers 'every rule matches something' when nothing is dead.",
      "Turn the setting on to have findings appear as you work.",
      "Caveat: it compares names, so classes built at runtime or by CSS modules escape it - trust it less on those projects.",
    ],
    benefits: [
      "Stylesheets stop growing forever - dead rules become visible and removable.",
      "On-demand scanning means the check exists even on projects where the automatic version would lie.",
    ],
    betterThan:
      "Dead-CSS detectors that claim certainty lie on modern tooling and get switched off. One that states its limits - and stays reachable on demand - keeps being used for years.",
  },

  "structure-selector-to-elements": {
    steps: [
      "Open the Structure popup with a CSS file in front of you.",
      "Pick a rule; the elements it styles are listed beside it.",
      "Click through any listed element to jump to where the markup uses it.",
    ],
    benefits: [
      "A class stops being a string nobody can trace and becomes a list of places it is used.",
      "Impact of changing a rule is knowable before you change it.",
    ],
    betterThan:
      "Asking 'what does .card actually hit' usually means a project-wide text search with noisy results. A real CSS-to-markup link gives the exact answer in one popup.",
  },

  "structure-element-to-rules": {
    steps: [
      "Open the Structure popup against your markup - HTML, JSX, Vue, Angular, or Handlebars.",
      "Pick an element; every rule styling it is listed.",
      "Click a rule to jump into the stylesheet that defines it.",
    ],
    benefits: [
      "'Why does this look like this' is answered without grep.",
      "Works across all five template styles the same way.",
    ],
    betterThan:
      "Reverse-lookup of styles is usually a browser-tool trick that only works on the rendered page. Doing it in the source editor means never leaving the desk to answer the question.",
  },

  /* ── Languages ───────────────────────────────────────────────────────── */

  "language-custom-servers": {
    steps: [
      "Open Settings and find Additional language servers.",
      "Write one line per language as 'language: command' - 'zig: zls' or 'elm: elm-language-server --stdio'.",
      "Click away from the box; it takes effect immediately.",
      "Open a file in that language: the server starts and full intelligence arrives.",
    ],
    benefits: [
      "Any language with a language server becomes first-class in one line.",
      "No extension ecosystem to grow or wait on - the standard protocol is the plugin format.",
    ],
    betterThan:
      "`Marketplace extension per language` is a lottery - coverage is patchy and quality varies wildly. One line to a standard server gets you the same intelligence everyone else has, from the same tool.",
  },

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
      "Typical editors bundle their own versions and decide what you get. ADCode speaks the standard protocol and uses the servers you already have, giving you the same intelligence as your command-line tools without duplicate tooling.",
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
      "Print-debugging only shows the values you remembered to print. ADCode includes visual debugging for JavaScript, TypeScript, and Python out of the box, so you can inspect the full state at each breakpoint.",
  },

  "language-tree-sitter-highlighting": {
    steps: [
      "On by default - nothing to install.",
      "Open a file; ADCode loads that language's grammar the first time it is needed.",
      "If a grammar ever fails to load, highlighting falls back to the simpler method rather than turning off.",
    ],
    benefits: [
      "Keywords inside strings, nested templates, and other tricky spots colour correctly.",
      "The same parse tree powers outline and folding, so everything agrees about the structure.",
    ],
    betterThan:
      "Regex highlighting gets confused exactly where code gets interesting. Real parsing means the colours describe the program, not the spelling of the words.",
  },

  /* ── The assistant ───────────────────────────────────────────────────── */

  "ai-terminal-team": {
    steps: [
      "Open a terminal in ADCode, right-click anywhere in it, and choose Start a Team here.",
      "Describe the whole task in one sentence - the same way you would brief one assistant.",
      "Name the CLIs you want, separated by commas, in the order they should take Build, Tests, Docs and Review. Two is a team; four is the maximum.",
      "Read the line-up and confirm. Nothing has started until you do.",
      "ADCode opens a terminal for each CLI, starts it, and gives it its own part of the task plus whatever its teammates have already finished.",
      "Watch them work. A task that depends on another one waits until that one reports it is done.",
      "To stop early, right-click any terminal and choose Stop the running Team. The terminals stay open so you can read what happened.",
    ],
    benefits: [
      "The CLIs you already pay for stop taking turns. Claude Code can write the change while Codex writes the tests and Kimi writes the docs.",
      "Each agent is briefed once, by ADCode, with the acceptance criteria and what its teammates finished - not by you, four times, in four panes.",
      "Work only starts when its dependencies are done, so the tester never reviews a half-written change.",
      "Closing one terminal fails only that task. The others keep going.",
    ],
    betterThan:
      "Multi-agent tools normally mean one vendor's agents, on one vendor's subscription, in a web app that cannot touch your working tree. ADCode orchestrates the command-line agents you already installed and already pay for - Claude Code, Codex, Grok, Kimi, Gemini, Cursor, Qwen, Amp, Goose and the rest - side by side in your own editor, on your own files. No other editor lets rival CLIs work as one team.",
  },

  "ai-auto-continue": {
    steps: [
      "Right-click a terminal running an agent and choose Continue after usage limits, or turn it on in AI settings.",
      "Set how many continuations you will allow in one session - one, three, or five.",
      "Work as normal. When the agent says it has hit a usage or rate limit and names a retry time, ADCode waits for it.",
      "At that time ADCode types a single word - continue - and tells you it did.",
      "Touch the terminal at any point and the pending continuation is cancelled, because you have taken over.",
    ],
    benefits: [
      "A long task that hits a limit at midnight is still moving at half past, without you sitting up for it.",
      "It works with whichever CLI you run - Claude Code, Codex, Grok, Kimi and the others are all recognised.",
      "The retry cap means a repeatedly limited agent stops rather than looping all night.",
      "Only the terminal output already on your screen is read, and only for a limit message with a stated retry time. An unclear message stops safely.",
    ],
    betterThan:
      "Everywhere else this is a shell script you wrote yourself, guessing at the retry time and re-sending blindly. ADCode reads the agent's own stated reset time, sends exactly one word, caps the retries, and cancels the moment you touch the keyboard.",
  },

  "ai-scheduled-messages": {
    steps: [
      "Right-click the terminal running your agent and choose Schedule a message, or run Schedule an AI Message from the palette.",
      "Write the message and pick a local time for it.",
      "Choose where it goes: the built-in assistant, or any terminal with an agent in it - each one is listed by the CLI running there.",
      "For a terminal target, right-click it and choose Allow the next scheduled message while its prompt is sitting idle.",
      "Leave ADCode open. At the chosen time the message is typed into that target.",
      "If ADCode was closed or the target was busy, the message is marked missed and waits for you to choose Run now.",
    ],
    benefits: [
      "A follow-up review at 6pm reaches the agent instead of reaching a notepad.",
      "With several CLIs running in split terminals, each is its own target - so a message written for Codex goes to Codex, not to whichever pane happened to be focused.",
      "The one-time permission means an agent mid-thought never gets interrupted by something you queued an hour ago.",
      "Nothing is silently dropped: a message that could not be delivered says so and offers to run.",
    ],
    betterThan:
      "A reminder app can tell you to prompt your agent. ADCode actually prompts it - into the right terminal, at the right time, only when that agent is genuinely idle and waiting.",
  },

  "ai-terminal-agent-detection": {
    steps: [
      "Turn it on in AI settings; it is on by default.",
      "Start any agent CLI in ADCode's terminal - claude, codex, gemini, grok, kimi, qwen, amp, goose, crush, droid, cursor-agent, aider, opencode or copilot.",
      "ADCode recognises it from the command you typed and offers to share this project's memory with it.",
      "Choose Copy to put the connection command on your clipboard, then run it once if you want it.",
      "From then on that terminal can use automatic continuation, scheduled messages and Team.",
    ],
    benefits: [
      "Detection is what turns on every other terminal AI feature, so a recognised CLI immediately gains all three.",
      "Two assistants working on one project can share what ADCode already remembers about it, instead of each starting from nothing.",
      "Recognition comes from the command you typed - nothing else about your machine is inspected.",
      "The offer appears once per agent per run, not every time you restart it.",
    ],
    betterThan:
      "Other editors treat the terminal as a dumb box that happens to be embedded. ADCode notices what you started in it and makes the editor's own memory, scheduling and orchestration available to it - without a plugin per CLI.",
  },

  "ai-connect": {
    steps: [
      "Open Connect a model from the Assistant or command palette.",
      "Choose a provider, or add a named connection with its OpenAI-compatible base URL and exact model ID. Use the NVIDIA NIM preset for https://integrate.api.nvidia.com/v1.",
      "Choose a requests-per-minute limit that fits your provider account and save the connection. All agents using that connection share the same queue.",
      "Paste your API key and choose Check and save. Keys are encrypted using this computer's operating-system credential store.",
      "Choose the model for chat, or assign the connection to a named agent. Waiting and cooldown status explain when a request is queued.",
      "If the provider still returns 429, allow its cooldown to finish. RPM pacing cannot override token quotas, account limits, or requests made outside ADCode.",
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
      "Open Assistant from the workbench or command palette.",
      "Ask about the code in front of you - the assistant can see the open project.",
      "Use History for past conversations and the activity panel for agents, tasks, and review controls. Toggle either panel for more writing space.",
      "Press Escape to dismiss it; the conversation survives dismissal.",
      "Reopen later, or find older conversations in the history list beside it.",
    ],
    benefits: [
      "No copy-pasting context into a browser window - it already has the project.",
      "Conversation history is saved per project on your machine. Prompts and relevant context go to your selected model provider when you send a request.",
      "The history is searchable, renameable, and clearable - including a single button that wipes memory.",
    ],
    betterThan:
      "Web AI chats know nothing about your files unless you paste them, which trains you to leak code into somebody else's logs. The widget answers in place, with the project as context, and shows you exactly what it remembers.",
  },

  "ai-team": {
    steps: [
      "Connect the models your agents will use in Connect a model.",
      "Open Assistant and its activity panel. Create an agent with a name, instructions, connection, and model; save it for reuse.",
      "Create at least one more agent. For example, give one implementation instructions and another review instructions. Enable Run after teammates for the reviewer so it receives the builder's handoff first.",
      "Select two to four saved agents, write the task in the composer, and choose Set up selected Team. Review the plan and start it.",
      "Watch each agent's task and state in the activity panel. Open its trace to inspect tool calls and results. Cancel the team if the task should stop.",
      "Review the combined changes before applying them to the project. Agents sharing a connection also share its requests-per-minute limit.",
    ],
    benefits: [
      "Reuse agent names and instructions across tasks without entering them again.",
      "Choose a different model for each agent and see who is working on which task.",
      "Isolated work and combined review keep parallel proposals inspectable.",
    ],
    betterThan: "Running separate chats requires manually copying instructions and results between them. ADCode assigns named agents to a shared task, passes task handoffs through the team scheduler, and brings proposals back into one review workflow.",
  },

  "ai-edit-policy": {
    steps: [
      "Open Settings and find AI edit approval.",
      "Review every change (default) holds each AI edit for your approval, hunk by hunk.",
      "Trusted auto-apply commits the model's changes automatically after a completed task - chosen projects and agents only.",
      "Either way, every applied task keeps a rollback checkpoint - Rollback walks it back unless you have edited the same files since.",
    ],
    benefits: [
      "You pick the trust level per project instead of one global gamble.",
      "Review mode is the default, so the first task of any new agent is observed, not hoped.",
    ],
    betterThan:
      "All-or-nothing auto-apply is how AI editors burn trust on the first mistake. A per-project policy - with rollback either way - lets caution and speed both exist.",
  },

  "ai-workspace-storage": {
    steps: [
      "Open Settings and find AI workspace storage.",
      "Set a disk quota for task sandboxes and retention periods for finished sandboxes and rollback checkpoints.",
      "Old sandboxes are cleaned oldest-first; the one rollback checkpoint for an applied task is protected.",
      "If space runs out, ADCode refuses the new task and says what to raise or discard - it never deletes your way back in silence.",
    ],
    benefits: [
      "Agent work cannot fill a disk without you noticing.",
      "Rollback survives cleanup, so the safety net is not the thing eaten first.",
    ],
    betterThan:
      "Tools that leave unbounded sandboxes on disk surface a day later as a mysteriously full drive. A bounded quota with a protected checkpoint keeps the system honest by construction.",
  },

  "ai-sessions": {
    steps: [
      "Open the Assistant - every conversation you have had is in the history list.",
      "Search past conversations, rename one to find it later, or delete one by one.",
      "The strip at the top shows exactly what the assistant is remembering right now, and clears it on demand.",
      "Everything is stored per project on your machine, never uploaded.",
    ],
    benefits: [
      "Wednesday's refactoring conversation is still there when Friday needs it.",
      "Memory that is visible and clearable is memory you can trust.",
    ],
    betterThan:
      "Assistants that forget every session start you from zero each time; assistants that remember invisibly are worse. Showing the remembered context and offering 'clear it' turns memory into a feature instead of a liability.",
  },

  "ai-custom-base-url": {
    steps: [
      "Open Connect a model from the Assistant or palette.",
      "Set Provider to Custom and paste any OpenAI-compatible base URL - a gateway, a proxy, or a model on localhost.",
      "Add your key and choose Check and save; the key is verified before it is stored.",
    ],
    benefits: [
      "Every OpenAI-compatible service in the world is one address away, including ones that did not exist when this shipped.",
      "Local models on your own machine need no key and send nothing anywhere.",
    ],
    betterThan:
      "Hard-coded provider lists freeze at release day. A custom endpoint makes ADCode work with whatever appears next - or whatever already exists on your own hardware.",
  },

  "ai-isolated-workspaces": {
    steps: [
      "On by default - the assistant works in a private copy of your project.",
      "Watch the task strip in chat for state, changed files, and the Review button.",
      "Review lets you accept individual files or hunks, discard the whole proposal, or roll back an applied one.",
      "Turn the feature off to keep chat while disabling all file tools.",
    ],
    benefits: [
      "An agent's bad idea never touches your real tree - you see it, in isolation, before it becomes true.",
      "A full checkpoint precedes every apply, and rollback refuses to clobber your own later edits.",
    ],
    betterThan:
      "Editing in place means the first mistake is in your working copy before you have decided anything. An isolated sandbox makes review the gate it always should have been.",
  },

  "ai-mcp-server": {
    steps: [
      "Open Settings and find the MCP server section - it is on by default.",
      "Copy the connection command shown there.",
      "Run it once from your project folder; that is the entire setup.",
      "Any MCP-capable tool - Claude Code, Codex, and the rest - now reads and writes the same notes as ADCode's assistant.",
    ],
    benefits: [
      "Every assistant you run shares one project memory instead of five partial copies.",
      "Notes go both ways: what a terminal agent learned is visible to the built-in one.",
    ],
    betterThan:
      "Each AI tool keeping its own silo means every session starts from zero context. A shared MCP server makes the project itself the memory - one source, every assistant.",
  },

  "ai-memory-capture": {
    steps: [
      "On by default - the assistant jots decisions and conventions it learns.",
      "The memories land in plain markdown files inside your project folder.",
      "Read or edit them like any other file; Settings shows where they are.",
      "Delete a line and it is forgotten, permanently and visibly.",
    ],
    benefits: [
      "You stop re-explaining the same project conventions at each new chat.",
      "The memory format is markdown in your repo - inspectable, committable, deletable.",
    ],
    betterThan:
      "Opaque assistant memory is un-auditable and prevents teammates from seeing what the tool thinks the project is. Markdown in the repo is memory you can own.",
  },

  "ai-model": {
    steps: [
      "Open the model picker in the Assistant or in Settings.",
      "The list shows the models your key can actually reach - not a hard-coded set.",
      "Pick one; the next message uses it. The conversation does not restart.",
    ],
    benefits: [
      "Swap lighter/heavier models per question instead of per product.",
      "The list reflects your account - no feature-choice marketing between you and the answer.",
    ],
    betterThan:
      "Bundled-model editors pick the default that makes their economics work, not yours. Showing what your key can actually call and letting you choose per task keeps that decision where it belongs.",
  },

  "ai-provider": {
    steps: [
      "Open Connect a model and choose a provider - Anthropic, OpenAI, Google, or any OpenAI-compatible endpoint.",
      "Paste your key; ADCode checks it really works before saving.",
      "Keys go into your operating system's credential store, never a plaintext file.",
      "Prefer zero-cloud? The local option talks to a model on your own machine and needs no key.",
    ],
    benefits: [
      "The AI bill comes from your provider at provider prices, with no per-token markup.",
      "A mistyped key fails at setup with a readable message, not a mystery error later.",
    ],
    betterThan:
      "Subscription bundlers resell you the AI at a markup with a pick-list of models. Bring-your-own primitives - provider, key, local option - put the commercial decision back in your hands.",
  },

  "ai-task-token-budget": {
    steps: [
      "Find the Task token budget setting - default 100k per task.",
      "The task strip shows reserved tokens while a task runs.",
      "When the next request would cross the limit, ADCode pauses first and asks instead of spending.",
      "Raise the ceiling in Settings or start a new task for a fresh allowance.",
    ],
    benefits: [
      "A hard pre-request ceiling beats any after-the-fact warning label.",
      "Runaway tool loops stop on their own instead of draining your key.",
    ],
    betterThan:
      "Most tools warn after tokens are gone, or not at all. Reserving before the request is the only version of the feature that cannot be circumvented by a bad loop.",
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

  "git-blame": {
    steps: [
      "Put the cursor on a line and run Git - Blame This Line.",
      "It answers with the author, the commit, and the commit message.",
      "Uncommitted lines say so plainly instead of inventing a ghost commit.",
      "Turn the setting on to get a faint per-line note everywhere instead.",
    ],
    benefits: [
      "Reading code becomes reading intent: who added it, and what they said they were doing.",
      "On demand by default - the information is there without the constant noise.",
    ],
    betterThan:
      "Grepping git log manually takes a minute per question. Blame makes it one click - and the setting for per-line notes is opt-in, respecting people who do not want permanent annotations.",
  },

  "git-branch-switcher": {
    steps: [
      "Click the branch name in the bottom-left corner.",
      "Pick another branch to switch to, or type a name to create one.",
      "Git - Checkout Branch and Git - Create Branch do the same from the menu.",
    ],
    benefits: [
      "Experiments live on branches instead of in your main working tree.",
      "Branch creation is cheap enough that 'try it' always wins over 'risk it here'.",
    ],
    betterThan:
      "Branching from the command line is fine until the fifth context switch of the day. Hiding the paperwork does not change the tool - the repo stays ordinary git - but it makes the safe path the easy path.",
  },

  "git-file-timeline": {
    steps: [
      "Open a file and run Git - File Timeline, or look under Timeline in the Source Control panel.",
      "Every commit that touched this file is listed, newest first; it says so when none has yet.",
      "Click any entry to see the file as it was - and what that commit changed.",
    ],
    benefits: [
      "'When did this break' becomes a scroll, not a detective story.",
      "The answer is scoped to the file in front of you, not the whole repo history.",
    ],
    betterThan:
      "Repo-wide history forces you to filter noise yourself. File-level timeline is the shape of the question 'what happened to this', which is the question you actually had.",
  },

  "git-gutter-diff": {
    steps: [
      "On by default - the left margin of the editor shows your uncommitted changes.",
      "Green is added, blue is changed, a small triangle marks a deletion.",
      "Click a mark to see the previous content and to undo just that change.",
    ],
    benefits: [
      "You always know at a glance what you have touched since the last commit.",
      "Per-change undo means cleaning up a mess without touching good edits.",
    ],
    betterThan:
      "Diff tools that require opening a separate view hide the answer behind an action. Inline marks answer 'what did I change' continuously, in the same view where you are changing things.",
  },

  /* ── Your session ────────────────────────────────────────────────────── */

  "session-auto-save": {
    steps: [
      "On by default - just stop typing, and the file saves itself after the pause.",
      "The pause matters: it never writes mid-word.",
      "Ctrl+S still works whenever you want it to.",
      "Turn it off in Session settings if you prefer fully manual saves.",
    ],
    benefits: [
      "Losing work to a crash, close, or power cut stops being possible in the normal case.",
      "The reflexive Ctrl+S every three seconds becomes optional habit, not survival skill.",
    ],
    betterThan:
      "Auto-save that fires on a timer writes mid-thought; auto-save on pause reads the room. ADCode waits for a gap in typing, so the file on disk is always a finished thought.",
  },

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

  "session-local-file-history": {
    steps: [
      "On by default - ADCode keeps its own copies of files as you edit, independent of git.",
      "File - Local History lists every snapshot of the file in front of you, newest first.",
      "It says plainly when there are none yet, so you never guess.",
      "Pick a snapshot - it opens read-only beside your working copy, so nothing can be overwritten by accident.",
      "Copy back exactly the parts you need.",
    ],
    benefits: [
      "The undo that survives closing the file, restarting the machine, and never having committed.",
      "Read-only snapshots mean recovery can never destroy current work.",
    ],
    betterThan:
      "Git covers what you committed; most editors offer nothing beyond that. Local history covers the gap between saves and commits, which is precisely where the panic lives.",
  },

  "session-workspace-restore": {
    steps: [
      "On by default and invisible - close the window when you are done.",
      "Next launch reopens the same folder with the same tabs.",
      "Combined with terminal state and crash recovery, the session is the whole working position.",
    ],
    benefits: [
      "Morning setup - reopen folder, reopen files, scroll back - disappears.",
      "Closing the app is free; nothing about your arrangement is lost.",
    ],
    betterThan:
      "Reconstructing your layout by hand every morning is a silent tax most editors take for granted. Restoring by default costs nothing to anyone who did not need it.",
  },

  /* ── The workbench ───────────────────────────────────────────────────── */

  "workbench-all-features": {
    steps: [
      "Click the four-cell All Features button below Earnings, or find it under View.",
      "Search by a feature's name, or describe what you are trying to do.",
      "Press Open beside a feature to use it immediately.",
      "Press ? for its plain-language explanation.",
    ],
    benefits: [
      "Nothing stays hidden behind an unknown command name or menu path.",
      "Discovery and explanation live in the same place - find it, learn it, use it, in one stop.",
    ],
    betterThan:
      "Feature discovery in most editors is word of mouth and digging menus. A searchable library with Open and ? beside every entry turns 'does this editor do X' into a question you can answer alone.",
  },

  "workbench-keybindings": {
    steps: [
      "Help - Keyboard Shortcuts opens the searchable list.",
      "Find a command, click its current keys, and press your replacement.",
      "Conflicts are surfaced immediately instead of silently stolen.",
      "Nothing is written until you confirm.",
    ],
    benefits: [
      "Muscle memory from other editors comes with you instead of being retrained.",
      "Conflict warnings mean rebinding never breaks something you forgot about.",
    ],
    betterThan:
      "JSON keybinding files force you to know both syntax and command IDs. A visible list with in-place editing and conflict checks makes it a UI, not a config-file adventure.",
  },

  "workbench-preview": {
    steps: [
      "Open any HTML file and start the live preview.",
      "Edit - the preview reloads itself on save.",
      "Switch device sizes from the preview toolbar to check layouts.",
      "Undock to a separate window if you want it on another screen.",
    ],
    benefits: [
      "Save-and-switch-to-browser becomes a thing you used to do.",
      "Layout experiments iterate at the speed of typing.",
    ],
    betterThan:
      "External live-reload setups mean installing a server and managing a port per project. A built-in preview pointed at the open file makes the loop part of the editor, not an assembly project.",
  },

  "workbench-universal-search": {
    steps: [
      "Click the search box in the title bar.",
      "Type a feature name, a command, a file, a recent folder, or a symbol.",
      "Start with > for commands specifically.",
      "Arrow through results; Enter opens the highlighted one.",
      "Ctrl+P, Ctrl+Shift+P, Ctrl+T, and Ctrl+Shift+F still open their focused versions directly.",
    ],
    benefits: [
      "One search for when you know what you want but not which menu owns it.",
      "Focused searches remain for the cases where you know exactly.",
    ],
    betterThan:
      "Most editors make you pick the right search first - wrong picker, no results. One combined search with > for commands answers 'where is the thing' in any direction you meant it.",
  },

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

  /* ── Appearance ──────────────────────────────────────────────────────── */

  "appearance-theme": {
    steps: [
      "Open Settings and find Appearance.",
      "System is the default: light and dark follow your computer, accent colour included.",
      "Choose Light or Dark to override it; the change applies everywhere immediately.",
    ],
    benefits: [
      "The editor matches your room at night without you remembering to switch.",
      "One setting, zero plugins, correctly applied to every panel.",
    ],
    betterThan:
      "Theme ecosystems elsewhere mean choosing from ten thousand variants because the default is wrong. System-following as the default means most people never set anything, and the two overrides exist for those who want them.",
  },

  "appearance-density": {
    steps: [
      "Open Appearance settings and find Density.",
      "Comfortable gives generous spacing; Compact packs more onto the screen.",
      "The switch applies instantly, everywhere - no restart, no partial repaint.",
    ],
    benefits: [
      "Big monitors get air; small laptops get room to work.",
      "One switch covers the whole workbench instead of a dozen per-panel knobs.",
    ],
    betterThan:
      "Zoom-hacking the whole UI distorts text; density toggles the spacing itself. Comfortable and Compact are the only two answers that were ever actually needed.",
  },

  /* ── Account ─────────────────────────────────────────────────────────── */

  "account-earnings": {
    steps: [
      "Click Earnings in the title bar.",
      "Every row is a real event with the exact amount credited.",
      "Your balance is those rows added up - so the number and the list can never disagree.",
      "Rows cannot be edited or deleted; a correction is a new row that points at the one it corrects.",
    ],
    benefits: [
      "The number is checkable arithmetic, not a claimed total.",
      "The same rows appear on the web dashboard - the story is identical in both places.",
    ],
    betterThan:
      "A balance figure on any platform is only as trustworthy as the promise not to change it. An append-only ledger removes the need for trust entirely - the balance is the rows.",
  },

  "account-sign-in": {
    steps: [
      "Click the account button in the title bar.",
      "Sign in with Google, GitHub, or an email address.",
      "Anything you earned anonymously comes with you - nothing is forfeit for joining late.",
    ],
    benefits: [
      "Your balance stops living on one machine and follows you instead.",
      "No account is required to start; the anonymous-begin choice is real.",
    ],
    betterThan:
      "Account-first products gate every feature on a sign-up form. ADCode earns immediately and anonymously, and signs in later purely to make your earnings portable - in that order.",
  },

  /* ── Files and gestures ──────────────────────────────────────────────── */

  "gestures-multi-select": {
    steps: [
      "Right-click any file for the full menu - rename, move, copy, delete.",
      "Drag to move; hold Ctrl while dragging to copy instead.",
      "Press F2 to rename with the keyboard.",
      "Deletes go to the recycle bin, so mistakes are recoverable.",
      "For two files at once: Split editor right from a tab header, drag the divider to taste, Merge editor panels when done.",
    ],
    benefits: [
      "Ordinary file chores stop meaning a trip to a file manager.",
      "Recycle-bin deletes and panel merge keep mistakes cheap.",
    ],
    betterThan:
      "The file handler that only opens files forces the ordinary work of file management onto external tools. In-place gestures - drag, F2, recycle-bin - are how a file list should have always worked.",
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

  /* ── Updates ─────────────────────────────────────────────────────────── */

  "updates-auto": {
    steps: [
      "Leave it on, which is the default. New versions download in the background.",
      "Keep working. ADCode never restarts itself and never asks you to.",
      "Close the editor when you are ready. The next launch is the new version.",
      "Help → Check for Updates asks straight away and tells you where you stand.",
      "Turn it off to update by hand; Help → Check for Updates still works.",
    ],
    benefits: [
      "An update never costs you an unsaved buffer, because it applies on a restart you chose.",
      "No modal demanding a restart, and no progress bar between you and your work.",
      "Whichever way you installed ADCode, only one thing is ever updating it.",
    ],
    betterThan:
      "Where ADCode installed itself, it updates itself; where something else installed it, that keeps the job. From the Microsoft Store the Store updates it, and on Linux your package manager does — in those builds ADCode's own updater stands down instead of downloading a copy it has no permission to apply, and Settings tells you so rather than showing a check that can never succeed.",
  },

  "updates-whats-new": {
    steps: [
      "On by default - occasionally, a small card tells you what your latest update changed.",
      "It appears at most once per version, and only when you are idle - never mid-typing, mid-command, or mid-debug.",
      "Minor fixes install silently; only releases worth reading announce themselves.",
      "Dismiss it and that version never asks again. Help - What's New holds every past note.",
      "A security fix is allowed to be less patient - it will not wait for a quiet moment, but it still respects a fully-switched-off setting.",
    ],
    benefits: [
      "Features actually ship to you, rather than hiding in an update you never noticed.",
      "Never-on-first-install keeps the new-user experience clean.",
    ],
    betterThan:
      "The default industry behaviour is a modal on every upgrade. Four rules - once per version, idle-only, worth-reading-only, never-first-launch - keep this as the rare, useful kind of announcement.",
  },

  /* ── Understanding a project ─────────────────────────────────────────── */

  "structure-css-links": {
    steps: [
      "Open the project map from the Structure area.",
      "Click a style rule to see the elements it styles; click an element to see the rules that style it.",
      "Works in HTML, JSX className, and Vue, Angular, and Handlebars templates.",
      "Optional detectors - rules that style nothing, classes nothing defines - are switchable per project.",
    ],
    benefits: [
      "The two-way trace replaces project-wide text search with ground truth.",
      "Style questions about markup and markup questions about styles are the same tool.",
    ],
    betterThan:
      "The class link is the least traceable thing in any codebase, and every file-type-specific CSS tool solves only its own dialect. Cross-template, two-way linking in one popup is the shape of the actual problem.",
  },

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
    "Instead of bundling separate versions of every toolchain, ADCode speaks the standard protocols - LSP for intelligence, DAP for debugging, and tree-sitter for highlighting - and uses the servers installed on your machine. You get the same understanding as your command-line tools, with one configuration line for anything unsupported and no duplicate tooling.",
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
  Account:
    "Your earnings and your sign-in are visible surfaces, not obscured server state: an append-only ledger whose total is arithmetic you could redo by hand, and a sign-in flow whose only job is to keep those earnings attached to you. Neither page asks for trust it could instead demonstrate.",
  "Files and gestures":
    "A file list that can only open files outsources the choreography back to the operating system. In-place rename, drag-to-move, Ctrl-drag-to-copy, recycle-bin deletes, and editor panes that split and merge make the workbench self-contained.",
  "Ads and earnings":
    "Ad-supported usually means the terms are one-sided and the schedule is whatever pays best. ADCode enforces its ad cadence on your machine, can only ever tighten it from the server, credits half of every payment to an append-only ledger you can audit row by row - and switching the whole thing off removes nothing else.",
  Updates:
    "Updates download in the background and apply when you reopen - never mid-thought, never a modal demanding a restart. Release notes reach you at most once per version, only when worth reading, and security fixes are the sole exception allowed to hurry.",
};
