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
      "Turn it on in Editing settings - it is off by default, so Enter always starts a new line.",
      "Type until the suggestion list appears, then keep typing to narrow it.",
      "Press Enter to take the highlighted suggestion at once.",
      "Tab still takes suggestions either way.",
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
      "Turn it on in Editing settings - it is off by default to keep the editor quiet.",
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
      "Turn it on in Editing settings - it is off by default.",
      "The right edge shows the file reduced to a thumbnail.",
      "Click anywhere on the minimap to jump straight there.",
      "Drag the highlighted viewport box to scrub through the file.",
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
      "Turn it on in Editing settings - it is off by default.",
      "Scroll down inside a long function.",
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
      "For a file in a folder your .gitignore leaves out, open it from the file tree instead - search skips those folders, along with node_modules, build output, and the .claude/worktrees copies coding agents make.",
    ],
    benefits: [
      "You see every hit before anything changes - no surprise diffs.",
      "Pattern search catches variants a plain find misses.",
      "Results stay live as you edit, so renames across many files stay trackable.",
      "Results come from your code, not from build output or an agent's second copy of the project - and a replace never rewrites those copies behind your back.",
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
      "Turn it on in Formatting settings - it is off by default, so saves never rewrite your file uninvited.",
      "Open any file and edit it as usual.",
      "Save with Ctrl+S.",
      "The formatter tidies the file first; then the save lands.",
      "Prefer to tidy manually? Press Shift+Alt+F any time.",
    ],
    benefits: [
      "Your files never drift out of house style - nobody has to remember anything.",
      "Diffs stay about your change, not about whitespace.",
      "If a formatter cannot handle the language, the save proceeds untouched rather than mangling the file.",
    ],
    betterThan:
      "Zero install is the difference. Most setups need a formatter extension, a config file, and a settings toggle before the first save formats anything. In ADCode the formatter is built in, defers to a language server when one exists, and formats on save once you opt in.",
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
      "Open Connect a model from the Assistant or command palette - or choose Connect on the banner that says ADCode works directly with your codebase.",
      "Follow the three steps at the top: choose a provider, check and save its key, pick a model. The steps light up and the progress bar fills as you complete them. Add a named connection with its OpenAI-compatible base URL and exact model ID for anything else. Use the NVIDIA NIM preset for https://integrate.api.nvidia.com/v1.",
      "Choose a requests-per-minute limit that fits your provider account and save the connection. All agents using that connection share the same queue.",
      "Paste your API key and choose Check and save. Keys are encrypted using this computer's operating-system credential store.",
      "Choose the model for chat - the first one listed is the recommended default - or assign the connection to a named agent. Waiting and cooldown status explain when a request is queued.",
      "Set thinking effort if you want reasoning models to think harder than their default: Auto lets the provider decide, Max costs the most. For a custom address, follow the three numbered hints and choose Save endpoint.",
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

  "ai-free-key": {
    steps: [
      "In Vibe, choose Connect your AI - free in the checklist. Or just send a message: with no model connected, the reply offers the same choices, and your message waits in the box until one is connected.",
      "Press Get my free key. Google AI Studio opens in your browser.",
      "Sign in with any Google account, click Create API key, and copy the key.",
      "Come back to ADCode. The copied key is picked up and checked on its own - you can also paste it into the box. When it says Connected, you are done, and a waiting message sends itself.",
      "Prefer to keep everything on your computer? If Ollama is running, a second card offers Use it, with the best installed model for coding already chosen.",
      "Already have a key from OpenAI, Anthropic, OpenRouter, Groq, xAI, DeepSeek or Cerebras? Paste it under I already have a key - ADCode recognises which service it belongs to.",
    ],
    benefits: [
      "No credit card and no account with an AI company: a Google account is enough.",
      "Nothing is saved until the model has answered a test message, so a bad key never leaves you half set up.",
      "You can switch to a paid key or another provider at any time in Connect a model; the free one stays as an option.",
    ],
    betterThan:
      "Most AI editors make you start a paid plan or a trial before the AI answers at all. ADCode gets you building with a free key in about a minute. Be aware that Google's free tier may use what you send to improve its products - for private or work code, use a paid key.",
  },

  "workbench-new-project": {
    steps: [
      "With no folder open, describe what you want built in the chat - for example \"build a snake game\" or \"make a landing page for my bakery\".",
      "ADCode makes a new folder for it in Documents › ADCode Projects, named after your idea, and opens it.",
      "Your request goes to the assistant, which builds it. Unless you named a framework, it uses plain HTML, CSS and JavaScript, so it runs in the preview straight away with nothing to install.",
      "You can also run New Project from an Idea from the command palette (Ctrl+Shift+P), or use the box on the welcome screen.",
    ],
    benefits: [
      "Start from an idea, not from a folder: there is no empty-folder step between you and a working first version.",
      "Every project lives in one place, named after what it is, so you can find it again next week.",
      "A question asked with no folder open is just answered - no folder is made for it.",
    ],
    betterThan:
      "Other editors open on an empty window and expect you to create, name and open a folder before anything happens. ADCode treats your idea as the starting point.",
  },

  "workbench-welcome": {
    steps: [
      "On first launch, type what you want to build, or pick one of the ideas under the box.",
      "Press Build it, or Enter.",
      "If no AI is connected yet, the next step offers the free option - it takes about a minute and needs no card.",
      "ADCode makes the project, opens it and starts building your idea.",
      "Skip or Escape closes the welcome at any time. Run Show Welcome from the command palette to see it again.",
    ],
    benefits: [
      "The first thing you see ADCode do is build what you asked for.",
      "Theme, ad frequency and account wait in Settings instead of standing between you and a first result.",
    ],
  },

  "ai-inline-completion": {
    steps: [
      "Connect a model once (see Connect a model).",
      "Turn inline completion on in AI settings - it is off by default.",
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
      "While it works, the answer builds in the order it happens, as in Claude: a block of work, the text it led to, the next block of work, more text. In a running block the blue mascot bounces as the header names the current step with elapsed time, and tool calls stream in as bordered rows. Hover the mascot and its white eyes follow you; click it for a morale-boosting quip.",
      "As soon as the assistant writes again, the block before it collapses to Worked for Ns - select its header to expand that step's trace again.",
      "Scroll up mid-stream and the view stays pinned while a Jump to latest pill appears with a count of new messages - select it to return to the tail.",
      "If you stop a turn, the interrupted banner offers Edit prompt (your last message back in the composer) and Try again.",
      "If a turn fails, a card in the conversation names the problem - a rate limit, a request too large for the model, a rejected key, a broken tool call or a network problem - with Try again, Switch model, Start fresh or Report problem, and the provider’s exact message under Details.",
      "Read answers with labelled code blocks, inline commands, and numbered steps. Use the icon row under each response to Copy, Read aloud, mark helpful or not helpful, or Retry - with relative time like just now.",
      "Use History for past conversations. Team setup, schedules and live activity open in a floating panel, and the Agents page shows every agent at work - the conversation keeps its full width.",
      "Press Escape to dismiss it; the conversation survives dismissal.",
      "Reopen later, find older conversations grouped by recency, or choose Share to copy one as markdown.",
      "On an empty conversation, pick a starter - Explain this project, Build something, Fix an error, Plan new idea or Multitask - to get going in one click. In Vibe, a short checklist above the composer shows anything still missing, such as opening a project folder or connecting a model.",
      "If a long task stops at the step limit, choose Continue and the assistant picks up where it stopped with everything it already did.",
    ],
    benefits: [
      "No copy-pasting context into a browser window - it already has the project, the file you are on and what you selected.",
      "Changes to existing files are exact replacements rather than full rewrites, so large files are edited quickly and nothing outside the change can be dropped.",
      "Several files are read at once, and a single request can run up to 50 steps - reading, editing, running tests - before it needs you.",
      "Conversation history is saved per project on your machine. Prompts and relevant context go to your selected model provider when you send a request.",
      "The history is searchable, renameable, and clearable - including a single button that wipes memory.",
    ],
    betterThan:
      "Web AI chats know nothing about your files unless you paste them, which trains you to leak code into somebody else's logs. The widget answers in place, with the project as context, and shows you exactly what it remembers.",
  },

  "ai-inline-edit": {
    steps: [
      "Open a file in Code mode and select the lines you want changed. To generate new code instead, just put the cursor where it should go.",
      "Press Ctrl+E, or right-click and choose ADCode: Edit with AI. A prompt bar opens right above the selection and pushes the code down rather than covering it.",
      "Type what you want - \"add input validation\", \"convert this to async/await\", \"handle the empty list\" - and press Enter.",
      "The rewrite lands in place, highlighted green, with the lines it replaced shown struck through above it so you can compare at a glance.",
      "Press Ctrl+Enter or Accept to keep it. Press Esc or Reject to put the original back exactly.",
      "Not quite right? Type a follow-up such as \"also log the error\" and press Enter to refine the result without starting over.",
      "Save when you are happy. Until then it is an ordinary unsaved change, and Ctrl+Z undoes it.",
    ],
    benefits: [
      "Small edits never leave the code: no conversation, no copy and paste, no switching panels.",
      "You see exactly what changed before you keep it, and one key undoes it after.",
      "Nothing reaches disk until you save, the same review-first promise the assistant makes for bigger work.",
      "It uses whichever model you connected, including local ones, and sends only the selection plus the code around it.",
    ],
    betterThan:
      "Inline edit is the feature people switch editors for, and elsewhere it is often a paid extra tied to one vendor's models. In ADCode it is built in, works with the model you already connected, and shows the replaced lines beside the rewrite instead of asking you to trust a silent swap. Unlike a chat answer you paste yourself, the change is exact, undoable and scoped to what you selected.",
  },

  "ai-composer-commands": {
    steps: [
      "Open the Assistant (Ctrl+I) and type / at the start of the composer to see every command.",
      "Keep typing to filter - /re finds /review and /refactor - then press Enter or Tab. Arrow keys move through the list; Esc closes it.",
      "Choose /review to attach your uncommitted changes and get a bug-focused review with file and line, or /commit for a ready-to-use commit message.",
      "Choose /fix, /test, /plan, /refactor, /explain, /optimize, /security, /docs or /build to start a carefully worded request, then add your own details and send. /check asks the assistant to look at your running app in its own browser and fix what is broken.",
      "Type @ anywhere in a message to search your project's files. Pick one and it rides along as a chip; if it is open in the editor, its unsaved text is what gets sent.",
      "In an empty composer, press the Up arrow to bring back what you sent before - handy for re-running a request after a fix.",
    ],
    benefits: [
      "Common requests take two keystrokes, and each one asks for verification - tests run, typechecks pass - instead of an unchecked guess.",
      "/review reads the real diff from git, including staged work and newly added files, so nothing gets reviewed from memory.",
      "@ puts exactly the file you mean in front of the model, which saves a round of it searching for the wrong one.",
      "Commands that change code follow your edit approval: by default the edits land as the assistant works, and Undo in the chat takes any turn back.",
    ],
    betterThan:
      "Most chat panels make you type the same careful instructions again and again, or keep them in a notes file. ADCode ships the good versions as commands, reads your diff for you, and lets you point at a file with @ instead of pasting it, so the prompt you send is the prompt an experienced engineer would write.",
  },

  "ai-sees-your-app": {
    steps: [
      "Open a web project - plain HTML files, or a Vite, Next or other framework project - and connect a model in Connect a model.",
      "Ask in plain words: \"check the signup form works\", \"look at the pricing page on a phone\", or \"open the about page\". Or type /check in the composer, or run AI: Check My Running App from the command palette.",
      "The assistant starts the live preview if it is not running (your framework's dev server, or a plain file server) and waits until it has an address.",
      "It loads the page in a browser of its own, clicks and types through it the way you described, and reads what happened: the text on screen, console errors, failed requests, broken images, and anything spilling sideways at phone width.",
      "It fixes what it found and looks again to confirm. The latest screenshot it took sits in the conversation under What the assistant saw, with how many problems it found - click it to open that page in the preview.",
      "When it opens a page for you, the preview card in the chat and an open preview window both go to that page. You can do the same yourself: click the preview's address, type /about.html and press Enter.",
    ],
    benefits: [
      "\"It works\" means the assistant saw it work, not that the code looked right.",
      "Broken images, 404s and console errors are caught by the assistant before a visitor finds them.",
      "Phone layouts get checked at a real phone width (390 pixels), not guessed from CSS.",
      "It tests flows, not just pages: fill the form, press the button, read what came back.",
      "Models that cannot read images still get the full text report, so this works with any provider.",
    ],
    betterThan:
      "Most AI editors stop at the code: you run the app, look at it, and paste the error back in. Browser extensions for agents need installing, a separate server, and permission prompts. In ADCode the assistant already has a browser that opens only your own local addresses and forgets everything when it closes, so checking the page is part of finishing the job rather than a job left for you.",
  },

  "ai-agent-tools": {
    steps: [
      "Ask for the job in plain words - \"move the images into assets and fix the links\", \"rename utils.js to helpers.js\", \"delete the old landing page\", \"start the dev server and check the home page\".",
      "Deletes, moves and renames happen with proper file tools, not shell commands. The Changed files card under the answer lists them, deletions struck through, and Undo puts every one back - images and other binary files byte for byte.",
      "Long commands - installs, builds, test suites - may run for up to ten minutes and report their real exit code. Press Stop and the command ends along with everything it started.",
      "Servers and watchers run in the background while the assistant keeps working: it reads what they print, spots the address a dev server announces, and looks at it. They stop when you close the folder or quit.",
      "For a bigger job, a Plan card appears in the conversation with every step, ticked off as each one finishes.",
      "To see every tool in plain words, run Tools: The Assistant's Built-in Tools from the command palette.",
    ],
    benefits: [
      "Nothing the assistant deletes or moves is gone for good: one Undo puts the whole turn back.",
      "\"npm install\" and full test runs finish instead of timing out after thirty seconds.",
      "A dev server keeps running for the rest of the conversation instead of blocking it.",
      "Search shows the lines around each match and finds code like add( as plain text, so the assistant reads less to find more.",
      "Edits survive an indentation mismatch instead of failing and starting over, and documentation pages come back as clean text, not raw HTML.",
    ],
    betterThan:
      "Agents without these tools improvise: rm and mv in a shell, which no Undo reverses; servers started in the foreground that hang the turn; thirty-second limits that kill every install. ADCode gives the assistant the tools a careful engineer would use, puts every file change under one Undo, and shows its plan while it works, so you can let it run and still put things back.",
  },

  "ai-team": {
    steps: [
      "Connect the models your agents will use in Connect a model.",
      "Open Agents from the Vibe sidebar. Under Your agents, use the starter agents or choose New agent and give it a name, look, instructions, connection, model and the tools it may use.",
      "Make sure you have at least two agents. For example, give one implementation instructions and another review instructions. Enable Run after teammates for the reviewer so it receives the builder's handoff first.",
      "Choose Select for a Team, tick two to four agents, press Set up Team and describe the shared task.",
      "The Team appears as one box under Needs you with its members' mascots. Press Start. Select the box any time to see each step it took; press Stop if the task should end.",
      "Review the combined changes before applying them to the project. Agents sharing a connection also share its requests-per-minute limit.",
    ],
    benefits: [
      "Reuse agent names and instructions across tasks without entering them again.",
      "Choose a different model for each agent and see who is working on which task.",
      "Isolated work and combined review keep parallel proposals inspectable.",
    ],
    betterThan: "Running separate chats requires manually copying instructions and results between them. ADCode assigns named agents to a shared task, passes task handoffs through the team scheduler, and brings proposals back into one review workflow.",
  },

  "ai-auto-compact": {
    steps: [
      "Just keep chatting. The ring beside the chat's composer shows how full the model's context is - Context 34%, say - and hovering it gives the numbers.",
      "When the conversation reaches 80% of what the model can read, ADCode asks the same model to summarise the older part. The chat shows Earlier conversation compacted; press View summary to read what it kept.",
      "To make room yourself, type /compact and press Enter, or say what matters most: /compact keep the database decisions. Compact now is also on the meter and in the command palette as AI: Compact Conversation.",
      "Close ADCode, come back tomorrow and open the conversation from Conversations. The assistant starts from the saved summary and the messages after it, so it still knows your project, your decisions and what was left to do.",
      "Switching model mid-conversation keeps the conversation too. To change when compaction happens - 70%, 80% or 90% - or turn it off, choose Auto-compact settings on the meter.",
    ],
    benefits: [
      "A long conversation never dies at the model's limit - it keeps going for as long as the work does.",
      "No re-explaining: reopening a chat or switching model keeps what the assistant knew.",
      "The summary is readable and saved with the conversation, so you can see exactly what the assistant carries forward.",
      "Long Agents-board runs compact the same way instead of stopping halfway through a big task.",
    ],
    betterThan:
      "Most AI chats either fail when a conversation outgrows the model or quietly drop the oldest messages, and many forget everything when you reopen them. ADCode summarises instead of dropping, tells you when it has, shows you the summary, and keeps it with the conversation for next time.",
  },

  "ai-race-mode": {
    steps: [
      "Open Agents and press New task, or run Agents: Race Several Agents on One Task from the command palette.",
      "Describe the task, turn on Race, and tick two or three agents - different models make the race worth having.",
      "Press Start. Each agent works in its own copy of the project, and its box is labelled Race 1 of 3 and so on.",
      "When every lane has finished, press Compare on any of them to see each lane's agent, model, cost, proof of work and summary side by side.",
      "Press Keep this one on the lane you prefer. It is applied to your project; the other lanes are discarded.",
    ],
    benefits: [
      "Pick the best of several attempts instead of fixing an almost-right one.",
      "See which model actually does your kind of task best, with evidence, not benchmarks.",
      "Your project changes once, with the lane you chose.",
    ],
    betterThan:
      "Trying another model normally means copying the prompt into another tool and comparing by eye. ADCode runs the lanes side by side in isolated copies, shows the proof for each, and applies only the one you keep.",
  },

  "ai-agent-mascots": {
    steps: [
      "Open Agents. Every saved agent already has a look of its own.",
      "Select Edit on an agent and pick one of eight shapes and ten colours; the preview updates as you choose. Save.",
      "Give it a task and watch its face on the board: thinking while it works, alert with a ! when it needs you, proud when its work is ready, happy once it lands, confused if something went wrong, sleepy while it waits.",
    ],
    benefits: [
      "Tell agents apart on a busy board without reading names.",
      "Spot the one that needs you from across the screen.",
    ],
    betterThan:
      "Agent lists in other tools are rows of identical text. A face that changes with the work tells you where to look first.",
  },

  "ai-parallel-agents": {
    steps: [
      "Open Settings and choose AI.",
      "Set Agents working at once to a number from 1 to 6. Three is the default.",
      "Start more tasks than that on the Agents page; the extra ones show Queued and start on their own, oldest first, as others finish.",
    ],
    benefits: [
      "Finish a pile of tasks sooner, or keep spending and rate limits gentle - your choice.",
      "Nothing is dropped when you start too many: it simply waits its turn.",
    ],
    betterThan:
      "Some tools cap parallel agents by plan tier. ADCode lets you choose, and the limit covers Teams too, so a big Team cannot swamp your provider.",
  },

  "ai-memory-editor": {
    steps: [
      "Open Tools and choose Memory, or run Tools: Project Memory from the command palette.",
      "Read what the assistant has learned, grouped into Decisions, Conventions, Preferences and Session notes, with who wrote each one and when.",
      "Press Edit to correct a note, or Delete to make every assistant forget it.",
      "Press Add memory to teach it something yourself: a short name, a one-line summary and the detail.",
      "To share this memory with Claude Code or another tool, copy the command under Share with your other AI tools and run it once in the project.",
    ],
    benefits: [
      "Stop repeating the same instructions at the start of every conversation.",
      "Fix a wrong assumption once, for every assistant and agent that shares the memory.",
      "Your notes are plain files in your project, never uploaded.",
    ],
    betterThan:
      "Most assistants either forget everything between sessions or remember in a hidden profile you cannot inspect. ADCode's memory is visible, editable, stored in your project, and shared with the other AI tools you use.",
  },

  "ai-edit-policy": {
    steps: [
      "Ask for what you want. By default (Apply automatically) the assistant writes your files as it works - nothing to approve.",
      "When a turn changes files, the chat lists them in a card with an Undo button. Select a file in the card to open it.",
      "Undo puts every file back as it was before that turn and removes files the turn created. If you have edited one of them since, it asks before overwriting your change.",
      "Want to see changes before they land? Open the approval menu in the chat's composer - it reads Auto - and choose Review every change, or find AI edit approval in Settings.",
      "With Review on, edits are staged in an isolated copy of your project. When the turn ends, one card in the chat shows everything it changed, with Apply all changes, Discard and each file's diff. Changes in the sidebar lists anything still waiting.",
    ],
    benefits: [
      "You get results, not a queue of diffs to approve: the assistant builds, runs and fixes in one go.",
      "Nothing is final: one click takes a whole turn back, and it never overwrites your own later edits without asking.",
      "The assistant is told which mode you are in, so it describes its work truthfully - done, or staged and waiting.",
    ],
    betterThan:
      "Agent tools tend to either stop you at every edit or give you no way back. ADCode applies edits as it works, keeps a per-turn Undo right in the conversation, and leaves review one click away for the times you want it.",
  },

  "ai-keep-going": {
    steps: [
      "Keep going until done is on from the start. To change it, open the approval menu in the chat's composer, or find it in Settings.",
      "Give the assistant a big job: a whole site, a refactor across the project, a feature with tests.",
      "If it reaches its step limit, ADCode sends Continue for it, up to five times in a row, and notes each one in the conversation.",
      "Your own message or Stop resets the count, so you can always step in.",
      "With it off, the assistant stops at its step limit and a Continue button picks up where it left off.",
      "For work that runs without you, schedule the job in Automations - edits apply as it works by default.",
    ],
    benefits: [
      "Long jobs finish instead of pausing at a step limit while you are away.",
      "A hard cap of five continuations keeps a confused run from going on forever.",
    ],
    betterThan:
      "Agents that stop at a step limit and wait for a human turn an overnight job into a morning of pressing Continue. ADCode carries on by itself, within a limit you can see.",
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
      "Press Ctrl+Shift+N, or choose New conversation, to start fresh - the conversation you were in is kept.",
      "In Vibe, every conversation is listed in the sidebar, grouped into Today, Yesterday, and older. In the IDE, open the Assistant and choose History.",
      "Search past conversations by title or by anything said in them, rename one to find it later, or delete one by one.",
      "The header names the current conversation and Share copies it as markdown.",
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
      "On by default - the assistant edits your project directly, and results land in your real files the moment the turn finishes.",
      "Ask it to build, fix, create or change files; the Explorer refreshes to show what changed.",
      "Reads never change anything. Unsaved files pause file edits until you save, and destructive shell commands stay blocked.",
      "Opening any older task shows it as a popup in the chat with files and grouped activity: Cancel stops running work, Delete removes a finished task completely, Roll back undoes an applied one.",
      "Long tool runs fold each call and its result into one row with a Show-all expander, in the popup and the chat history. Show AI Tasks in the command palette lists every task.",
      "Turn the feature off to keep chat while disabling all file tools.",
    ],
    benefits: [
      "Done means done in your folder - no review queue between the assistant and the result.",
      "The assistant verifies its own work by running your tests instead of claiming they pass.",
      "Unsaved work is still protected: edits wait until you save rather than overwriting buffers.",
    ],
    betterThan:
      "Editing through an isolated sandbox means every change waits in a queue before it becomes true. Direct edits with a save-guard deliver the result immediately - and unlike assistants that can only read and write, this one can search by pattern, outline symbols, run commands, and fetch docs in the project itself.",
  },

  "ai-mcp-server": {
    steps: [
      "Check you have Node.js 22.13 or newer: run node --version in a terminal. If the command is not found, or the version is older, install the current LTS from nodejs.org. Your agent starts the server with this Node.js, not with ADCode.",
      "Open Tools and choose Memory, or open Settings and find the MCP server section - it is on by default.",
      "Copy the connection command shown there.",
      "Run it once from your project folder, in a terminal opened after Node.js was installed.",
      "Any MCP-capable tool - Claude Code, Codex, and the rest - now reads and writes the same notes as ADCode's assistant.",
      "If your agent reports that the adcode server failed to start, run node --version in that same terminal. A missing or older Node.js is the usual cause.",
    ],
    benefits: [
      "Every assistant you run shares one project memory instead of five partial copies.",
      "Notes go both ways: what a terminal agent learned is visible to the built-in one.",
      "Set it up once: the command points at a copy of the server in your home folder, so it keeps working while ADCode is closed and after it updates - portable, AppImage and Store builds included.",
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
      "Paused while the assistant edits directly: with no isolated tasks created, there is nothing to cap.",
      "Unlimited stays the default; the rows are disabled until caps return.",
      "Runaway tool loops are still bounded by the per-turn step limit instead of draining your key.",
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
      "First commit on this machine? Open the terminal and tell git who you are once - git config --global user.name \"Your Name\" and git config --global user.email \"you@example.com\" - then come back and commit as normal.",
      "Open Changes in the Vibe sidebar for the Cursor-style view: an uncommitted +added −removed total, one row per file with its count, and the diff one click away.",
      "Untick a file to leave it out of this commit - until you do, every file is included.",
      "Press Commit & Push once: ADCode commits the included files and pushes them, writing the message from the files if you leave it empty, and reports the result under the bar.",
      "Prefer the full panel? Open Source Control from the activity bar for the same list with side-by-side diffs, staging, and a separate push.",
      "The set enters your project's history as one labelled step you can return to, and the push result is reported in the same place.",
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

  "git-identity": {
    steps: [
      "Commit as usual - from Changes with Commit & Push, or from the Source Control panel.",
      "If git does not know who you are, a small form opens instead of an error. Your name and an email are already filled in, taken from your git settings and the commits you made in this project before.",
      "Pick the email you want on your commits, or type another.",
      "Keep Use for all my projects ticked to save it for every project on this computer, or untick it to use it for this project only.",
      "Press Save and continue. The commit goes ahead straight away.",
      "To change the name or email later, run Git: Set Your Name and Email from the command palette.",
    ],
    benefits: [
      "No terminal and no exact command to type before your first commit.",
      "It spots the classic slip - user.mail instead of user.email - and fixes it, instead of telling you to set something you think you already set.",
      "It is saved in git's own settings, so VS Code, the terminal and every other tool record the same name.",
    ],
    betterThan:
      "Most editors pass on git's refusal - four paragraphs ending in two commands - and leave you to work out why your setup did not count. ADCode asks for the two values it needs, suggests the ones you have used before, and carries on with the commit you asked for.",
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
      "Turn it on in Session settings - it is off by default.",
      "Stop typing, and the file saves itself after the pause.",
      "The pause matters: it never writes mid-word.",
      "Ctrl+S still works whenever you want it to.",
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

  "workbench-modes": {
    steps: [
      "Start in Vibe, the default conversation window, and choose Open IDE at the bottom of its sidebar to open the Code window.",
      "Stay in Vibe to build through conversation - the assistant reads files, proposes edits, runs tests, and shows the live preview there.",
      "Open a file, Browse files in the IDE, or Search in files from Vibe, and the IDE opens on exactly that; use Vibe in the IDE toolbar to return to the conversation window.",
      "Drag the Vibe sidebar's right edge to make the conversation narrower or wider, or press Ctrl+B to hide it; both are remembered.",
      "Quit and reopen: Vibe opens first, and Open IDE restores your Code tabs on the same project.",
    ],
    benefits: [
      "Vibe and Code stay visible in separate windows on one project.",
      "Files and searches started from Vibe arrive in the IDE window, not lost on the way.",
      "Your editor tabs and window layout survive a restart.",
    ],
    betterThan:
      "The conversation and editor have their own windows while both follow the same project, so you can keep the conversation visible as you edit.",
  },

  "workbench-open-ide": {
    steps: [
      "Start in Vibe, the default: a centered prompt reading Plan, Build, / for skills, @ for context.",
      "Choose Open IDE at the bottom of the Vibe sidebar, or in the top bar when the window is narrow.",
      "The new window always lands editor-first on the same folder; the launcher stays conversation-first.",
      "Work both sides at once: ask and review in Vibe, edit and run in the IDE window.",
      "Close the IDE window when done - the conversation, files, and tasks stay exactly where they were.",
    ],
    benefits: [
      "Planning and building get their own screen shapes instead of fighting over one panel.",
      "No re-opening folders or re-sending context: both windows share the same workspace.",
      "Vibe stays the default front door, so the editor never swallows a newcomer whole.",
    ],
    betterThan:
      "Cursor's Agents Window can show the IDE beside the chat, but its paywalled usage limits stop heavy sessions cold with an Upgrade to Pro wall. ADCode is ad-supported, so the frontier models stay reachable and your earnings ledger shows the trade openly instead of a blocked prompt.",
  },

  "workbench-debug-log": {
    steps: [
      "When something goes wrong, choose Help > Report a Problem. If the assistant failed, the error card's Report problem button opens the same form, already filled in.",
      "Describe what you were doing and what happened.",
      "Keep Include debug log ticked, and select See exactly what is included to read the text that will be attached.",
      "Choose Send. The report goes with your message, the app version, your operating system and that log summary.",
      "To share the whole log somewhere else - an e-mail, a chat, an issue - choose Help > Copy Debug Log and paste it, or Help > Save Debug Log to save it as a text file.",
    ],
    benefits: [
      "Problems get fixed from one report: the log names the failing part, the exact error, the version and the model in use.",
      "Assistant failures carry the provider's own error message, so a rate limit, a rejected key and a broken tool call are told apart immediately.",
      "Nothing private goes with it: keys, prompts, answers, file contents, paths and project names are removed before anything is written.",
      "Nothing is uploaded automatically - the log only leaves your machine when you send it.",
    ],
    betterThan:
      "Most editors ask you to find a log folder, zip it and attach it, then hope nothing sensitive was inside. ADCode's log is redacted as it is written, previewed before it is sent, and attached from the same Help menu you would open anyway.",
  },

  "workbench-open-source": {
    steps: [
      "Choose Help > Open Source Licences. It works the same in Vibe and in Code.",
      "The first tab is ADCode's own licence, the Apache License 2.0: you may use, change and share the code, including commercially.",
      "Open Notice to see who holds the copyright.",
      "Open Third-party to read the licence of every package built into ADCode. Select any text to copy it.",
      "To read or change the code itself, go to github.com/bluethenics/adcode. CONTRIBUTING.md there explains how to build it and send a change.",
      "If you publish a changed copy, give it its own name and icon. The licence covers the code, not the ADCode name or logo.",
    ],
    benefits: [
      "You can check what the editor does with your ads, earnings and code by reading the code, rather than taking it on trust.",
      "Every bundled package is credited with its full licence text, inside the app, with no network needed.",
      "If ADCode stopped tomorrow, the code would still be yours to build and run.",
    ],
    betterThan:
      "Most ad-supported software is closed: you are told what it collects and have to believe it. ADCode's editor, website and ad server are all in one public repository under a permissive licence, so the claim that it never reads your code to target ads is one you can verify.",
  },

  "workbench-changes": {
    steps: [
      "Choose Changes in the Vibe sidebar. The panel opens as a floating window over your work - move it, resize it, or double-click its title to fill the window - with every file changed since your last commit.",
      "Read the bar at the top: the uncommitted +added −removed total, your branch, and Commit & Push. The line under it says which files the next commit takes.",
      "Select a file to see its diff, coloured line by line. A new file shows its whole contents.",
      "Untick a file to leave it out of the next commit. While every box is ticked, Commit & Push takes all of them.",
      "Press Commit & Push. Leave the message empty and ADCode writes one from the files, such as Update css/app.css and 2 more files; use the arrow beside the button for Commit only or to write your own message.",
      "Changed your mind about a file? The revert arrow asks, then puts it back as it was at the last commit - or moves a new file to the Recycle Bin, where you can still restore it.",
      "Use the branch button to switch branch, and ⋯ for Pull, Push, Include everything, Revert all changes or the full Source Control.",
      "No Git in this folder yet? Choose Turn on version control, and every change from then on appears here.",
      "See Git needs your OK? The folder is on a drive that does not record who owns files, such as a FAT32 or exFAT drive, so Git will not use its repository until you trust it. Choose Trust this folder if you made the folder or know where it came from.",
    ],
    benefits: [
      "See exactly what the assistant touched without opening the IDE or reading a terminal.",
      "Save your work in one click - no staging, no commit message to invent.",
      "Every revert is recoverable: edited files go back to your last commit, new files go to the Recycle Bin rather than disappearing.",
      "The list follows your files live, so it is always what is on disk now.",
    ],
    betterThan:
      "Cursor's changes view assumes you know Git: stage, write a message, then push. ADCode's panel has the same shape, but it includes everything until you say otherwise, writes the message for you, pushes in the same click, and turns Git on for a folder that does not have it yet.",
  },

  "workbench-vibe-sidebar": {
    steps: [
      "Open ADCode - the Vibe window's sidebar is on the left. Choose New conversation, or press Ctrl+Shift+N, to start fresh.",
      "Select the project card under the search box to switch to a recent project, open a folder, clone a repository, or see the project overview. The card shows the branch and how many files have changed.",
      "Watch the Changes badge: it counts the files you have not committed yet, and turns blue when something is waiting for you, such as a conflict.",
      "Switch the middle of the window with Chat, Agents and Tools: the conversation, the board of agents working in parallel, and the tools, MCP servers, skills and memory they use.",
      "Select Changes to open the Changes panel as a floating window - every changed file, its diff, and Commit & Push; select it again to close it.",
      "Use Preview to see the running app in a floating window, and Automations to schedule messages.",
      "Pick up an earlier conversation from the Conversations list, grouped by day; type in its search box to find one by anything said in it.",
      "Drag the sidebar's right edge to resize it, or press Ctrl+B to hide it. On a narrow window it becomes a drawer: open it with the menu button at the top left or Ctrl+B, and close it with Escape.",
    ],
    benefits: [
      "You find out an agent finished, or what changed, without opening a panel to check.",
      "Every everyday workflow has one visible row - nothing important hides in an overflow menu.",
      "Switching between projects is two clicks, with the branch and change count in view before you switch.",
      "The same sidebar works at any window size, from a full monitor to half a laptop screen.",
    ],
    betterThan:
      "Chat-first coding tools tend to show a list of conversations and little else, so you poll the diff view to learn whether anything happened. The Vibe sidebar puts project, branch, running work and uncommitted changes in one glance, next to the conversation that caused them.",
  },

  "workbench-ai-context": {
    steps: [
      "Just ask. Every message already tells the assistant which file you are on, where your cursor is, what you have selected, which tabs are open and which errors the editor shows.",
      "Say \"fix this\" or \"what does this function do\" and it answers about the code in front of you - no pasting, no file names.",
      "To hand over a specific piece, select it and press Ctrl+L, or right-click and choose ADCode: Add Selection to Chat. It lands in the composer as a chip, so you can add a question before sending.",
      "With nothing selected, Ctrl+L still selects the current line, exactly as it does in other editors.",
      "Right-click for Explain, Refactor, Write Tests and Find Issues to start from a prepared request you can edit before sending.",
    ],
    benefits: [
      "The assistant resolves \"this\", \"here\" and \"this file\" the way a colleague looking over your shoulder would.",
      "Unsaved code counts: what it sees is the editor buffer, not the last saved file.",
      "Errors the editor already found go along too, so \"fix the errors\" needs no further explanation.",
      "In Vibe mode, where the editor is hidden, only file names and errors are shared - never a stale selection you cannot see.",
    ],
    betterThan:
      "Browser chats and many plugins start every question blind, so you paste code, then paste the error, then explain which file it came from. ADCode sends that context with the message automatically and keeps Ctrl+L for when you want to point at something precisely.",
  },

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

  "workbench-agents-board": {
    steps: [
      "Choose Agents in the Vibe sidebar (in the IDE window, Agents in the More menu or Open Agents in the command palette).",
      "Press New task. Describe what you want - for example: Add a dark mode toggle to the settings page.",
      "Pick an agent, or keep Default agent to use your connected model with every tool. Optionally set a cost cap in dollars, then press Enter.",
      "Watch its box under Working: the mascot thinks while it works, the status line says what it is doing right now, and the time, files, tokens and cost count up. Start more tasks straight away - they run side by side, and extra ones wait as Queued.",
      "When it finishes: with Apply automatically on, the work lands in your project and the box offers Undo and Continue. With Review every change, the box moves to Ready - press Review to see the diff, then Apply, Apply & continue, or Discard.",
      "Anything under Needs you is waiting on you: Resolve a clash with your own edits, Run again after an error or Open in chat to talk it through, Run with a higher cap when a cost cap stopped it, or Resume after ADCode restarted.",
      "Read the proof of work on each finished box: a tick or cross for every test, type check or linter the agent actually ran, and warnings for a possible secret, sign-in or payment code, removed tests, new dependencies or a very large change. With Apply automatically on, a failed check or a possible secret holds the run under Ready for you instead of applying it.",
      "If an agent keeps trying the same failing thing, ADCode stops it; press Try another way to run it again with a nudge to change approach. If two agents edit the same file, both boxes warn you before their work collides.",
      "Select any box to see what the agent reported, the files it changed, its proof of work and every step it took.",
      "Under Your agents, Run hands a saved agent a task, Edit changes its look, instructions, model and tools, and Select for a Team splits one task across two to four agents.",
    ],
    benefits: [
      "Several agents work at once while you keep chatting - a bug fix, tests and a UI polish no longer queue behind each other.",
      "Each agent works in its own copy of the project, so a half-finished edit never lands in your files.",
      "One glance says what is working, what needs you and what is ready - no scrolling back through transcripts.",
      "Cost shows on every box when the price is known, and a cap stops an agent before it spends more.",
      "A read-only Reviewer really cannot edit: tool access is enforced when the agent runs, not just written in its instructions.",
      "Proof, not promises: you see which checks actually ran and passed before you review a line, and risky changes are flagged or held.",
      "Agents that loop get stopped instead of burning your key, and parallel agents warn you before they step on each other.",
    ],
    betterThan:
      "Chat-only assistants do one thing at a time and bury progress in a transcript. Cloud agent services run in parallel but bill by the minute and hide what the agent is doing until it opens a pull request. ADCode runs parallel agents on your own machine and key, shows each one's live status and cost as a box, and brings its work back through the same review and Undo as the chat.",
  },

  "workbench-tools-page": {
    steps: [
      "Choose Tools in the Vibe sidebar, or Open Tools in the command palette.",
      "Built-in lists ADCode's own tools in plain words and which of your agents may use each one - change that in the agent's editor on the Agents page.",
      "Open MCP servers and press Add server. On Catalogue, press Add beside a server such as Playwright (test pages in a real browser) or Context7 (current library docs); it is saved and connected in one click. Custom takes any command or URL.",
      "Watch each server's light: green is connected. If something is wrong, the card says what to do, such as installing Node.js, and Retry tries again. Tools on a connected server turns individual tools on or off.",
      "Open Skills to turn written routines on or off, preview one, or press New skill to write your own.",
      "Open Memory to read and correct what the assistant has learned about the project, or to share that memory with Claude Code and other tools.",
      "Type in the search box to filter every tab at once.",
    ],
    benefits: [
      "One place for every capability the assistant has, instead of settings pages and JSON files.",
      "Popular servers are one click, with a note on anything they need first.",
      "A broken server tells you how to fix it rather than failing silently.",
      "You can see exactly which agent may touch which tool.",
    ],
    betterThan:
      "Most editors make MCP a config file you edit by hand and debug by reading logs. ADCode shows servers as cards with a health light, explains failures in plain words, and adds the common ones in one click - without ever asking you to paste a key into a text box.",
  },

  "workbench-floating-panels": {
    steps: [
      "Open a panel as usual: Changes or Preview in the Vibe sidebar, Project overview from the project card, or Ctrl+I for the assistant in the IDE.",
      "Drag it by its title bar to where you want it.",
      "Resize it from any edge or corner. Double-click the title bar, or press Maximise, to fill the window; do it again to restore.",
      "Press Escape or the close button to hide it. It opens in the same place next time.",
      "Lost one? Run Reset Floating Panel Positions from the command palette to bring every panel back to its default place.",
    ],
    benefits: [
      "The editor and the conversation always keep the full width of the window.",
      "Put panels where they suit you - next to the code you are checking, or on the side of the screen you look at.",
      "A panel can never get stuck off-screen: its title bar is always kept reachable, even after the window shrinks.",
    ],
    betterThan:
      "Sidebars take a fixed column for as long as they are open, and IDEs with many of them leave a narrow strip for the code. ADCode's panels float over the work only while you need them, go where you put them, and give the space back the moment they close.",
  },

  "workbench-preview": {
    steps: [
      "Open any HTML file and start the live preview.",
      "Edit - the preview reloads itself on save.",
      "To see another page, click the address in the preview's bar, type its path - /about.html or #pricing - and press Enter. The address follows the links you click, and when the assistant opens a page for you, the preview goes there too.",
      "Switch device sizes from the preview toolbar to check layouts: one click for Phone, Tablet, or Desktop, labelled W and H boxes with minus and plus steppers, a preset list, or drag the frame's visible edges. The page reshapes in place without reloading, and Fit scales it to fit so you never scroll to see it.",
      "Turn on Inspect, then right-click anything in the preview to see its width, height, padding, margin, and highlighted markup for restyling. If it grabs an inner piece instead of the card you meant, walk up the breadcrumb to the parent — the page flashes each level as you pick it. Choose List all to see every element's spacing with a filter.",
      "The preview floats over your work instead of taking a column: drag it by its bar, resize it from any edge, and double-click the bar (or press Maximise) to fill the window.",
      "To change something you can see, pick it with Inspect and press Change this with AI. New task opens with that element attached - page, selector, size and markup - so you only type what should change, like Make this button bigger and green.",
    ],
    benefits: [
      "Save-and-switch-to-browser becomes a thing you used to do.",
      "Layout experiments iterate at the speed of typing.",
      "Box-model numbers live where the page is, so fixing spacing means no devtools detour.",
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

  "workbench-image-preview": {
    steps: [
      "Open a folder that contains images - png, jpg, gif, webp, svg, ico, or bmp.",
      "Click any image in the Explorer. It previews in the editor area with its file size and dimensions.",
      "Switch tabs to move between images and code; previews are cached so going back is instant.",
      "Use File > Open Image Preview or the command palette to pick an image directly.",
    ],
    benefits: [
      "Images stop opening as garbage text - what you see is the picture itself.",
      "File size and pixel dimensions are shown beside the name, so asset checks need no other tool.",
      "Previews are read-only, so there is nothing to accidentally save over.",
    ],
    betterThan:
      "Editors without this make you leave for the file manager or a browser to check an asset. ADCode previews images where your code is, in the same tab strip, with no setup and no plugins.",
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

  "account-invite": {
    steps: [
      "Open Invite & earn - from the Earnings card in the title bar, or by typing \"invite\" in the command palette.",
      "Copy your link, or use Post on X, Post on Threads or Email it to send it with a ready-made line.",
      "Your friend opens the link and downloads ADCode. The page copies your invite as the download starts, and ADCode picks it up by itself the first time it opens.",
      "From then on, for 365 days, you get 10% of what ADCode earns from the ads they see. It lands in your balance the day after.",
      "Know a company that sells to developers? Send them your link too: you get 5% of what they spend on ads.",
      "Someone sent you a code instead? Paste it into the box under Got an invite code? in your first 14 days.",
      "Built something you are proud of? With the project open, press Add \"Built with ADCode\" to this project's README - the line links to your invite.",
    ],
    benefits: [
      "It costs the person you invite nothing. Your share comes out of ADCode's half, and they keep every cent of theirs.",
      "It keeps paying for a year while they use ADCode, instead of once at sign-up.",
      "The panel shows who joined with your link and who is actually using it, before it shows money - so you can see it working while the amounts are still small.",
      "You decide whether your invite page shows your first name.",
    ],
    betterThan:
      "Most referral programmes pay a one-off credit you can only spend in the product, and only after someone pays. Here the reward is the same money your ad earnings are - withdrawable - and it follows what the people you invite actually do, so it keeps paying while they keep coding.",
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
      "Leave it on, which is the default. New versions download in the background while you work.",
      "Watch the status bar: it shows Updating with a percentage, then Restart to update when the new version is ready.",
      "On Windows, choose Restart now on the card, or click Restart to update. ADCode keeps anything unsaved, installs, and reopens by itself. On Linux, the update installs when you close ADCode.",
      "Or keep working - the update installs the next time you close ADCode.",
      "Help → Check for Updates asks straight away; turn the setting off to update by hand.",
    ],
    benefits: [
      "You always know when a new version is waiting, without a dialog in your way.",
      "An update never costs you an unsaved buffer: it is kept as a recovery draft and offered back after the restart - and with crash recovery off, ADCode asks you to save first.",
      "If an update fails, the reason is in the log Help → Report a Problem sends.",
      "Whichever way you installed ADCode, only one thing is ever updating it.",
    ],
    betterThan:
      "Most editors either interrupt with a modal or update so quietly you never find out. ADCode shows progress in the status bar, offers one quiet restart when the update is ready, and otherwise installs it when you close the editor. Where the Microsoft Store or a Linux package manager installed ADCode, that keeps the job, and ADCode's own updater stands down instead of downloading a copy it has no permission to apply.",
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
