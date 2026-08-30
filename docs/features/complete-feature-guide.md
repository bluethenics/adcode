# Complete ADCode feature guide

This guide is the human-readable inventory behind ADCode's **All Features** library. The
same catalogue also powers the title-bar Universal Search, the Help → Feature Guide, menu
routes, and the website docs. It is generated from `packages/help`; edit that catalogue
and run `node scripts/docs-seed.mjs` rather than letting these surfaces drift apart.

## Find and open anything

- Open **All Features** with the four-cell icon below Earnings, with **View → All
  Features**, or by running `command:features.open`.
- Use the title-bar **Universal Search** or `command:search.universal` when you know what
  you want but not where it lives. It searches features, commands, files, recent projects,
  and workspace symbols. Start with `>` to favour commands.
- Use **Quick Open** (`Ctrl+P`) when you only want a file.
- Use the **Command Palette** (`Ctrl+Shift+P`) when you only want a command.
- Use **Symbol Search** (`Ctrl+T`) when you only want a function, class, or symbol.
- Use project **Content Search** (`Ctrl+Shift+F`) when you want text inside files.

Search results are grouped by kind and arrive progressively. A failed symbol or recent-file
provider does not prevent local feature and command results from opening. A newer query
always replaces an older one, so stale asynchronous results cannot take over the panel.

## Use the Feature Library

1. Open **All Features** using the icon, View menu, Feature Guide, or Universal Search.
2. Type a goal such as “multiple AI”, “format on save”, or “preview phone”.
3. Filter by category if you want to browse instead of search.
4. Select **Open**, **Search**, **Connect**, **Schedule**, or the setting route shown on the
   card. The library dispatches only registered ADCode commands and known settings.
5. Select the `?` explanation for **What it does**, **Why use it**, and **How to use it**.

## AI work without giving up normal coding

AI features are optional. Files, menus, editor shortcuts, terminals, source control,
debugging, and extensions continue to work normally without connecting a model.

- **Isolated mode** gives an AI task a separate Git-backed workspace. Review the diff and
  apply it when ready; discard it to roll back without touching the working project.
- **Team** can divide one goal among multiple AI roles. ADCode shows the shared goal,
  ownership, trace, token use, and each proposed change instead of hiding parallel work.
- **Trusted mode** permits broader automated edits for a workspace you trust. You can turn
  it off at any time; it does not remove the review, history, or rollback path.
- **Scheduled messages** are delivered only while ADCode is open. Built-in chat is always
  supported; terminal delivery requires a visibly waiting compatible agent and a one-time
  permission. Missed one-time messages wait for you to choose **Run now**.
- **Auto-continuation** resumes a paused supported agent only under the configured limits.
  It never bypasses provider usage limits, token budgets, approvals, or a closed ADCode
  window.
- **Trace and review** show requests, tool activity, file changes, costs, pauses, and errors.
  Secrets stay in the operating system credential store and the user decides what is
  applied to the real project.

Read [AI workspaces and automation](./ai-workspaces.md) for the end-to-end workflow and
[AI workspace security](../architecture/ai-workspace-security.md) for the trust boundary,
privacy rules, validation, and rollback guarantees.

## Keyboard routes

On macOS, use Command where a shortcut below says Ctrl.

- Inline completion: `Alt+\`
- Multi-cursor: `Ctrl/Cmd+D`
- Built-in formatter: `Shift+Alt+F`
- Format on save: `Ctrl/Cmd+S`
- Debug adapter client: `F5`
- Fuzzy file open: `Ctrl/Cmd+P`
- Symbol search: `Ctrl/Cmd+T`
- Global search and replace: `Ctrl/Cmd+Shift+F`
- Auto-save after delay: `Ctrl/Cmd+S`
- Command palette: `Ctrl/Cmd+Shift+P`
- Selecting and moving files: `F2`

# Feature inventory

Every item below is also a searchable card in **All Features**. Command identifiers are
included for automation, keyboard customization, and troubleshooting; most people can use
the matching menu or button.

## Editing

<!-- feature:adcode.editing.acceptOnEnter -->
### Accept suggestion with Enter

With the suggestion list open, pressing Enter takes the suggestion instead of starting a new line.

Why use it: It is what makes suggestions fast. It is also the thing that annoys people who wanted a new line, which is why it is its own switch rather than part of suggestions.

How to use it: On by default. Turn it off and Enter always starts a new line; Tab still takes the suggestion.

Access: `All Features → Accept suggestion with Enter`; `Turn on or off (setting:adcode.editing.acceptOnEnter)`; `Settings → adcode.editing.acceptOnEnter`.

<!-- feature:adcode.editing.autoRenamePairedTag -->
### Auto-rename paired tag

Change the name of an opening tag and its closing tag changes to match, by itself.

Why use it: Renaming one and not the other breaks the page, and you usually find out somewhere else entirely.

How to use it: On by default. Edit the name inside an opening tag; the closing tag follows as you type, and one press of Ctrl+Z undoes both together.

Access: `All Features → Auto-rename paired tag`; `Turn on or off (setting:adcode.editing.autoRenamePairedTag)`; `Settings → adcode.editing.autoRenamePairedTag`.

<!-- feature:adcode.editing.bracketPairColorization -->
### Bracket pair colorization

Brackets get colours. The one that opens and the one that closes are the same colour, so you can see which goes with which.

Why use it: When code is nested several layers deep, finding the bracket that closes the one you are looking at means counting. Colour turns counting into looking.

How to use it: Nothing to do - it is on. Turn it off if you find the colours noisy.

Access: `All Features → Bracket pair colorization`; `Turn on or off (setting:adcode.editing.bracketPairColorization)`; `Settings → adcode.editing.bracketPairColorization`.

<!-- feature:adcode.editing.spellCheck -->
### Check spelling in comments

Misspelled words in comments get a wavy underline, and the fix is one click away on the lightbulb.

Why use it: A typo in a comment is the one kind nothing else catches - the compiler does not read comments, the linter does not read them, and reviewers skim them. So it sits there forever.

How to use it: Off by default. Edit → Check Spelling in Comments runs it over every open file and reports into the Problems panel, including when it finds nothing. It only flags words it can name a correction for, so a library, a product, or somebody's name is left alone instead of underlined - which is why it never becomes the noise you switch off. Code is never checked: an identifier is named, not spelled.

Access: `All Features → Check spelling in comments`; `Check now (command:edit.spelling)`; `Turn on or off (setting:adcode.editing.spellCheck)`; `Settings → adcode.editing.spellCheck`.

<!-- feature:adcode.editing.autoCloseTags -->
### Close tags automatically

Type the end of an opening tag and the closing one appears by itself. Type a closing bracket and it finishes the tag you still have open.

Why use it: Forgetting to close a tag is the most common way HTML breaks, and the error it produces rarely points at the tag you forgot.

How to use it: On by default in HTML, XML, JSX, and templates. Type >, and the closing tag is written for you with the cursor left between them.

Access: `All Features → Close tags automatically`; `Turn on or off (setting:adcode.editing.autoCloseTags)`; `Settings → adcode.editing.autoCloseTags`.

<!-- feature:adcode.editing.codeFolding -->
### Code folding

Collapse a chunk of code down to one line, and open it again when you want it.

Why use it: A file is easier to read when the parts you are not working on are out of the way.

How to use it: On by default. Click the small arrow in the margin beside a line, or press Ctrl+Shift+[ to fold and Ctrl+Shift+] to unfold.

Access: `All Features → Code folding`; `Turn on or off (setting:adcode.editing.codeFolding)`; `Settings → adcode.editing.codeFolding`.

<!-- feature:adcode.editing.commentTones -->
### Colour comments by intent

Start a comment with !, ?, or * and it takes a colour. Start one with a second // and it fades, because that is code you commented out.

Why use it: A warning, an open question, and a line of dead code are three different kinds of writing that all render the same grey. One character tells them apart.

How to use it: Off by default. Line comments only - a /** block */ begins with * by convention, and colouring those would mark every documented function in a project.

Access: `All Features → Colour comments by intent`; `Turn on or off (setting:adcode.editing.commentTones)`; `Settings → adcode.editing.commentTones`.

<!-- feature:adcode.editing.columnSelection -->
### Column selection mode

Dragging the mouse selects a rectangle of text - a straight column down the page - instead of following the words.

Why use it: Useful for lining up columns of data or stripping the same prefix off twenty lines.

How to use it: Off by default, because it is a mode: while it is on, every mouse drag makes a box instead of selecting text, and that is not something to switch on by accident. Turn it on when you need it and off again after.

Access: `All Features → Column selection mode`; `Turn on or off (setting:adcode.editing.columnSelection)`; `Settings → adcode.editing.columnSelection`.

<!-- feature:adcode.editing.plainEnglishErrors -->
### Explain errors in plain English

Confusing error messages get rewritten into a sentence that says what actually went wrong.

Why use it: Compiler messages are written for people who already know the compiler. Most of the time the real meaning is simple and the wording is not.

How to use it: On by default. The rewritten sentence is shown first and the compiler's original wording is always kept underneath, because sometimes the exact words are what you need to search for.

Access: `All Features → Explain errors in plain English`; `Turn on or off (setting:adcode.editing.plainEnglishErrors)`; `Settings → adcode.editing.plainEnglishErrors`.

<!-- feature:adcode.editing.indentGuides -->
### Indent guides

Faint vertical lines show how far in each line is pushed.

Why use it: In languages where indentation decides what belongs to what - Python especially - the lines are the difference between reading the structure and guessing it.

How to use it: On by default. The guide for the block your cursor is in is brighter than the rest.

Access: `All Features → Indent guides`; `Turn on or off (setting:adcode.editing.indentGuides)`; `Settings → adcode.editing.indentGuides`.

<!-- feature:adcode.editing.inlineErrorLens -->
### Inline error and warning lens

When a line has a mistake, the message about it sits right at the end of that line.

Why use it: Otherwise the message lives in a panel at the bottom, or inside a tooltip you have to hover to see. Both mean looking away from the line you are fixing.

How to use it: On by default. The message is dimmed and shortened so it never covers your code, and it hides itself on the line your cursor is on while you type.

Access: `All Features → Inline error and warning lens`; `Turn on or off (setting:adcode.editing.inlineErrorLens)`; `Settings → adcode.editing.inlineErrorLens`.

<!-- feature:adcode.editing.inlineGitBlame -->
### Inline git blame

Beside the line your cursor is on, it quietly says who last changed it and when.

Why use it: Reading somebody else's code, the useful question is often not what a line does but why it was written. The commit that added it usually says.

How to use it: Off by default, because it puts text beside your cursor all day. Turn it on and click a line; the note appears at the end of it.

Access: `All Features → Inline git blame`; `Turn on or off (setting:adcode.editing.inlineGitBlame)`; `Settings → adcode.editing.inlineGitBlame`.

<!-- feature:adcode.editing.minimap -->
### Minimap

A tiny picture of the whole file down the right-hand edge, that you can click to jump.

Why use it: You often remember roughly where something was - near the top, in that dense block - without remembering its name. The shape of the file is a real way to navigate.

How to use it: On by default. Drag the highlighted box to scroll, or click anywhere on it to jump there.

Access: `All Features → Minimap`; `Turn on or off (setting:adcode.editing.minimap)`; `Settings → adcode.editing.minimap`.

<!-- feature:adcode.editing.multiCursor -->
### Multi-cursor

Put more than one cursor on the page and type in all those places at once.

Why use it: Changing the same word in six places is six edits done one at a time, or one edit done six times at once.

How to use it: Ctrl+click to add a cursor anywhere. Ctrl+D adds one at the next copy of the word you have selected. Ctrl+Alt+Up or Down adds one on the line above or below. Escape drops back to one.

Access: `All Features → Multi-cursor`; `Add next occurrence (command:selection.addNextOccurrence)`; `Select all occurrences (command:selection.selectAllOccurrences)`; `Select all (command:selection.all)`; `Expand selection (command:selection.expand)`; `Shrink selection (command:selection.shrink)`; `Copy line up (command:selection.copyLineUp)`; `Copy line down (command:selection.copyLineDown)`; `Move line up (command:selection.moveLineUp)`; `Move line down (command:selection.moveLineDown)`; `Duplicate selection (command:selection.duplicate)`; `Add cursor above (command:selection.cursorAbove)`; `Add cursor below (command:selection.cursorBelow)`; `Turn on or off (setting:adcode.editing.multiCursor)`; `Settings → adcode.editing.multiCursor`; `Keyboard → CmdOrCtrl+D`.

<!-- feature:adcode.editing.pathAutocomplete -->
### Path autocomplete

When you are typing the name of another file, it offers you the files that are really there.

Why use it: A mistyped path is a broken import, and the error it causes names the wrong thing surprisingly often. Being offered only files that exist makes the mistake impossible.

How to use it: On by default. Start typing a path inside quotes or an import and the list appears. Type / to go into a folder.

Access: `All Features → Path autocomplete`; `Turn on or off (setting:adcode.editing.pathAutocomplete)`; `Settings → adcode.editing.pathAutocomplete`.

<!-- feature:adcode.editing.trailingWhitespace -->
### Render trailing whitespace

Extra spaces left hanging at the end of a line are made visible.

Why use it: They are invisible by definition, they show up as changes in every review, and some languages care about them.

How to use it: Off by default, since dots at the end of lines are a distraction if you are not hunting them. Turn it on and they appear as faint marks.

Access: `All Features → Render trailing whitespace`; `Turn on or off (setting:adcode.editing.trailingWhitespace)`; `Settings → adcode.editing.trailingWhitespace`.

<!-- feature:adcode.editing.fileTemplates -->
### Start new files from a template

A brand new file already has the boring first lines in it - the doctype for a web page, the main function for a C program.

Why use it: Nobody remembers the exact opening lines of every language, and looking them up is the least interesting part of starting something.

How to use it: On by default. Make a new file with a known extension and the boilerplate is there. Press Ctrl+Z once if you would rather start empty.

Access: `All Features → Start new files from a template`; `Turn on or off (setting:adcode.editing.fileTemplates)`; `Settings → adcode.editing.fileTemplates`.

<!-- feature:adcode.editing.stickyScroll -->
### Sticky scroll

As you scroll down inside a long function, its name stays stuck at the top of the editor so you never lose track of where you are.

Why use it: Two hundred lines into a file, the thing you most want to know is which function you are inside. Scrolling back up to check is how you lose your place.

How to use it: On by default. Click a stuck line at the top to jump back to it.

Access: `All Features → Sticky scroll`; `Turn on or off (setting:adcode.editing.stickyScroll)`; `Settings → adcode.editing.stickyScroll`.

<!-- feature:adcode.editing.wordSuggestions -->
### Suggest words already in the file

Even with nothing clever available, it will suggest words you have already used nearby.

Why use it: This is the fallback for languages with no language server. A dumb suggestion of a word you definitely typed is still better than typing it again.

How to use it: On by default. It only ever offers words from the file you are in.

Access: `All Features → Suggest words already in the file`; `Turn on or off (setting:adcode.editing.wordSuggestions)`; `Settings → adcode.editing.wordSuggestions`.

<!-- feature:adcode.editing.suggestions -->
### Suggestions as you type

A little list pops up guessing what you are about to type, so you can pick it instead.

Why use it: It saves typing, and more importantly it saves remembering exact names.

How to use it: On by default. Keep typing to narrow the list, press Tab or Enter to take the highlighted one, Escape to dismiss it.

Access: `All Features → Suggestions as you type`; `Undo (command:edit.undo)`; `Redo (command:edit.redo)`; `Find (command:edit.find)`; `Replace (command:edit.replace)`; `Toggle line comment (command:edit.toggleLineComment)`; `Toggle block comment (command:edit.toggleBlockComment)`; `Cut (command:edit.cut)`; `Copy (command:edit.copy)`; `Paste (command:edit.paste)`; `Toggle word wrap (command:view.toggleWordWrap)`; `Turn on or off (setting:adcode.editing.suggestions)`; `Settings → adcode.editing.suggestions`.

<!-- feature:adcode.editing.todoHighlighting -->
### TODO and FIXME highlighting

Notes you leave yourself in comments - TODO, FIXME, HACK - get a colour so they stand out.

Why use it: A note you cannot find is a note you did not leave. These are the comments you actually want to trip over later.

How to use it: On by default, and only inside real comments - the word TODO in a piece of text or a string is left alone. Edit → List TODOs and FIXMEs collects them from every open file into the Problems panel, and says when there are none.

Access: `All Features → TODO and FIXME highlighting`; `List them (command:edit.todos)`; `Turn on or off (setting:adcode.editing.todoHighlighting)`; `Settings → adcode.editing.todoHighlighting`.

## Finding your way

<!-- feature:adcode.navigation.breadcrumbs -->
### Breadcrumbs

A line above the editor showing the trail to where you are: the folder, the file, and the function your cursor is inside.

Why use it: It answers 'where am I' at a glance, and every part of the trail is a button.

How to use it: On by default. Click a workspace or folder to browse inside it and across sibling folders. Click the file for sibling and recent files, Quick Open, copy, reveal, rename, and comparison/history actions. Click a symbol to search the file outline. With a crumb focused, use Left and Right to move through levels, Down or Enter to open one, then type to filter and press Enter to switch.

Access: `All Features → Breadcrumbs`; `Turn on or off (setting:adcode.navigation.breadcrumbs)`; `Settings → adcode.navigation.breadcrumbs`.

<!-- feature:adcode.navigation.fuzzyFileOpen -->
### Fuzzy file open

Open any file by typing a few letters of its name. You do not have to get them right, or in order.

Why use it: Clicking through folders to find a file you already know the name of is the slowest thing in any editor.

How to use it: Press Ctrl+P and start typing. 'ushnd' will find 'useHandler.ts'. Enter opens the highlighted one.

Access: `All Features → Fuzzy file open`; `Go to a file (command:go.file)`; `Turn on or off (setting:adcode.navigation.fuzzyFileOpen)`; `Settings → adcode.navigation.fuzzyFileOpen`; `Keyboard → CmdOrCtrl+P`.

<!-- feature:adcode.navigation.globalSearch -->
### Global search and replace

Search every file in the project for some text, and change it everywhere at once.

Why use it: Renaming something, or finding every place a mistake was copied to.

How to use it: Press Ctrl+Shift+F. You can search for a pattern rather than exact text, restrict it to certain files, and see every change before you make it.

Access: `All Features → Global search and replace`; `Search the project (command:view.search)`; `Turn on or off (setting:adcode.navigation.globalSearch)`; `Settings → adcode.navigation.globalSearch`; `Keyboard → CmdOrCtrl+Shift+F`.

<!-- feature:adcode.navigation.goToDefinition -->
### Go to definition and references

Click a name to see where it was made, or to see everywhere else it is used. A small preview opens under the line so you do not lose your place.

Why use it: It is the difference between reading code and searching it. Following a function to its body is the single most common thing anybody does in an unfamiliar project.

How to use it: Click a name for the preview, click the preview's title or Ctrl+click the name to go there properly, and Escape to close. ADCode tells you how it found the answer: 'resolved' means a language server worked it out for certain, and 'matched by name' means ADCode found things with the same name - which is usually right and is not a promise.

Access: `All Features → Go to definition and references`; `Go to definition (command:go.definition)`; `Peek definition (command:go.peek)`; `Turn on or off (setting:adcode.navigation.goToDefinition)`; `Settings → adcode.navigation.goToDefinition`.

<!-- feature:adcode.navigation.outline -->
### Outline

A list of everything in the file you are looking at - its functions, classes, and sections.

Why use it: It is the table of contents for a file, and the fastest way to jump around inside a long one.

How to use it: On by default. Open the Structure popup to see it drawn as a tree, with lines connecting each thing to what it belongs to. Click any entry to jump to it.

Access: `All Features → Outline`; `Go to a line (command:go.line)`; `Next editor (command:go.nextEditor)`; `Previous editor (command:go.previousEditor)`; `Next change (command:go.nextChange)`; `Previous change (command:go.previousChange)`; `Turn on or off (setting:adcode.navigation.outline)`; `Settings → adcode.navigation.outline`.

<!-- feature:adcode.navigation.symbolSearch -->
### Symbol search

Find a function, class, or variable by name anywhere in the project, without knowing which file it is in.

Why use it: You almost always remember what a thing is called and almost never remember where it lives.

How to use it: Press Ctrl+T and type the name. The list shows what kind of thing each result is and which file it is in.

Access: `All Features → Symbol search`; `Go to a symbol (command:go.symbol)`; `Turn on or off (setting:adcode.navigation.symbolSearch)`; `Settings → adcode.navigation.symbolSearch`; `Keyboard → CmdOrCtrl+T`.

## Formatting

<!-- feature:adcode.formatting.formatter -->
### Built-in formatter

Tidies your code for you - puts the spaces, indents and line breaks in the same places every time.

Why use it: Arguing about where the spaces go is the least valuable thing a person can do with their day. A formatter ends the argument by always doing the same thing.

How to use it: On by default, and there is nothing to install. Press Shift+Alt+F to tidy the open file. If a language server is running for that language, ADCode asks it first, because it knows the language better than we do; otherwise ADCode's own formatter does it.

Access: `All Features → Built-in formatter`; `Format this file (command:edit.format)`; `Turn on or off (setting:adcode.formatting.formatter)`; `Settings → adcode.formatting.formatter`; `Keyboard → Shift+Alt+F`.

<!-- feature:adcode.formatting.formatOnSave -->
### Format on save

Every time you save, the file gets tidied first.

Why use it: So you never think about it again. Code that is formatted on every save is never messy, and nobody has to remember a shortcut.

How to use it: On by default. Save as usual with Ctrl+S. If the formatter cannot handle that language, the file is saved exactly as you wrote it rather than mangled.

Access: `All Features → Format on save`; `Turn on or off (setting:adcode.formatting.formatOnSave)`; `Settings → adcode.formatting.formatOnSave`; `Keyboard → CmdOrCtrl+S`.

<!-- feature:adcode.formatting.lintDiagnostics -->
### Lint diagnostics

Underlines the things that are wrong, or look wrong, while you type.

Why use it: Finding a mistake as you make it costs a second. Finding it when the program runs costs a lot more.

How to use it: On by default. Red means it is broken, yellow means it is suspicious. All of them are collected in the Problems panel, and hovering one shows the detail.

Access: `All Features → Lint diagnostics`; `Turn on or off (setting:adcode.formatting.lintDiagnostics)`; `Settings → adcode.formatting.lintDiagnostics`.

<!-- feature:adcode.formatting.organizeImportsOnSave -->
### Organize imports on save

When you save, the list of other files your file uses gets sorted, and any it no longer uses are removed.

Why use it: Import lists grow messy on their own and nobody ever tidies them on purpose.

How to use it: Off by default, because deleting a line you did not ask to delete deserves to be a choice. Edit → Organize Imports does it once, on demand, and tells you when the imports were already tidy. Turn the setting on and it happens on every save instead.

Access: `All Features → Organize imports on save`; `Organize now (command:edit.organizeImports)`; `Turn on or off (setting:adcode.formatting.organizeImportsOnSave)`; `Settings → adcode.formatting.organizeImportsOnSave`.

## Understanding a project

<!-- feature:adcode.structure.projectTreeLines -->
### Draw trees with connecting lines

Little lines join each file to the folder it lives in, like a family tree, so you can see what is inside what.

Why use it: Without them you have to judge nesting by how far a row is pushed across, which means counting pixels.

How to use it: On by default. Turn it off to get plain indentation instead.

Access: `All Features → Draw trees with connecting lines`; `Turn on or off (setting:adcode.structure.projectTreeLines)`; `Settings → adcode.structure.projectTreeLines`.

<!-- feature:adcode.structure.missingClasses -->
### Point out classes nothing defines

Tells you when you have used a class name that no stylesheet actually defines.

Why use it: It is almost always a typo, and a mistyped class is completely silent - the element just renders unstyled, usually on a page nobody has open.

How to use it: On by default. Findings appear in the Problems panel beside everything else. View → Find Classes Nothing Defines checks the markup or component file you have open right now, and says so when every class is accounted for.

Access: `All Features → Point out classes nothing defines`; `Find them (command:structure.missingClasses)`; `Turn on or off (setting:adcode.structure.missingClasses)`; `Settings → adcode.structure.missingClasses`.

<!-- feature:adcode.structure.unusedSelectors -->
### Point out rules that style nothing

Tells you when a style rule does not match anything in your project any more.

Why use it: A rule left behind by a deleted component is invisible, and stylesheets only ever grow.

How to use it: Off by default, deliberately. View → Find Unused CSS Rules runs it on the stylesheet you have open whatever the setting says, and answers "every rule matches something" when nothing is unused. It compares names, so it cannot see a class built at runtime or one generated by a CSS module - on projects that use those it is wrong more often than right. Turn the setting on and the findings appear as you work.

Access: `All Features → Point out rules that style nothing`; `Find them (command:structure.unusedCss)`; `Turn on or off (setting:adcode.structure.unusedSelectors)`; `Settings → adcode.structure.unusedSelectors`.

<!-- feature:adcode.structure.selectorToElements -->
### Show the elements a rule styles

Click a style rule and see the things on the page it actually affects.

Why use it: It turns a class name nobody can trace into a list of elements you can click.

How to use it: On by default. Open the Structure popup with a stylesheet in front of you.

Access: `All Features → Show the elements a rule styles`; `Turn on or off (setting:adcode.structure.selectorToElements)`; `Settings → adcode.structure.selectorToElements`.

<!-- feature:adcode.structure.elementToRules -->
### Show the rules that style an element

Click something on the page and see every style rule that changes how it looks.

Why use it: A class is written in one file and used in another, and nothing normally connects the two.

How to use it: On by default. Works in HTML, and in React, Vue, Angular and Handlebars templates.

Access: `All Features → Show the rules that style an element`; `Turn on or off (setting:adcode.structure.elementToRules)`; `Settings → adcode.structure.elementToRules`.

## Languages

<!-- feature:adcode.language.customServers -->
### Additional language servers

Tell ADCode how to start the helper program for a language it does not know about yet.

Why use it: This is what replaces having to install an extension for every language. If your language has a language server, you can use it here.

How to use it: One per line, written as 'language: command'. For example 'zig: zls' or 'elm: elm-language-server --stdio'. It takes effect when you click away from the box.

Access: `All Features → Additional language servers`; `Settings → adcode.language.customServers`.

<!-- feature:adcode.language.dapClient -->
### Debug adapter client

Stop your program in the middle of running it, look at what every value actually is, and step through it one line at a time.

Why use it: Adding print statements to work out what a program is doing is guessing with extra steps. A debugger just shows you.

How to use it: On by default for JavaScript, TypeScript, and Python. Click in the margin left of a line number to set a stop point - a red dot - then press F5 to run. When it stops, the panel shows every value in scope; F10 goes to the next line, F11 steps inside a function, and F5 carries on. A language ADCode has no debugger for will say so rather than offering a button that does nothing.

Access: `All Features → Debug adapter client`; `Start debugging (command:debug.start)`; `Stop debugging (command:debug.stop)`; `Step over (command:debug.stepOver)`; `Step into (command:debug.stepInto)`; `Step out (command:debug.stepOut)`; `Debug console (command:view.debugConsole)`; `Turn on or off (setting:adcode.language.dapClient)`; `Settings → adcode.language.dapClient`; `Keyboard → F5`.

<!-- feature:adcode.language.lspClient -->
### Language server intelligence

A helper program that really understands the language you are writing, so ADCode can offer accurate suggestions, spot mistakes, and know where things are defined.

Why use it: Without one, an editor is guessing from the shape of the words. With one, it knows.

How to use it: On by default. It uses language servers already installed on your machine - ADCode does not bundle them. If one is running for the file you are in, you will see richer suggestions and more precise errors.

Access: `All Features → Language server intelligence`; `Turn on or off (setting:adcode.language.lspClient)`; `Settings → adcode.language.lspClient`.

<!-- feature:adcode.language.treeSitterHighlighting -->
### Tree-sitter highlighting

Colours the code by properly reading it, rather than by pattern-matching the words - so the colours are right even in tricky code.

Why use it: Simple colouring gets confused by things like a keyword inside a string, or nested templates. Real parsing does not get confused.

How to use it: On by default. It loads the grammar for a language the first time you open a file in it. If a grammar cannot be loaded, colouring quietly falls back to the simpler method rather than turning off.

Access: `All Features → Tree-sitter highlighting`; `Turn on or off (setting:adcode.language.treeSitterHighlighting)`; `Settings → adcode.language.treeSitterHighlighting`.

## The assistant

<!-- feature:adcode.ai.editPolicy -->
### AI edit approval

Choose whether each AI file change waits for your review or is applied automatically after a successful task turn.

Why use it: Review mode gives you hunk-by-hunk control. Trusted mode is faster for projects and agents you are comfortable with, while keeping isolation, overlap checks, and a rollback checkpoint.

How to use it: Review every change is the default. Trusted auto-apply never writes during the model turn: ADCode first collects exact proposals in the sandbox, then checkpoints and applies them together. Switch back to Review every change at any time; the next task uses the safer policy. Use Rollback on an applied task to go back, unless later human edits overlap it.

Access: `All Features → AI edit approval`; `Settings → adcode.ai.editPolicy`.

<!-- feature:ai.team -->
### AI Team

Several assistants can divide one larger task, work in parallel, and bring their results back to one reviewed task.

Why use it: Independent research, coding, and checking can finish faster without making one assistant carry every detail in the same context.

How to use it: Open the Assistant, describe the task, then choose Team. Review the suggested roles, files, token budget, and overlap warnings before you confirm. Team uses the same isolated workspaces, review policy, traces, and rollback protections as a single assistant.

Access: `All Features → AI Team`; `Set up Team (command:ai.team)`.

<!-- feature:ai.workspaceStorage -->
### AI workspace storage

Limits how much disk space task copies use and how long finished sandboxes and rollback checkpoints stay.

Why use it: Project copies can be large, but deleting the only safe way back is worse than filling a quota. ADCode treats active work and rollback checkpoints differently for that reason.

How to use it: Terminal sandboxes are cleaned oldest first. An applied task may lose its sandbox when space is tight, but its only rollback checkpoint is kept. If active work leaves no safe room, ADCode refuses the new task and tells you to raise the quota or discard one.

Access: `All Features → AI workspace storage`; `Settings → adcode.ai.sandboxQuota`; `Settings → adcode.ai.sandboxRetention`; `Settings → adcode.ai.checkpointRetention`.

<!-- feature:ai.sessions -->
### Chat history and memory

Every conversation is kept, so you can go back to one. A strip at the top shows exactly what the assistant is remembering right now, and a button clears it.

Why use it: Assistants that forget everything are frustrating, and assistants that remember invisibly are worse. Showing what is remembered makes clearing it something you can actually see work.

How to use it: The list beside the chat holds your past conversations - search them, rename them, delete one, or clear them all. Conversations are stored on your own machine, per project, and are never uploaded.

Access: `All Features → Chat history and memory`; `Open Assistant (command:ai.toggle)`.

<!-- feature:adcode.ai.chatWidget -->
### Chat widget

A small chat card you can call up to ask questions about the code you are looking at.

Why use it: Asking in the editor beats copying code into a browser, because the assistant can already see the project.

How to use it: On by default. Press the shortcut to summon it, drag its title bar to move it, and press Escape to dismiss it without losing the conversation. Past conversations are kept in the history list beside it.

Access: `All Features → Chat widget`; `Turn on or off (setting:adcode.ai.chatWidget)`; `Settings → adcode.ai.chatWidget`.

<!-- feature:ai.connect -->
### Connect a model

The screen where you tell ADCode which AI to use and give it your key. It checks the key works before saving it.

Why use it: A key that was pasted wrong should say so immediately, not silently fail the first time you ask a question.

How to use it: Pick a provider from the list, or choose Custom and paste any address that speaks the OpenAI format - that covers most services, including one running on your own machine. Where a provider supports signing in with an account instead of a key, there is a Sign in button. Keys go to your operating system's password store.

Access: `All Features → Connect a model`; `Connect (command:ai.connect)`.

<!-- feature:adcode.ai.autoContinue -->
### Continue terminal AI after limits

A detected terminal assistant can receive a literal “continue” after it says a usage or rate limit has reset.

Why use it: Long-running terminal tasks should not need you to watch the clock and return only to type one word.

How to use it: Off by default. When enabled, ADCode reads only the terminal output already visible in its own terminal. A clear usage-limit message with an explicit retry delay schedules one continuation. Unknown reset times and changed or ambiguous terminal state stop safely. A repeated limit may schedule the next attempt up to your retry cap. Closing ADCode or turning this setting off cancels every pending continuation.

Access: `All Features → Continue terminal AI after limits`; `Turn on or off (setting:adcode.ai.autoContinue)`; `Settings → adcode.ai.autoContinue`; `Settings → adcode.ai.autoContinueRetries`.

<!-- feature:adcode.ai.customBaseUrl -->
### Custom endpoint

Point ADCode at any AI service by pasting its address - including one running on your own computer.

Why use it: Most services speak the same format, so one address is all it takes to use a gateway, a cheaper host, or a model you run yourself.

How to use it: Set Provider to Custom, paste the address, and give it your key. The Connect screen checks it works before saving.

Access: `All Features → Custom endpoint`; `Settings → adcode.ai.customBaseUrl`.

<!-- feature:adcode.ai.inlineCompletion -->
### Inline completion

Grey text appears ahead of your cursor guessing the rest of what you are writing. Press Tab to take it.

Why use it: For the lines that are boring and predictable, which is more of them than anybody likes to admit.

How to use it: On by default. ADCode asks the selected model after you pause, without delaying a keystroke, and cancels the request as soon as the buffer changes. Press Tab to accept grey ghost text, keep typing to ignore it, or press Alt+\ to request a suggestion yourself. Local keyword and language-server suggestions continue to work separately.

Access: `All Features → Inline completion`; `Suggest now (command:ai.complete)`; `Turn on or off (setting:adcode.ai.inlineCompletion)`; `Settings → adcode.ai.inlineCompletion`; `Keyboard → Alt+\`.

<!-- feature:adcode.ai.isolatedWorkspaces -->
### Isolated AI edits

The assistant works in a separate copy of your project. Your real files change only after you review them, with a way back kept first.

Why use it: A model can make a useful mistake very quickly. Isolation lets it read its own edits and keep working without putting unfinished or conflicting changes into the project you are using.

How to use it: On by default. The assistant shows the task state, changed files, and Review button. Accept individual hunks, discard the sandbox, or roll an applied task back. Turning this off keeps chat available but disables the built-in file tools.

Access: `All Features → Isolated AI edits`; `Turn on or off (setting:adcode.ai.isolatedWorkspaces)`; `Settings → adcode.ai.isolatedWorkspaces`.

<!-- feature:adcode.ai.mcpServer -->
### MCP server

Lets AI tools outside ADCode - Claude Code, Codex, and others - read and write the same project notes.

Why use it: One set of notes shared by every assistant you use, rather than each one starting from nothing.

How to use it: On by default. Settings shows the exact command to run once, from your project folder, with a Copy button. That is the whole setup.

Access: `All Features → MCP server`; `Turn on or off (setting:adcode.ai.mcpServer)`; `Settings → adcode.ai.mcpServer`.

<!-- feature:adcode.ai.memoryCapture -->
### Memory capture

The assistant writes down decisions and conventions about your project, so it does not need telling twice.

Why use it: Explaining the same thing at the start of every conversation is the main reason AI assistants feel forgetful.

How to use it: On by default. Memories are plain markdown files in your project folder - you can read them, edit them, and delete them like any other file. Settings shows you where they are.

Access: `All Features → Memory capture`; `Turn on or off (setting:adcode.ai.memoryCapture)`; `Settings → adcode.ai.memoryCapture`.

<!-- feature:adcode.ai.model -->
### Model

Which particular AI, from that company, answers you.

Why use it: Bigger models are cleverer and slower; smaller ones are quick and cheap. Most people want a big one for hard questions and a small one for everything else.

How to use it: Pick from the list, which shows the models your key can actually reach rather than a fixed set. Switching takes effect on your next message - it does not restart the conversation.

Access: `All Features → Model`; `Settings → adcode.ai.model`.

<!-- feature:adcode.ai.provider -->
### Provider

Which company's AI you want to use. You bring your own account and key.

Why use it: Different models are better at different things, and cost different amounts. ADCode does not resell anybody's AI, so the choice - and the bill - is yours.

How to use it: Open Connect a model, pick a provider, and paste your key. ADCode checks the key works before saving it. Keys are kept in your operating system's own password store, never in a settings file. The local option needs no key at all - it talks to a model running on your own machine.

Access: `All Features → Provider`; `Settings → adcode.ai.provider`.

<!-- feature:adcode.ai.scheduledMessages -->
### Scheduled AI messages

Write a prompt now and ask a supported AI target to receive it later while ADCode is open.

Why use it: A reminder that can actually reach the assistant is useful for follow-up reviews, delayed provider windows, and work you want to queue without leaving an agent running.

How to use it: Choose Schedule beside the chat composer, select an available adapter and local time, then confirm. Built-in chat is always supported. For a detected terminal AI, first choose Allow next schedule while its prompt is visibly waiting; any later terminal activity removes that one-time permission. Compatible internal adapters use the same registration contract. If ADCode, the project, or scheduled messages are unavailable at delivery time, the one-time message is marked missed and does nothing until you choose Run now.

Access: `All Features → Scheduled AI messages`; `Schedule (command:ai.schedule)`; `Turn on or off (setting:adcode.ai.scheduledMessages)`; `Settings → adcode.ai.scheduledMessages`.

<!-- feature:adcode.ai.taskTokenBudget -->
### Task token budget

Sets a hard ceiling for one assistant task, checked before each new request can spend your key.

Why use it: Long tool loops and repeated context can cost far more than the first question suggests. Checking the whole request before it starts is safer than warning after the tokens are gone.

How to use it: The default is 100k. The task strip shows reserved tokens. ADCode pauses before the next request would cross the limit; raise it in Settings or start a new task when you want a fresh allowance.

Access: `All Features → Task token budget`; `Settings → adcode.ai.taskTokenBudget`.

<!-- feature:adcode.ai.terminalAgentDetection -->
### Terminal agent detection

If you start an AI tool in ADCode's terminal, ADCode notices and offers to share what it knows about the project with it.

Why use it: So the assistant in your terminal and the one in your editor are working from the same notes instead of two different ideas of the project.

How to use it: On by default. When an agent is recognised, a strip appears above the terminal with the one command that connects it. Nothing is shared unless you press it.

Access: `All Features → Terminal agent detection`; `Turn on or off (setting:adcode.ai.terminalAgentDetection)`; `Settings → adcode.ai.terminalAgentDetection`.

## Git

<!-- feature:adcode.git.blame -->
### Blame

Shows who last changed each line, and which save it came from.

Why use it: The name is unfriendly and the feature is not: it is how you find the person or the note that explains why a line is the way it is.

How to use it: Off by default. Git → Blame This Line names the author, the commit and its message for the line the cursor is on, and says so plainly when the line is not committed yet. Turn the setting on and every line gets a faint note instead; click one to open the full description of that change.

Access: `All Features → Blame`; `Blame this line (command:git.blame)`; `Turn on or off (setting:adcode.git.blame)`; `Settings → adcode.git.blame`.

<!-- feature:adcode.git.branchSwitcher -->
### Branch switcher

Work on a separate copy of the project, so you can try something without disturbing the version that works.

Why use it: It is the safe way to attempt anything risky. If it goes badly you throw the copy away and nothing else was touched.

How to use it: On by default. The current branch name is at the bottom-left of the window; click it to switch to another or to start a new one. Git → Checkout Branch and Git → Create Branch do the same from the menu.

Access: `All Features → Branch switcher`; `Switch branch (command:git.checkout)`; `Create a branch (command:git.createBranch)`; `Turn on or off (setting:adcode.git.branchSwitcher)`; `Settings → adcode.git.branchSwitcher`.

<!-- feature:adcode.git.fileTimeline -->
### File timeline

Every past version of the file you are looking at, newest first, in a list you can open.

Why use it: It answers 'when did this break' and 'what did this look like last week' without leaving the editor.

How to use it: On by default. Git → File Timeline lists every commit that touched the file you are looking at, and says when none has yet. The Source Control panel shows the same list under Timeline; click any entry to see that version, and what changed in it.

Access: `All Features → File timeline`; `Show the timeline (command:git.timeline)`; `Turn on or off (setting:adcode.git.fileTimeline)`; `Settings → adcode.git.fileTimeline`.

<!-- feature:adcode.git.gutterDiff -->
### Gutter diff decorations

Little coloured marks in the left margin show which lines you have changed since you last saved them into your project's history.

Why use it: It answers 'what have I actually touched here' without opening anything or comparing anything.

How to use it: On by default. Green means you added the line, blue means you changed it, and a small triangle means you deleted something there. Click a mark to see what was there before, and to undo just that change.

Access: `All Features → Gutter diff decorations`; `Turn on or off (setting:adcode.git.gutterDiff)`; `Settings → adcode.git.gutterDiff`.

<!-- feature:adcode.git.mergeConflict -->
### Merge conflict resolution

When two people changed the same line, this shows you both versions side by side and lets you pick.

Why use it: A conflict is the one moment source control cannot decide for you, and the raw markers it leaves in the file are genuinely hard to read.

How to use it: On by default. Press Check Conflicts in the Source Control panel, or Git → Check Merge Conflicts, to list every file where both sides changed the same lines - it answers "No merge conflicts" when there are none, so you never have to guess. Open one of those files and each conflict gets Keep yours, Keep theirs, and Keep both above it; you can also edit the result by hand. Save the file to keep what you chose.

Access: `All Features → Merge conflict resolution`; `Check for conflicts (command:git.conflicts)`; `Turn on or off (setting:adcode.git.mergeConflict)`; `Settings → adcode.git.mergeConflict`.

<!-- feature:adcode.git.stageCommitUi -->
### Stage, unstage, and commit

Pick which of your changes to keep as a set, write a note about them, and save that set into your project's history.

Why use it: This is the point of source control: your work gets saved in labelled steps you can go back to, rather than as one big pile of edits.

How to use it: On by default. Open the Source Control panel in the activity bar. Tick the changes you want in this set - that is 'staging' - write a short note saying what you did, and press Commit.

Access: `All Features → Stage, unstage, and commit`; `Commit (command:git.commit)`; `Stage all (command:git.stageAll)`; `Unstage all (command:git.unstageAll)`; `Push (command:git.push)`; `Pull (command:git.pull)`; `Fetch (command:git.fetch)`; `Initialise a repository (command:git.init)`; `Clone a repository (command:workspace.clone)`; `Open Source Control (command:view.scm)`; `Turn on or off (setting:adcode.git.stageCommitUi)`; `Settings → adcode.git.stageCommitUi`.

## Your session

<!-- feature:adcode.session.autoSave -->
### Auto-save after delay

Stop typing for a moment and your file saves itself.

Why use it: So losing work stops being possible, and so you stop pressing Ctrl+S out of habit every few seconds.

How to use it: On by default. It waits until you pause, so it never saves a half-typed word. You can still save whenever you like with Ctrl+S.

Access: `All Features → Auto-save after delay`; `Turn on or off (setting:adcode.session.autoSave)`; `Settings → adcode.session.autoSave`; `Keyboard → CmdOrCtrl+S`.

<!-- feature:adcode.session.crashRecovery -->
### Crash recovery

If ADCode closes unexpectedly, your unsaved typing is still there when it opens again.

Why use it: Crashes and power cuts happen, and losing an hour to one is miserable.

How to use it: On by default, and there is usually nothing to do: reopen ADCode and it offers your unsaved work back. File → Recover Unsaved Files asks again at any time, and answers "nothing to recover" when every file is already saved.

Access: `All Features → Crash recovery`; `Recover unsaved files (command:session.recover)`; `Turn on or off (setting:adcode.session.crashRecovery)`; `Settings → adcode.session.crashRecovery`.

<!-- feature:adcode.session.localFileHistory -->
### Local file history

ADCode quietly keeps its own copies of files as you edit them, separate from your project's history.

Why use it: For the moment you delete something you needed and had not saved into your project's history yet. It is the undo that survives closing the file.

How to use it: On by default. File → Local History lists every copy ADCode has kept of the file you are looking at, newest first, and tells you when there are none yet. Choose one and it opens read-only beside your working copy, so you can copy what you need back without overwriting anything.

Access: `All Features → Local file history`; `Open local history (command:file.localHistory)`; `Turn on or off (setting:adcode.session.localFileHistory)`; `Settings → adcode.session.localFileHistory`.

<!-- feature:adcode.session.workspaceRestore -->
### Restore workspace

Open ADCode again and everything is how you left it - the same folder, the same tabs.

Why use it: Setting your work back up every morning is a small tax you should not have to pay.

How to use it: On by default. Just close the window; next time you open it, your files are back.

Access: `All Features → Restore workspace`; `Turn on or off (setting:adcode.session.workspaceRestore)`; `Settings → adcode.session.workspaceRestore`.

## The workbench

<!-- feature:workbench.allFeatures -->
### All Features

A searchable library of everything ADCode can do, with an Open button and a plain explanation beside every feature.

Why use it: You should not need to know a command's name, shortcut, or menu before you can discover it.

How to use it: Choose the four-cell All Features button below Earnings, or open View and choose All Features. Search by a feature name or describe what you want to do. Choose Open to use it and ? to understand it.

Access: `All Features → All Features`; `Open (command:features.open)`; `Preferences (command:settings.open)`; `Full screen (command:view.fullScreen)`; `Toggle side bar (command:view.toggleSidebar)`; `Toggle panel (command:view.togglePanel)`; `Zoom in (command:view.zoomIn)`; `Zoom out (command:view.zoomOut)`; `Reset zoom (command:view.zoomReset)`; `Problems (command:view.problems)`; `Output (command:view.output)`; `Ports (command:view.ports)`; `Feature guide (command:help.guide)`; `Developer tools (command:help.devTools)`; `About ADCode (command:help.about)`.

<!-- feature:workbench.terminal -->
### Built-in terminal

A command line inside ADCode, already pointed at your project folder.

Why use it: Most work needs both an editor and a terminal, and switching windows between them adds up.

How to use it: Open it from the panel at the bottom. You can have several at once, and each remembers what it was doing.

Access: `All Features → Built-in terminal`; `Open (command:terminal.toggle)`; `New terminal (command:terminal.new)`; `New terminal with profile (command:terminal.newWithProfile)`; `Split (command:terminal.split)`; `Next terminal (command:terminal.next)`; `Previous terminal (command:terminal.previous)`; `Copy (command:terminal.copy)`; `Paste (command:terminal.paste)`; `Clear (command:terminal.clear)`; `Kill (command:terminal.kill)`; `Kill all (command:terminal.killAll)`; `Run this file in the terminal (command:terminal.runActiveFile)`.

<!-- feature:workbench.commandPalette -->
### Command palette

One box that can run anything ADCode does. Type what you want rather than hunting a menu.

Why use it: There are hundreds of commands and no menu can hold them all. If you can name it, you can run it.

How to use it: Press Ctrl+Shift+P and start typing. The shortcut for each command is shown beside it, so it teaches you the keys as you use it.

Access: `All Features → Command palette`; `Open (command:palette.open)`; `Keyboard → CmdOrCtrl+Shift+P`.

<!-- feature:workbench.keybindings -->
### Keyboard shortcuts

Every shortcut can be changed to whatever keys you prefer.

Why use it: Muscle memory from another editor is worth more than any default we could pick.

How to use it: Help, then Keyboard Shortcuts. Search for a command, click its keys, and press the combination you want. Conflicts are pointed out rather than silently taking over.

Access: `All Features → Keyboard shortcuts`; `Open (command:help.shortcuts)`.

<!-- feature:workbench.collab -->
### Live collaboration

Someone else can open the same files at the same time and you both see each other typing.

Why use it: For fixing something together without one of you reading the other's screen over a call.

How to use it: Start a session and share the invitation. It works over your local network - the code does not travel through anybody else's server.

Access: `All Features → Live collaboration`; `Open (command:collab.panel)`; `Leave session (command:collab.leave)`.

<!-- feature:workbench.preview -->
### Live preview

See a web page you are building beside your code, updating as you type.

Why use it: Saving, switching to a browser, and refreshing is three steps too many when you are adjusting a layout.

How to use it: Open a HTML file and start the preview. It reloads itself when you save.

Access: `All Features → Live preview`; `Open (command:preview.toggle)`; `Reload (command:preview.reload)`; `Undock into a window (command:preview.undock)`; `Switch project or files (command:preview.switchMode)`; `Another screen size (command:preview.device)`.

<!-- feature:workbench.run -->
### Run

One button that runs whatever you are working on, working out the right command by itself.

Why use it: Every language and project starts differently, and remembering which is which is pointless work.

How to use it: Press Run. If the tool it needs is not installed, ADCode says which one and where to get it rather than failing with an error you have to decode.

Access: `All Features → Run`; `Run (command:run.file)`.

<!-- feature:structure.popup -->
### Structure

A window showing what is inside the file you are reading, and what is inside the project, drawn as a tree with lines joining each thing to what it belongs to.

Why use it: The file list tells you what is there. It does not tell you what any of it is. This does - and for a function it also shows what that function calls, and what calls it.

How to use it: Open it from the activity bar or its shortcut. Two tabs: This file, and This project. Click any row to jump to it. For a style rule it shows the elements that rule actually affects, and for an element the rules that style it.

Access: `All Features → Structure`; `Open (command:view.structure)`.

<!-- feature:structure.cssLinks -->
### Style and markup links

Click a style rule to see the things on the page it changes, or click something on the page to see the rules that style it.

Why use it: A class name written in one file and used in another is the most common untraceable link in a codebase. This traces it, both ways.

How to use it: Works in HTML, JSX className, and Vue, Angular, and Handlebars templates. It can also point out rules that style nothing, and class names nothing defines - both switchable, since on a large project either list can be long.

Access: `All Features → Style and markup links`; `Open project map (command:view.projectMap)`.

<!-- feature:workbench.universalSearch -->
### Universal search

The search box in the title bar finds ADCode features, commands, files, recent folders, and symbols together.

Why use it: One search is faster when you remember what you want but not which menu, panel, or file contains it.

How to use it: Choose the title-bar search and type a name or goal. Use the arrow keys and Enter to open a result. Start with > for commands. Ctrl+P, Ctrl+Shift+P, Ctrl+T, and Ctrl+Shift+F still open their focused searches.

Access: `All Features → Universal search`; `Search (command:search.universal)`.

## Appearance

<!-- feature:adcode.appearance.theme -->
### Appearance

Light or dark. System means it matches whatever your computer is set to.

Why use it: Dark is easier at night, light is easier in daylight, and following the system means you never think about it.

How to use it: System by default, which also picks up your computer's accent colour. Choose Light or Dark to override it.

Access: `All Features → Appearance`; `Settings → adcode.appearance.theme`.

<!-- feature:adcode.appearance.density -->
### Density

How much space there is between things. Comfortable is roomier; compact fits more on screen.

Why use it: Generous spacing looks good on a large monitor and wastes a laptop screen.

How to use it: Pick Comfortable or Compact. It changes immediately, everywhere.

Access: `All Features → Density`; `Settings → adcode.appearance.density`.

## Account

<!-- feature:account.earnings -->
### Earnings

What you have been paid for the sponsored cards you have seen, listed one by one.

Why use it: So the number is something you can check rather than something you are told.

How to use it: Open the earnings view from the title bar. Every row is a real event with the exact amount. The total is worked out by adding the rows up, so it can never disagree with them. Nothing in ADCode can edit or delete a row - a correction is a new row that points at the one it corrects.

Access: `All Features → Earnings`; `Open (command:view.earnings)`.

<!-- feature:account.signIn -->
### Signing in

Signing in keeps your earnings attached to you rather than to this one computer.

Why use it: Without it, your balance lives only on this machine and is lost if the machine is.

How to use it: Use the account button in the title bar. You can sign in with Google, GitHub, or an email address, and anything you already earned anonymously comes with you.

Access: `All Features → Signing in`; `Open account (command:account.open)`.

## Files and gestures

<!-- feature:gestures.multiSelect -->
### Selecting and moving files

Files can be renamed, moved, copied and deleted straight from the file list.

Why use it: Leaving the editor to use a file manager for something this ordinary is a break in the work.

How to use it: Right-click any file for the full list. Drag to move, hold Ctrl while dragging to copy, and F2 to rename. Deleting sends to the recycle bin, not to nowhere.

Access: `All Features → Selecting and moving files`; `Open Explorer (command:view.explorer)`; `New file (command:file.new)`; `Open file (command:file.open)`; `Save (command:file.save)`; `Save as (command:file.saveAs)`; `Save all (command:file.saveAll)`; `Revert file (command:file.revert)`; `Close editor (command:editor.close)`; `Close all editors (command:editor.closeAll)`; `Insert file template (command:editor.insertTemplate)`; `Open folder (command:workspace.open)`; `Open recent (command:workspace.openRecent)`; `Open a recent folder (command:workspace.openRecentAt)`; `Clear recent folders (command:workspace.clearRecents)`; `Close folder (command:workspace.close)`; `Keyboard → F2`.

## Ads and earnings

<!-- feature:adcode.ads.frequency -->
### Frequency

How often a sponsored card is allowed to appear. Off, Light, Standard, or Max.

Why use it: Fewer cards means less interruption and less earned; more means the opposite. It is your trade to make.

How to use it: Standard by default - at most one every 30 minutes and 8 a day. Light is one an hour and 4 a day; Max is one every 15 minutes and 20 a day. These limits are counted on your machine, and the server is only ever allowed to make them stricter, never looser.

Access: `All Features → Frequency`; `Settings → adcode.ads.frequency`.

<!-- feature:adcode.ads.enabled -->
### Sponsored messages

A small advert card appears in the corner sometimes, and you get paid a little each time one is shown.

Why use it: It is how ADCode is free. If you would rather not, turning this off costs you nothing else - no nag screens, no locked features.

How to use it: On by default. This switch is the final say on this machine: with it off, nothing is shown and nothing is earned, whatever the server says. Cards never appear while you are typing, while a command is running, while you are debugging, or when the window is not in front.

Access: `All Features → Sponsored messages`; `Turn on or off (setting:adcode.ads.enabled)`; `Settings → adcode.ads.enabled`.

## Updates

<!-- feature:adcode.updates.auto -->
### Install updates automatically

New versions download quietly in the background and are in place the next time you open ADCode.

Why use it: So you are never out of date, and never stopped mid-thought by a box asking to restart.

How to use it: On by default. ADCode will not restart itself and will not interrupt you to ask - you close the editor when you are ready, and the new version is what opens next time. Help → Check for Updates asks now and tells you where you stand, including when you are already on the latest version. Turn this off to update by hand instead.

Access: `All Features → Install updates automatically`; `Check now (command:updates.check)`; `Turn on or off (setting:adcode.updates.auto)`; `Settings → adcode.updates.auto`.

<!-- feature:updates.whatsNew -->
### Tell me what changed

Now and then, a small card tells you what changed in the version you just got.

Why use it: A feature nobody is told about may as well not exist. This is the one interruption ADCode allows itself, so it is kept rare.

How to use it: Four rules keep it quiet: you see a given version's note once on this machine and never again, it waits for a moment when you are not typing, not running a command, and not debugging, it only appears for releases worth reading - small fixes install silently - and it never appears on a brand new install. Dismiss it and it is gone for good. Turn this off and nothing ever pops up; Help > What's New still has every note. A security fix is the one thing that will not wait for a quiet moment, though even that respects the switch being off.

Access: `All Features → Tell me what changed`; `Read it (command:help.whatsNew)`; `Turn on or off (setting:adcode.updates.announce)`; `Settings → adcode.updates.announce`.
