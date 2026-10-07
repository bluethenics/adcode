# Complete ADCode feature guide

This guide explains every item in ADCode's **All Features** library: what it does, when it
helps, and where to find it. You can also search for any of these features from Universal
Search in the title bar or from Help → Feature Guide.

## Find and open anything

- Open **All Features** with the four-cell icon below Earnings or with **View → All
  Features**.
- Use the title-bar **Universal Search** when you know what you want but not where it
  lives. It searches features, actions, files, recent projects, and workspace symbols.
  Start with `>` to favour actions.
- Use **Quick Open** (`Ctrl+P`) when you only want a file.
- Use the **Command Palette** (`Ctrl+Shift+P`) when you only want a command.
- Use **Symbol Search** (`Ctrl+T`) when you only want a function, class, or symbol.
- Use project **Content Search** (`Ctrl+Shift+F`) when you want text inside files.

Search results are grouped by kind and update as you type, so the list always matches your
latest query.

## Use the Feature Library

1. Open **All Features** using the icon, View menu, Feature Guide, or Universal Search.
2. Type a goal such as “multiple AI”, “format on save”, or “preview phone”.
3. Filter by category if you want to browse instead of search.
4. Select **Open**, **Search**, **Connect**, **Schedule**, or the Settings route shown on the
   card.
5. Select the `?` explanation for **What it does**, **Why use it**, and **How to use it**.

## AI work without giving up normal coding

AI features are optional. Files, menus, editor shortcuts, terminals, source control,
debugging, and extensions continue to work normally without connecting a model.

- **Apply automatically** is the default: the assistant edits your files as it works, and
  each turn that changed files gets an **Undo** card in the conversation that puts them back.
- **Team** can divide one goal among multiple AI roles. ADCode shows the shared goal,
  ownership, trace, token use, and each proposed change instead of hiding parallel work.
- **Review every change** is one click away in the chat's approval menu. Edits are staged in
  an isolated copy of the project, and when the turn ends one card offers **Apply all
  changes** or **Discard** - nothing reaches the working project until you apply.
- **Scheduled messages** are delivered only while ADCode is open. Built-in chat is always
  supported; terminal delivery requires a visibly waiting compatible agent and a one-time
  permission. Missed one-time messages wait for you to choose **Run now**.
- **Auto-continuation** resumes a paused supported agent only under the configured limits.
  It never bypasses provider usage limits, token budgets, approvals, or a closed ADCode
  window.
- **Trace and review** show requests, tool activity, file changes, costs, pauses, and errors.
  Secrets stay in the operating system credential store, and every AI change to the real
  project can be undone or, in Review mode, waits for the user to apply it.

Read [AI workspaces and automation](./ai-workspaces.md) for the end-to-end workflow and
[AI workspace security](../architecture/ai-workspace-security.md) for the trust boundary,
privacy rules, validation, and rollback guarantees.

## Keyboard routes

On macOS, use Command where a shortcut below says Ctrl.

- Edit with AI: `Ctrl+E`
- Inline completion: `Alt+\`
- Multi-cursor: `Ctrl/Cmd+D`
- Built-in formatter: `Shift+Alt+F`
- Format on save: `Ctrl/Cmd+S`
- Debug adapter client: `F5`
- Fuzzy file open: `Ctrl/Cmd+P`
- Symbol search: `Ctrl/Cmd+T`
- Global search and replace: `Ctrl/Cmd+Shift+F`
- Auto-save after delay: `Ctrl/Cmd+S`
- Ask AI about your code: `Ctrl+L`
- Command palette: `Ctrl/Cmd+Shift+P`
- Selecting and moving files: `F2`
- Vibe sidebar: `Ctrl+B`

# Feature inventory

Every item below is also a searchable card in **All Features**. Use the matching menu,
button, or shortcut shown for each feature.

## Editing

<!-- feature:adcode.editing.acceptOnEnter -->
### Accept suggestion with Enter

With the suggestion list open, pressing Enter takes the suggestion instead of starting a new line.

Why use it: It is what makes suggestions fast. It is also the thing that annoys people who wanted a new line, which is why it is its own switch rather than part of suggestions.

How to use it: Off by default, so Enter always starts a new line. Turn it on and Enter takes the highlighted suggestion; Tab still takes the suggestion either way.

Access: `All Features → Accept suggestion with Enter`; `Turn on or off`; `Settings`.

<!-- feature:adcode.editing.autoRenamePairedTag -->
### Auto-rename paired tag

Change the name of an opening tag and its closing tag changes to match, by itself.

Why use it: Renaming one and not the other breaks the page, and you usually find out somewhere else entirely.

How to use it: On by default. Edit the name inside an opening tag; the closing tag follows as you type, and one press of Ctrl+Z undoes both together.

Access: `All Features → Auto-rename paired tag`; `Turn on or off`; `Settings`.

<!-- feature:adcode.editing.bracketPairColorization -->
### Bracket pair colorization

Brackets get colours. The one that opens and the one that closes are the same colour, so you can see which goes with which.

Why use it: When code is nested several layers deep, finding the bracket that closes the one you are looking at means counting. Colour turns counting into looking.

How to use it: Nothing to do - it is on. Turn it off if you find the colours noisy.

Access: `All Features → Bracket pair colorization`; `Turn on or off`; `Settings`.

<!-- feature:adcode.editing.spellCheck -->
### Check spelling in comments

Misspelled words in comments get a wavy underline, and the fix is one click away on the lightbulb.

Why use it: A typo in a comment is the one kind nothing else catches - the compiler does not read comments, the linter does not read them, and reviewers skim them. So it sits there forever.

How to use it: Off by default. Edit → Check Spelling in Comments runs it over every open file and reports into the Problems panel, including when it finds nothing. It only flags words it can name a correction for, so a library, a product, or somebody's name is left alone instead of underlined - which is why it never becomes the noise you switch off. Code is never checked: an identifier is named, not spelled.

Access: `All Features → Check spelling in comments`; `Check now`; `Turn on or off`; `Settings`.

<!-- feature:adcode.editing.autoCloseTags -->
### Close tags automatically

Type the end of an opening tag and the closing one appears by itself. Type a closing bracket and it finishes the tag you still have open.

Why use it: Forgetting to close a tag is the most common way HTML breaks, and the error it produces rarely points at the tag you forgot.

How to use it: On by default in HTML, XML, JSX, and templates. Type >, and the closing tag is written for you with the cursor left between them.

Access: `All Features → Close tags automatically`; `Turn on or off`; `Settings`.

<!-- feature:adcode.editing.codeFolding -->
### Code folding

Collapse a chunk of code down to one line, and open it again when you want it.

Why use it: A file is easier to read when the parts you are not working on are out of the way.

How to use it: On by default. Click the small arrow in the margin beside a line, or press Ctrl+Shift+[ to fold and Ctrl+Shift+] to unfold.

Access: `All Features → Code folding`; `Turn on or off`; `Settings`.

<!-- feature:adcode.editing.commentTones -->
### Colour comments by intent

Start a comment with !, ?, or * and it takes a colour. Start one with a second // and it fades, because that is code you commented out.

Why use it: A warning, an open question, and a line of dead code are three different kinds of writing that all render the same grey. One character tells them apart.

How to use it: Off by default. Line comments only - a /** block */ begins with * by convention, and colouring those would mark every documented function in a project.

Access: `All Features → Colour comments by intent`; `Turn on or off`; `Settings`.

<!-- feature:adcode.editing.columnSelection -->
### Column selection mode

Dragging the mouse selects a rectangle of text - a straight column down the page - instead of following the words.

Why use it: Useful for lining up columns of data or stripping the same prefix off twenty lines.

How to use it: Off by default, because it is a mode: while it is on, every mouse drag makes a box instead of selecting text, and that is not something to switch on by accident. Turn it on when you need it and off again after.

Access: `All Features → Column selection mode`; `Turn on or off`; `Settings`.

<!-- feature:adcode.editing.plainEnglishErrors -->
### Explain errors in plain English

Confusing error messages get rewritten into a sentence that says what actually went wrong.

Why use it: Compiler messages are written for people who already know the compiler. Most of the time the real meaning is simple and the wording is not.

How to use it: On by default. The rewritten sentence is shown first and the compiler's original wording is always kept underneath, because sometimes the exact words are what you need to search for.

Access: `All Features → Explain errors in plain English`; `Turn on or off`; `Settings`.

<!-- feature:adcode.editing.indentGuides -->
### Indent guides

Faint vertical lines show how far in each line is pushed.

Why use it: In languages where indentation decides what belongs to what - Python especially - the lines are the difference between reading the structure and guessing it.

How to use it: On by default. The guide for the block your cursor is in is brighter than the rest.

Access: `All Features → Indent guides`; `Turn on or off`; `Settings`.

<!-- feature:adcode.editing.inlineErrorLens -->
### Inline error and warning lens

When a line has a mistake, the message about it sits right at the end of that line.

Why use it: Otherwise the message lives in a panel at the bottom, or inside a tooltip you have to hover to see. Both mean looking away from the line you are fixing.

How to use it: Off by default, so the editor stays quiet unless you ask. Turn it on and the message is dimmed and shortened so it never covers your code, and it hides itself on the line your cursor is on while you type.

Access: `All Features → Inline error and warning lens`; `Turn on or off`; `Settings`.

<!-- feature:adcode.editing.inlineGitBlame -->
### Inline git blame

Beside the line your cursor is on, it quietly says who last changed it and when.

Why use it: Reading somebody else's code, the useful question is often not what a line does but why it was written. The commit that added it usually says.

How to use it: Off by default, because it puts text beside your cursor all day. Turn it on and click a line; the note appears at the end of it.

Access: `All Features → Inline git blame`; `Turn on or off`; `Settings`.

<!-- feature:adcode.editing.minimap -->
### Minimap

A tiny picture of the whole file down the right-hand edge, that you can click to jump.

Why use it: You often remember roughly where something was - near the top, in that dense block - without remembering its name. The shape of the file is a real way to navigate.

How to use it: Off by default. Turn it on, then drag the highlighted box to scroll, or click anywhere on it to jump there.

Access: `All Features → Minimap`; `Turn on or off`; `Settings`.

<!-- feature:adcode.editing.multiCursor -->
### Multi-cursor

Put more than one cursor on the page and type in all those places at once.

Why use it: Changing the same word in six places is six edits done one at a time, or one edit done six times at once.

How to use it: Ctrl+click to add a cursor anywhere. Ctrl+D adds one at the next copy of the word you have selected. Ctrl+Alt+Up or Down adds one on the line above or below. Escape drops back to one.

Access: `All Features → Multi-cursor`; `Add next occurrence`; `Select all occurrences`; `Select all`; `Expand selection`; `Shrink selection`; `Copy line up`; `Copy line down`; `Move line up`; `Move line down`; `Duplicate selection`; `Add cursor above`; `Add cursor below`; `Turn on or off`; `Settings`; `Keyboard → Ctrl/Cmd+D`.

<!-- feature:adcode.editing.pathAutocomplete -->
### Path autocomplete

When you are typing the name of another file, it offers you the files that are really there.

Why use it: A mistyped path is a broken import, and the error it causes names the wrong thing surprisingly often. Being offered only files that exist makes the mistake impossible.

How to use it: On by default. Start typing a path inside quotes or an import and the list appears. Type / to go into a folder.

Access: `All Features → Path autocomplete`; `Turn on or off`; `Settings`.

<!-- feature:adcode.editing.trailingWhitespace -->
### Render trailing whitespace

Extra spaces left hanging at the end of a line are made visible.

Why use it: They are invisible by definition, they show up as changes in every review, and some languages care about them.

How to use it: Off by default, since dots at the end of lines are a distraction if you are not hunting them. Turn it on and they appear as faint marks.

Access: `All Features → Render trailing whitespace`; `Turn on or off`; `Settings`.

<!-- feature:adcode.editing.fileTemplates -->
### Start new files from a template

A brand new file already has the boring first lines in it - the doctype for a web page, the main function for a C program.

Why use it: Nobody remembers the exact opening lines of every language, and looking them up is the least interesting part of starting something.

How to use it: On by default. Make a new file with a known extension and the boilerplate is there. Press Ctrl+Z once if you would rather start empty.

Access: `All Features → Start new files from a template`; `Turn on or off`; `Settings`.

<!-- feature:adcode.editing.stickyScroll -->
### Sticky scroll

As you scroll down inside a long function, its name stays stuck at the top of the editor so you never lose track of where you are.

Why use it: Two hundred lines into a file, the thing you most want to know is which function you are inside. Scrolling back up to check is how you lose your place.

How to use it: Off by default. Turn it on, then click a stuck line at the top to jump back to it.

Access: `All Features → Sticky scroll`; `Turn on or off`; `Settings`.

<!-- feature:adcode.editing.wordSuggestions -->
### Suggest words already in the file

Even with nothing clever available, it will suggest words you have already used nearby.

Why use it: This is the fallback for languages with no language server. A dumb suggestion of a word you definitely typed is still better than typing it again.

How to use it: On by default. It only ever offers words from the file you are in.

Access: `All Features → Suggest words already in the file`; `Turn on or off`; `Settings`.

<!-- feature:adcode.editing.suggestions -->
### Suggestions as you type

A little list pops up guessing what you are about to type, so you can pick it instead.

Why use it: It saves typing, and more importantly it saves remembering exact names.

How to use it: On by default. Keep typing to narrow the list, press Tab or Enter to take the highlighted one, Escape to dismiss it.

Access: `All Features → Suggestions as you type`; `Undo`; `Redo`; `Find`; `Replace`; `Toggle line comment`; `Toggle block comment`; `Cut`; `Copy`; `Paste`; `Toggle word wrap`; `Turn on or off`; `Settings`.

<!-- feature:adcode.editing.todoHighlighting -->
### TODO and FIXME highlighting

Notes you leave yourself in comments - TODO, FIXME, HACK - get a colour so they stand out.

Why use it: A note you cannot find is a note you did not leave. These are the comments you actually want to trip over later.

How to use it: On by default, and only inside real comments - the word TODO in a piece of text or a string is left alone. Edit → List TODOs and FIXMEs collects them from every open file into the Problems panel, and says when there are none.

Access: `All Features → TODO and FIXME highlighting`; `List them`; `Turn on or off`; `Settings`.

## Finding your way

<!-- feature:adcode.navigation.breadcrumbs -->
### Breadcrumbs

A line above the editor showing the trail to where you are: the folder, the file, and the function your cursor is inside.

Why use it: It answers 'where am I' at a glance, and every part of the trail is a button.

How to use it: On by default. Click a workspace or folder to browse inside it and across sibling folders. Click the file for sibling and recent files, Quick Open, copy, reveal, rename, and comparison/history actions. Click a symbol to search the file outline. With a crumb focused, use Left and Right to move through levels, Down or Enter to open one, then type to filter and press Enter to switch.

Access: `All Features → Breadcrumbs`; `Turn on or off`; `Settings`.

<!-- feature:adcode.navigation.fuzzyFileOpen -->
### Fuzzy file open

Open any file by typing a few letters of its name. You do not have to get them right, or in order.

Why use it: Clicking through folders to find a file you already know the name of is the slowest thing in any editor.

How to use it: Press Ctrl+P and start typing. 'ushnd' will find 'useHandler.ts'. Enter opens the highlighted one. Files in folders that search skips, such as node_modules or a folder your .gitignore leaves out, are not listed; open those from the file tree.

Access: `All Features → Fuzzy file open`; `Go to a file`; `Turn on or off`; `Settings`; `Keyboard → Ctrl/Cmd+P`.

<!-- feature:adcode.navigation.globalSearch -->
### Global search and replace

Search every file in the project for some text, and change it everywhere at once.

Why use it: Renaming something, or finding every place a mistake was copied to.

How to use it: Press Ctrl+Shift+F. You can search for a pattern rather than exact text, restrict it to certain files, and see every change before you make it. Some folders are never searched: downloaded and built ones such as node_modules and dist, any folder your project's .gitignore or .git/info/exclude leaves out, and .claude/worktrees, where coding agents keep whole copies of the project.

Access: `All Features → Global search and replace`; `Search the project`; `Turn on or off`; `Settings`; `Keyboard → Ctrl/Cmd+Shift+F`.

<!-- feature:adcode.navigation.goToDefinition -->
### Go to definition and references

Click a name to see where it was made, or to see everywhere else it is used. A small preview opens under the line so you do not lose your place.

Why use it: It is the difference between reading code and searching it. Following a function to its body is the single most common thing anybody does in an unfamiliar project.

How to use it: Click a name for the preview, click the preview's title or Ctrl+click the name to go there properly, and Escape to close. ADCode tells you how it found the answer: 'resolved' means a language server worked it out for certain, and 'matched by name' means ADCode found things with the same name - which is usually right and is not a promise.

Access: `All Features → Go to definition and references`; `Go to definition`; `Peek definition`; `Turn on or off`; `Settings`.

<!-- feature:adcode.navigation.outline -->
### Outline

A list of everything in the file you are looking at - its functions, classes, and sections.

Why use it: It is the table of contents for a file, and the fastest way to jump around inside a long one.

How to use it: On by default. Open the Structure popup to see it drawn as a tree, with lines connecting each thing to what it belongs to. Click any entry to jump to it.

Access: `All Features → Outline`; `Go to a line`; `Next editor`; `Previous editor`; `Next change`; `Previous change`; `Turn on or off`; `Settings`.

<!-- feature:adcode.navigation.symbolSearch -->
### Symbol search

Find a function, class, or variable by name anywhere in the project, without knowing which file it is in.

Why use it: You almost always remember what a thing is called and almost never remember where it lives.

How to use it: Press Ctrl+T and type the name. The list shows what kind of thing each result is and which file it is in.

Access: `All Features → Symbol search`; `Go to a symbol`; `Turn on or off`; `Settings`; `Keyboard → Ctrl/Cmd+T`.

## Formatting

<!-- feature:adcode.formatting.formatter -->
### Built-in formatter

Tidies your code for you - puts the spaces, indents and line breaks in the same places every time.

Why use it: Arguing about where the spaces go is the least valuable thing a person can do with their day. A formatter ends the argument by always doing the same thing.

How to use it: On by default, and there is nothing to install. Press Shift+Alt+F to tidy the open file. If a language server is running for that language, ADCode asks it first because it understands that language more precisely; otherwise ADCode's own formatter does it.

Access: `All Features → Built-in formatter`; `Format this file`; `Turn on or off`; `Settings`; `Keyboard → Shift+Alt+F`.

<!-- feature:adcode.formatting.formatOnSave -->
### Format on save

Every time you save, the file gets tidied first.

Why use it: So you never think about it again. Code that is formatted on every save is never messy, and nobody has to remember a shortcut.

How to use it: Off by default, so saving never rewrites your file unless you ask. Turn it on and save as usual with Ctrl+S. If the formatter cannot handle that language, the file is saved exactly as you wrote it rather than mangled.

Access: `All Features → Format on save`; `Turn on or off`; `Settings`; `Keyboard → Ctrl/Cmd+S`.

<!-- feature:adcode.formatting.lintDiagnostics -->
### Lint diagnostics

Underlines the things that are wrong, or look wrong, while you type.

Why use it: Finding a mistake as you make it costs a second. Finding it when the program runs costs a lot more.

How to use it: On by default. Red means it is broken, yellow means it is suspicious. All of them are collected in the Problems panel, and hovering one shows the detail.

Access: `All Features → Lint diagnostics`; `Turn on or off`; `Settings`.

<!-- feature:adcode.formatting.organizeImportsOnSave -->
### Organize imports on save

When you save, the list of other files your file uses gets sorted, and any it no longer uses are removed.

Why use it: Import lists grow messy on their own and nobody ever tidies them on purpose.

How to use it: Off by default, because deleting a line you did not ask to delete deserves to be a choice. Edit → Organize Imports does it once, on demand, and tells you when the imports were already tidy. Turn the setting on and it happens on every save instead.

Access: `All Features → Organize imports on save`; `Organize now`; `Turn on or off`; `Settings`.

## Understanding a project

<!-- feature:adcode.structure.projectTreeLines -->
### Draw trees with connecting lines

Little lines join each file to the folder it lives in, like a family tree, so you can see what is inside what.

Why use it: Without them you have to judge nesting by how far a row is pushed across, which means counting pixels.

How to use it: On by default. Turn it off to get plain indentation instead.

Access: `All Features → Draw trees with connecting lines`; `Turn on or off`; `Settings`.

<!-- feature:adcode.structure.missingClasses -->
### Point out classes nothing defines

Tells you when you have used a class name that no stylesheet actually defines.

Why use it: It is almost always a typo, and a mistyped class is completely silent - the element just renders unstyled, usually on a page nobody has open.

How to use it: On by default. Findings appear in the Problems panel beside everything else. View → Find Classes Nothing Defines checks the markup or component file you have open right now, and says so when every class is accounted for.

Access: `All Features → Point out classes nothing defines`; `Find them`; `Turn on or off`; `Settings`.

<!-- feature:adcode.structure.unusedSelectors -->
### Point out rules that style nothing

Tells you when a style rule does not match anything in your project any more.

Why use it: A rule left behind by a deleted component is invisible, and stylesheets only ever grow.

How to use it: Off by default, deliberately. View → Find Unused CSS Rules runs it on the stylesheet you have open whatever the setting says, and answers "every rule matches something" when nothing is unused. It compares names, so it cannot see a class built at runtime or one generated by a CSS module - on projects that use those it is wrong more often than right. Turn the setting on and the findings appear as you work.

Access: `All Features → Point out rules that style nothing`; `Find them`; `Turn on or off`; `Settings`.

<!-- feature:adcode.structure.selectorToElements -->
### Show the elements a rule styles

Click a style rule and see the things on the page it actually affects.

Why use it: It turns a class name nobody can trace into a list of elements you can click.

How to use it: On by default. Open the Structure popup with a stylesheet in front of you.

Access: `All Features → Show the elements a rule styles`; `Turn on or off`; `Settings`.

<!-- feature:adcode.structure.elementToRules -->
### Show the rules that style an element

Click something on the page and see every style rule that changes how it looks.

Why use it: A class is written in one file and used in another, and nothing normally connects the two.

How to use it: On by default. Works in HTML, and in React, Vue, Angular and Handlebars templates.

Access: `All Features → Show the rules that style an element`; `Turn on or off`; `Settings`.

## Languages

<!-- feature:adcode.language.customServers -->
### Additional language servers

Tell ADCode how to start the helper program for a language it does not know about yet.

Why use it: This is what replaces having to install an extension for every language. If your language has a language server, you can use it here.

How to use it: One per line, written as 'language: command'. For example 'zig: zls' or 'elm: elm-language-server --stdio'. It takes effect when you click away from the box.

Access: `All Features → Additional language servers`; `Settings`.

<!-- feature:adcode.language.dapClient -->
### Debug adapter client

Stop your program in the middle of running it, look at what every value actually is, and step through it one line at a time.

Why use it: Adding print statements to work out what a program is doing is guessing with extra steps. A debugger just shows you.

How to use it: On by default for JavaScript, TypeScript, and Python. Click in the margin left of a line number to set a stop point - a red dot - then press F5 to run. When it stops, the panel shows every value in scope; F10 goes to the next line, F11 steps inside a function, and F5 carries on. A language ADCode has no debugger for will say so rather than offering a button that does nothing.

Access: `All Features → Debug adapter client`; `Start debugging`; `Stop debugging`; `Step over`; `Step into`; `Step out`; `Debug console`; `Turn on or off`; `Settings`; `Keyboard → F5`.

<!-- feature:adcode.language.lspClient -->
### Language server intelligence

A helper program that really understands the language you are writing, so ADCode can offer accurate suggestions, spot mistakes, and know where things are defined.

Why use it: Without one, an editor is guessing from the shape of the words. With one, it knows.

How to use it: On by default. It uses language servers already installed on your machine - ADCode does not bundle them. If one is running for the file you are in, you will see richer suggestions and more precise errors.

Access: `All Features → Language server intelligence`; `Turn on or off`; `Settings`.

<!-- feature:adcode.language.treeSitterHighlighting -->
### Tree-sitter highlighting

Colours the code by properly reading it, rather than by pattern-matching the words - so the colours are right even in tricky code.

Why use it: Simple colouring gets confused by things like a keyword inside a string, or nested templates. Real parsing does not get confused.

How to use it: On by default. It loads the grammar for a language the first time you open a file in it. If a grammar cannot be loaded, colouring quietly falls back to the simpler method rather than turning off.

Access: `All Features → Tree-sitter highlighting`; `Turn on or off`; `Settings`.

## The assistant

<!-- feature:ai.agentMascots -->
### Agent mascots

Each saved agent has its own little character - a shape and a colour - and its face shows how that agent's work is going.

Why use it: On a busy board you should not have to read to know what needs you. A worried face with a ! stands out from a sleepy one, and a Reviewer never looks like a Tester.

How to use it: Every agent gets a look of its own from the moment it is created; change it in the agent editor by picking one of eight shapes and ten colours. On the board the face follows the work: thinking while it works, alert with a ! when it needs you, proud when its work is ready to review, happy once it has landed, confused when something went wrong, and sleepy while it waits or after it stops. With Reduce motion on, mascots stay still but still change face.

Access: `All Features → Agent mascots`; `Create an agent`.

<!-- feature:adcode.ai.parallelAgents -->
### Agents working at once

How many agents on the Agents board, and Team roles, may work at the same time. The rest wait their turn as Queued.

Why use it: More agents at once finishes a pile of tasks sooner, but spends your key faster and is likelier to run into a provider's rate limit. Three is quick without being greedy.

How to use it: Settings > AI > Agents working at once: pick 1 to 6. A run that is waiting shows Queued on its box and starts on its own, oldest first, as soon as another agent finishes or is stopped. Raising the number starts queued runs straight away. It counts agents in this window; the main chat is never queued.

Access: `All Features → Agents working at once`; `Settings`.

<!-- feature:adcode.ai.chatWidget -->
### AI chat workspace

A conversation workspace with searchable history, a live working block per answer, copyable code blocks, per-response actions, a jump-to-latest pill, and an interrupted banner with Edit prompt and Try again.

Why use it: Asking in the editor beats copying code into a browser, because the assistant can already see the project. A playful mascot, a scroll pill that respects your place, and a clear way back from an interrupted turn keep long runs feeling alive instead of hung.

How to use it: Open Assistant from the workbench or command palette. Write in the composer and send your request. The answer reads in the order it happened, as in Claude: a block of work, the text it led to, the next block of work, more text. While a block runs it names the current step with elapsed time — the blue mascot with white eyes bounces while working, its eyes follow your pointer, and clicking it pops a morale-boosting quip. Tool calls stream in as bordered rows, each gaining a checkmark when done. When the assistant starts writing again, that block collapses to Worked for Ns; select its header to expand it again. Scroll up and the transcript stays pinned while a Jump to latest pill appears with a count of new messages; select it to return to the tail. Type a follow-up while the assistant is still working and press Enter: it is queued above the composer and sent by itself when the current turn finishes - Send now stops the current turn and sends it at once, and × drops it. The send button, a stop square while a turn runs, still stops it. If you stop a turn, an interrupted banner offers Edit prompt (your last message back in the composer) and Try again. If a turn fails, a card in the conversation says why in plain words - a rate limit, a request too large for the model, a rejected key, a broken tool call, a network problem - with buttons to try again, switch model, start fresh or report it, and the provider’s exact message under Details. A failed turn never breaks the conversation: the next message works as normal. Code arrives in labelled blocks with a Copy button and inline commands read as pills. Every response offers icon actions for Copy, Read aloud, helpful or not helpful, and Retry, with relative time like just now. Use History to browse conversations; Team, schedules and activity opens as a floating panel, and the Agents page shows every agent at work. Share copies the conversation as markdown. Escape closes the workspace without losing the conversation. The assistant changes existing files with exact replacements instead of rewriting them, reads several files at once, and works through up to 50 steps per request, and Keep going until done carries it on past that by itself. Its edits land in your files as it works, and each turn that changed files gets an Undo card. On an empty conversation, starters get going in one click: Continue picks up the conversation this project was left on, then Explain this project, Build something, Fix an error, Plan new idea and Multitask. With no folder open the starters are things to build - a landing page, a snake game, a to-do app, a portfolio - and asking for something to be built makes a project folder for it. In Vibe a short checklist shows anything still missing: connecting your AI (free in about a minute), then describing what to build.

Access: `All Features → AI chat workspace`; `Turn on or off`; `Settings`.

<!-- feature:adcode.ai.editPolicy -->
### AI edit approval

Choose how the assistant's edits reach your files: it applies them as it works and you can undo any turn (the default), or each turn's changes wait for you to apply them.

Why use it: Most of the time you want the result, not a queue of diffs to approve. Applying automatically lets the assistant build, run and fix in one go - the way Cursor's agent does - and one click still takes a whole turn back. Review is there for the times you want to see a change before it lands.

How to use it: Switch at any time from the approval menu in the chat's composer (it reads Auto or Review) or in Settings. Apply automatically is the default: files change as the assistant goes, and when a turn changes files the chat shows them with Undo, which puts every file back as it was before that turn and removes files the turn created. If you edited one of those files afterwards, Undo asks before overwriting your change. Undo covers edits made with the assistant's file tools; what a command it ran did to the disk (an install or a build, say) is not recorded. With Review every change, edits are staged in an isolated copy of the project instead; when the turn ends, one card in the conversation shows everything it changed with Apply all changes, Discard and each file's diff, and nothing reaches your files until you apply. Changes in the sidebar lists anything still waiting.

Access: `All Features → AI edit approval`; `Settings`.

<!-- feature:adcode.ai.isolatedWorkspaces -->
### AI file tools

The assistant reads, edits and runs commands directly in your open project. What it does lands in your real files as it works, and every turn can be undone.

Why use it: Isolation kept edits safe but made simple work feel missing: proposals sat in a sandbox queue instead of reaching the folder. Direct edits deliver real results the moment the turn finishes.

How to use it: On by default. Ask it to build, fix, create or change files and the result is in your project, with the Explorer refreshing to show it. Reads never change anything. Writes are still guarded: unsaved files pause file edits until you save, so nothing you have not saved gets overwritten, and destructive shell commands stay blocked — run those yourself in the terminal. Chats belong to the open folder only: the chat banner names the folder with its task and chat counts, and Switch opens the folder popup. Turning this off keeps chat available but disables the built-in file tools. Beyond reading, listing, and searching files, the assistant can find files by pattern (for example every image), outline a file's symbols before reading it, delete and move files with Undo, run tests, typechecks and dev servers in the project, look at the running app in its own browser, and fetch documentation pages.

Access: `All Features → AI file tools`; `Turn on or off`; `Settings`.

<!-- feature:ai.team -->
### AI Team

Create named agents with their own instructions and models, then let a team divide a task and bring its results back for review.

Why use it: Independent research, coding, and checking can finish faster without making one assistant carry every detail in the same context.

How to use it: Open Agents from the Vibe sidebar or the command palette. Create agents under Your agents with a name, look, instructions, connection, model and the tools they may use. Enable Run after teammates for an agent that should receive others' handoffs first. Choose Select for a Team, tick two to four agents, press Set up Team and describe the shared task. The Team appears as one box under Needs you with its members' mascots; press Start to begin. Select the box to see each step it took. Review combined changes before applying them, or Stop a running team. Requests share each connection's rate limit, and Teams count towards Agents working at once. The assistant can also suggest a Team for a big request in the chat.

Access: `All Features → AI Team`; `Set up Team`; `Settings`.

<!-- feature:ai.workspaceStorage -->
### AI workspace storage

Limits how much disk space task copies use and how long finished sandboxes and rollback checkpoints stay.

Why use it: Project copies can be large, but deleting the only safe way back is worse than filling a quota. ADCode treats active work and rollback checkpoints differently for that reason.

How to use it: Terminal sandboxes are cleaned oldest first. An applied task may lose its sandbox when space is tight, but its only rollback checkpoint is kept. If active work leaves no safe room, ADCode refuses the new task and tells you to raise the quota or discard one.

Access: `All Features → AI workspace storage`; `Settings`.

<!-- feature:ai.sessions -->
### Chat history and memory

Every conversation is kept in Today, Yesterday, and older groups, so you can go back to one. A strip at the top shows exactly what the assistant is remembering right now, and a button clears it.

Why use it: Assistants that forget everything are frustrating, and assistants that remember invisibly are worse. Showing what is remembered makes clearing it something you can actually see work.

How to use it: Press Ctrl+Shift+N or choose New conversation to start fresh; the current one is kept. In Vibe, past conversations are listed in the sidebar, grouped into Today, Yesterday and older; in the IDE the assistant is a floating window over the editor (Ctrl+I shows or hides it) - choose History from the conversation's actions menu. Search them by title or by anything said in them, rename them, or delete one. The header shows the current conversation name and Share copies it as markdown. Conversations are stored on your own machine, per project, and are never uploaded.

Access: `All Features → Chat history and memory`; `Open Assistant`; `New conversation`.

<!-- feature:ai.connect -->
### Connect a model

Connect an AI provider in three steps - choose a provider, check and save its key, pick a model - or save several named API connections with a requests-per-minute limit, including NVIDIA NIM.

Why use it: A key that was pasted wrong should say so immediately, not silently fail the first time you ask a question.

How to use it: Open Connect a model. While nothing is connected, the top of the screen offers the fastest ways in - a free Google Gemini key, a model already running in Ollama, or any key you paste - and the full list is underneath. Otherwise follow the three steps at the top. Choose a provider or add a named connection with an OpenAI-compatible base URL and exact model ID. The NVIDIA NIM preset fills its hosted endpoint. Set requests per minute, save the connection, then check and save its API key. Select the connection for chat or an agent. Chat, completion, and team requests share its queue. Server cooldowns are respected; token or account quotas can still cause rate-limit errors. Keys remain encrypted by the operating system.

Access: `All Features → Connect a model`; `Connect`; `Settings`.

<!-- feature:adcode.ai.autoContinue -->
### Continue terminal AI after limits

A detected terminal assistant can receive a literal “continue” after it says a usage or rate limit has reset.

Why use it: Long-running terminal tasks should not need you to watch the clock and return only to type one word.

How to use it: Off by default. When enabled, ADCode reads only the terminal output already visible in its own terminal. A clear usage-limit message with an explicit retry delay schedules one continuation. Unknown reset times and changed or ambiguous terminal state stop safely. A repeated limit may schedule the next attempt up to your retry cap. Closing ADCode or turning this setting off cancels every pending continuation.

Access: `All Features → Continue terminal AI after limits`; `Turn continuation on or off`; `Turn on or off`; `Settings`.

<!-- feature:adcode.ai.customBaseUrl -->
### Custom endpoint

Point ADCode at any AI service by pasting its address - including one running on your own computer.

Why use it: Most services speak the same format, so one address is all it takes to use a gateway, a cheaper host, or a model you run yourself.

How to use it: Set Provider to Custom, paste the address, and give it your key. The Connect screen checks it works before saving.

Access: `All Features → Custom endpoint`; `Settings`.

<!-- feature:ai.inlineEdit -->
### Edit with AI

Select code, press Ctrl+E and say what to change. The rewrite appears in place, highlighted green under the struck-out original, for you to accept or reject.

Why use it: Small changes should not need a conversation. Adding error handling, renaming across a function or converting a loop happens where you are looking, and nothing reaches disk until you save.

How to use it: In Code mode, select the lines to change - or put the cursor where new code should go - and press Ctrl+E, or right-click and choose ADCode: Edit with AI. Type an instruction such as "add input validation" and press Enter. The new code appears highlighted green with the lines it replaced shown struck through above it. Press Ctrl+Enter or Accept to keep it, Esc or Reject to put the original back, or type a follow-up to refine the result. An accepted edit is an ordinary unsaved change: Ctrl+Z undoes it, and it is saved only when you save. It uses the model chosen in Connect a model and sends only the selection and the code around it.

Access: `All Features → Edit with AI`; `Edit with AI`; `Keyboard → Ctrl+E`.

<!-- feature:ai.freeKey -->
### Free AI in a minute

Get the assistant working for free: a free Google Gemini key, a model already on your computer, or a key you already have.

Why use it: You should not need a credit card, or to know what an API key is, to see what ADCode can build. Google gives anyone with a Google account a free Gemini key, and this gets it connected without copying settings around.

How to use it: Choose Connect your AI - free in the Vibe checklist, run Get a Free AI Key from the command palette, or just send a message - with no model connected, the reply offers the same choices. Press Get my free key: Google AI Studio opens in your browser. Sign in, click Create API key, and copy it. Come back to ADCode and the copied key is picked up and checked on its own; you can also paste it. If Ollama is running on this computer, Use it connects a local model instead, and nothing leaves your machine. Already have a key from OpenAI, Anthropic, OpenRouter, Groq, xAI, DeepSeek or Cerebras? Paste it under I already have a key and ADCode works out which service it belongs to. Nothing is saved until the model has answered a test message. Google's free tier may use what you send to improve its products, so use a paid key for private or work code.

Access: `All Features → Free AI in a minute`; `Get a free key`.

<!-- feature:adcode.ai.inlineCompletion -->
### Inline completion

Grey text appears ahead of your cursor guessing the rest of what you are writing. Press Tab to take it.

Why use it: For the lines that are boring and predictable, which is more of them than anybody likes to admit.

How to use it: Off by default. Turn it on and ADCode asks the selected model after you pause, without delaying a keystroke, and cancels the request as soon as the buffer changes. Press Tab to accept grey ghost text, keep typing to ignore it, or press Alt+\ to request a suggestion yourself. Local keyword and language-server suggestions continue to work separately.

Access: `All Features → Inline completion`; `Suggest now`; `Turn on or off`; `Settings`; `Keyboard → Alt+\`.

<!-- feature:adcode.ai.keepGoing -->
### Keep going until done

When the assistant stops at its step limit in the middle of a long job, it carries on by itself instead of waiting for you to say Continue.

Why use it: Long builds - a whole site, a refactor across many files - can need more than one turn's worth of steps. With this on, you can hand over a big job and come back to it finished.

How to use it: On by default. Turn it off from the approval menu in the chat's composer or in Settings. When a turn ends at the step limit, ADCode sends Continue for you, up to five times in a row, and says so in the conversation each time. Sending your own message or pressing Stop resets the count. With it off, the assistant stops at its step limit and a Continue button picks up where it left off. Together with Apply automatically, and Automations to schedule the job, work runs start to finish without you.

Access: `All Features → Keep going until done`; `Turn on or off`; `Settings`.

<!-- feature:ai.autoCompact -->
### Long chat memory and auto-compact

Chats remember: reopen one tomorrow, restart ADCode or switch model, and the assistant carries on where you left off. When a chat gets long, ADCode summarises the older part so it never runs out of room.

Why use it: Every model can only read so much at once. Without this, a long chat eventually fails, and a reopened one starts from nothing - so you explain your project again. Compaction keeps the goals, decisions, files and your preferences, and keeps the newest turns word for word.

How to use it: On by default. The meter beside the chat's composer shows how full the model's context is (Context 34%, say); hover it for the numbers and when it compacts. At 80% - or 70% or 90%, in Settings - ADCode asks the same model to summarise the older part and the chat shows Earlier conversation compacted with View summary. Compact whenever you like with /compact, or /compact keep the API decisions to say what matters most, or Compact now from the meter or the command palette. Long Agents-board runs compact the same way instead of stopping at the limit. The summary is saved with the conversation, so reopening it from Conversations picks up from the summary and the messages after it.

Access: `All Features → Long chat memory and auto-compact`; `Compact now`; `View summary`; `Turn on or off`; `Settings`.

<!-- feature:adcode.ai.mcpServer -->
### MCP server

Lets AI tools outside ADCode - Claude Code, Codex, and others - read and write the same project notes.

Why use it: One set of notes shared by every assistant you use, rather than each one starting from nothing.

How to use it: On by default, but it needs Node.js 22.13 or newer installed: your agent starts the server with the Node.js on your computer, not with ADCode. Run node --version in a terminal to check, and install the current LTS from nodejs.org if it is missing or older. Then open Tools and choose Memory: Share with your other AI tools shows the exact command, with a Copy button (Settings shows it too). Run it once, from your project folder. Without Node.js the command is still accepted, but the server fails to start inside your agent.

Access: `All Features → MCP server`; `Turn on or off`; `Settings`.

<!-- feature:adcode.ai.memoryCapture -->
### Memory capture

The assistant writes down decisions and conventions about your project, so it does not need telling twice.

Why use it: Explaining the same thing at the start of every conversation is the main reason AI assistants feel forgetful.

How to use it: On by default. Memories are plain markdown files in your project folder. Open Tools and choose Memory to read them grouped by kind, correct or delete one, or add your own; they are also ordinary files you can edit anywhere.

Access: `All Features → Memory capture`; `Turn on or off`; `Settings`.

<!-- feature:adcode.ai.model -->
### Model

Which particular AI, from that company, answers you.

Why use it: Bigger models are cleverer and slower; smaller ones are quick and cheap. Most people want a big one for hard questions and a small one for everything else.

How to use it: Pick from the list, which shows only models that can work as your assistant - ones that write text and use tools - newest first. Each says what it reads at once and what it costs per million tokens, and is tagged Recommended (the one Use this model picks), New, Free or Free tier where that is true. To switch quickly, click the model chip beside the send button: it lists the model in use, each connected provider's recommended model and the ones you used recently, with More models and providers for the full list. Switching takes effect on your next message - it does not restart the conversation. Thinking effort sets how hard reasoning models think: Auto lets the provider decide, higher efforts answer harder questions better and cost more; each model is sent the nearest level it actually has. A long reply that reaches the model's output limit carries on by itself with more room.

Access: `All Features → Model`; `Settings`.

<!-- feature:ai.memoryEditor -->
### Project memory

Read, correct and add to what the assistant has learned about your project - decisions, conventions and preferences - all in one place.

Why use it: Memory you cannot see is memory you cannot trust. When a note is wrong, fixing it once stops every assistant and agent repeating the mistake.

How to use it: Open Tools and choose Memory, or Tools: Project Memory in the command palette. Notes are grouped into Decisions, Conventions, Preferences and Session notes, each showing who wrote it and when. Edit changes a note, Delete forgets it, and Add memory writes one yourself - give it a short name, a one-line summary and the detail. Changes are searchable by the assistant straight away. Share with your other AI tools gives the command that lets Claude Code, Cursor and others use this same memory.

Access: `All Features → Project memory`; `Open project memory`.

<!-- feature:adcode.ai.provider -->
### Provider

Which company's AI you want to use. You bring your own account and key.

Why use it: Different models are better at different things, and cost different amounts. ADCode does not resell anybody's AI, so the choice - and the bill - is yours.

How to use it: Open Connect a model, pick a provider, and paste your key. ADCode checks the key works before saving it. Keys are kept in your operating system's own password store, never in a settings file. The local option, Ollama, needs no key at all - it talks to a model running on your own machine, and its row says what is true right now: Running with how many models, Installed but not running (with Start Ollama), or Not installed (with Download Ollama).

Access: `All Features → Provider`; `Settings`.

<!-- feature:ai.raceMode -->
### Race mode

Give the same task to two or three agents at once - different models if you like - then compare their work side by side and keep the best.

Why use it: One model is often almost right. Trying a few and choosing costs a little more and saves the back-and-forth of fixing an almost-right answer.

How to use it: On the Agents page press New task (or run Agents: Race Several Agents on One Task), describe the task, turn on Race and tick two or three agents. Each works in its own copy; its box shows Race 1 of 3 and so on. A race is never applied on its own. When every lane has finished, press Compare on any of them: each lane shows its agent, model, cost, proof of work and what it said. Keep this one applies that lane to your project and discards the others.

Access: `All Features → Race mode`; `Start a race`.

<!-- feature:adcode.ai.scheduledMessages -->
### Scheduled AI messages

Write a prompt now and ask a supported AI target to receive it later while ADCode is open.

Why use it: A reminder that can actually reach the assistant is useful for follow-up reviews, delayed provider windows, and work you want to queue without leaving an agent running.

How to use it: Choose Schedule beside the chat composer, choose where to send the message and set a local time, then confirm. Built-in chat is always available. For a detected terminal AI, first choose Allow next schedule while its prompt is visibly waiting; later terminal activity removes that one-time permission. If ADCode, the project, or scheduled messages are unavailable at delivery time, the message is marked missed and waits for you to choose Run now.

Access: `All Features → Scheduled AI messages`; `Schedule`; `Turn on or off`; `Settings`.

<!-- feature:ai.composerCommands -->
### Slash commands and @ files

Type / in the assistant's composer for ready-made commands like /review and /test, or @ to put any project file in the conversation.

Why use it: Typing is faster than hunting for a button, and each command asks the way an experienced engineer would - including checking its own work - so answers come back verified rather than guessed.

How to use it: Type / at the start of the composer to list every command; keep typing to filter, then press Enter or Tab. /review and /commit attach your uncommitted changes and ask for a review or a commit message. /check asks the assistant to look at your running app in its own browser and fix what is broken. /fix, /test, /plan, /refactor, /explain, /optimize, /security, /docs and /build write a careful prompt that you finish in your own words. /new, /history, /model, /preview, /team and /schedule act at once. Type @ anywhere to search the project's files and add one as a chip; a file open in the editor sends its unsaved text. In an empty composer, the Up arrow brings back your earlier prompts.

Access: `All Features → Slash commands and @ files`; `Show commands`; `Add a file`.

<!-- feature:adcode.ai.taskTokenBudget -->
### Task token budget

Optionally sets a hard ceiling for one assistant task, checked before each new request can spend your key.

Why use it: Long tool loops and repeated context can cost far more than the first question suggests. Checking the whole request before it starts is safer than warning after the tokens are gone.

How to use it: Paused while the assistant edits directly: with no isolated tasks created, there is nothing to cap, so these rows are disabled. Unlimited stays the default. When caps return, choose 25k, 100k, or 250k, or type any number from 1000 to 10000000 into Custom token budget.

Access: `All Features → Task token budget`; `Settings`.

<!-- feature:ai.terminalTeam -->
### Team in the terminal

Split one task across several agent CLIs - Claude Code, Codex, Grok, Kimi and the rest - each working in its own terminal pane.

Why use it: You already pay for more than one of these, and they are good at different things. Running them one after another wastes the ones that are idle; running them by hand means writing the same briefing four times and watching four panes to see who has finished.

How to use it: Right-click a terminal and choose Start a Team here, or run Set Up AI Team. Describe the task, then pick which CLI takes which role. ADCode opens a pane per role, starts that CLI, and briefs it with its own piece, the acceptance criteria, and what its teammates have already finished. A task only starts once everything it depends on has reported done. Each agent is asked to print one line when it finishes; an agent that goes quiet for five minutes is treated as finished instead. Nothing is sandboxed - these are your CLIs editing your working tree, which is why you confirm the plan first. Closing a pane fails just that task and leaves the others running.

Access: `All Features → Team in the terminal`; `Start a Team in the terminal`.

<!-- feature:adcode.ai.terminalAgentDetection -->
### Terminal agent detection

If you start an AI tool in ADCode's terminal, ADCode notices and offers to share what it knows about the project with it.

Why use it: So the assistant in your terminal and the one in your editor are working from the same notes instead of two different ideas of the project.

How to use it: On by default. When an agent is recognised, a strip appears above the terminal with the one command that connects it. Nothing is shared unless you press it.

Access: `All Features → Terminal agent detection`; `Turn on or off`; `Settings`.

<!-- feature:ai.seesYourApp -->
### The assistant sees your app

The assistant opens the web app you are building in a browser of its own, looks at any page, clicks and types through it like a visitor, and fixes what it finds.

Why use it: An assistant that only reads code has to guess whether a page works. Looking at it - the words on screen, the errors in the console, the requests that failed, a screenshot - turns "it should work" into "I checked, and it works", and it catches the broken image or the button that does nothing before you do.

How to use it: Ask in plain words: "check the contact form sends", "look at the pricing page on a phone", "open the about page". Or type /check in the assistant's composer, or run AI: Check My Running App from the command palette, and it looks at the app at desktop and phone width, clicks through the main links and buttons, and fixes what is broken. It starts the live preview by itself when it is not running - a framework's dev server or a plain file server - and waits for its address. The latest screenshot it took appears in the conversation under What the assistant saw, with how many problems it found; click it to open that page in the preview. When it opens a page for you, the preview card in the chat and an open preview window go to that page. Its browser opens only addresses on this computer, forgets everything when it closes, and closes itself after a few idle minutes. A model that cannot read images gets the same report as text.

Access: `All Features → The assistant sees your app`; `Check my running app`.

<!-- feature:ai.agentTools -->
### What the assistant can do

Besides reading and changing code, the assistant can delete, move and rename files, keep a dev server running, wait out long installs and builds, and show its plan as a checklist.

Why use it: When it cannot do a job with a proper tool, an assistant improvises with shell commands no Undo can reverse, gives up on anything slower than half a minute, or tells you to run the server yourself. With the right tools it just does the job, and you can put it back.

How to use it: Nothing to set up - ask for what you want. Deleted, moved and renamed files are part of the turn's Undo: the Changed files card under the answer lists them, deletions struck through, and Undo puts every one back, images included. A dev server or watcher runs in the background while the assistant keeps working, reads what it prints and looks at the address it serves; it stops when you close the folder or quit. Commands may run for up to ten minutes and report their real exit code, and Stop ends a command and everything it started. For a bigger job the assistant keeps a Plan card in the conversation, ticking steps off as it goes. Its search shows the lines around each match and finds code as plain text, edits survive a mismatch in indentation, it can look at images in your project, and web pages it reads for documentation come back as clean text. Every tool is listed in plain words on the Tools page under Built-in - run Tools: The Assistant's Built-in Tools. Deleting and moving work when AI edits apply automatically; in review mode the assistant says what to move instead.

Access: `All Features → What the assistant can do`; `Show the built-in tools`.

## Git

<!-- feature:adcode.git.blame -->
### Blame

Shows who last changed each line, and which save it came from.

Why use it: The name is unfriendly and the feature is not: it is how you find the person or the note that explains why a line is the way it is.

How to use it: Off by default. Git → Blame This Line names the author, the commit and its message for the line the cursor is on, and says so plainly when the line is not committed yet. Turn the setting on and every line gets a faint note instead; click one to open the full description of that change.

Access: `All Features → Blame`; `Blame this line`; `Turn on or off`; `Settings`.

<!-- feature:adcode.git.branchSwitcher -->
### Branch switcher

Work on a separate copy of the project, so you can try something without disturbing the version that works.

Why use it: It is the safe way to attempt anything risky. If it goes badly you throw the copy away and nothing else was touched.

How to use it: On by default. The current branch name is at the bottom-left of the window; click it to switch to another or to start a new one. Git → Checkout Branch and Git → Create Branch do the same from the menu.

Access: `All Features → Branch switcher`; `Switch branch`; `Create a branch`; `Turn on or off`; `Settings`.

<!-- feature:adcode.git.fileTimeline -->
### File timeline

Every past version of the file you are looking at, newest first, in a list you can open.

Why use it: It answers 'when did this break' and 'what did this look like last week' without leaving the editor.

How to use it: On by default. Git → File Timeline lists every commit that touched the file you are looking at, and says when none has yet. The Source Control panel shows the same list under Timeline; click any entry to see that version, and what changed in it.

Access: `All Features → File timeline`; `Show the timeline`; `Turn on or off`; `Settings`.

<!-- feature:adcode.git.gutterDiff -->
### Gutter diff decorations

Little coloured marks in the left margin show which lines you have changed since you last saved them into your project's history.

Why use it: It answers 'what have I actually touched here' without opening anything or comparing anything.

How to use it: On by default. Green means you added the line, amber means you changed it, and a small triangle means you deleted something there. Click a mark to see what was there before, and to undo just that change.

Access: `All Features → Gutter diff decorations`; `Turn on or off`; `Settings`.

<!-- feature:adcode.git.mergeConflict -->
### Merge conflict resolution

When two people changed the same line, this shows you both versions side by side and lets you pick.

Why use it: A conflict is the one moment source control cannot decide for you, and the raw markers it leaves in the file are genuinely hard to read.

How to use it: On by default. Press Check Conflicts in the Source Control panel, or Git → Check Merge Conflicts, to list every file where both sides changed the same lines - it answers "No merge conflicts" when there are none, so you never have to guess. Open one of those files and each conflict gets Keep yours, Keep theirs, and Keep both above it; you can also edit the result by hand. Save the file to keep what you chose.

Access: `All Features → Merge conflict resolution`; `Check for conflicts`; `Turn on or off`; `Settings`.

<!-- feature:adcode.git.stageCommitUi -->
### Stage, unstage, and commit

Pick which of your changes to keep as a set, write a note about them, and save that set into your project's history.

Why use it: This is the point of source control: your work gets saved in labelled steps you can go back to, rather than as one big pile of edits.

How to use it: On by default. Open the Source Control panel in the activity bar. Tick the changes you want in this set - that is 'staging' - write a short note saying what you did, and press Commit. The Changes panel (Changes in the Vibe sidebar) shows the same work Cursor-style: an uncommitted +added −removed total, one row per file with its count, a revert arrow and an include checkbox, the diff one click away, and Commit & Push, which commits and pushes in one go and writes the message if you leave it empty.

Access: `All Features → Stage, unstage, and commit`; `Commit`; `Stage all`; `Unstage all`; `Push`; `Pull`; `Fetch`; `Initialise a repository`; `Clone a repository`; `Open Source Control`; `Turn on or off`; `Settings`.

<!-- feature:adcode.git.identity -->
### Your name and email for commits

The name and email git writes on every commit you make, set in a small form instead of a terminal.

Why use it: Git refuses to commit until it knows who you are, and its own fix is two commands typed exactly right. A slip such as user.mail instead of user.email leaves git with no email even though you set one, and other tools hide that by supplying their own.

How to use it: Commit as usual. If git does not know who you are, Commit and Commit & Push open a form with your name and an email filled in from your git settings and your earlier commits; pick one, keep Use for all my projects ticked, and press Save and continue - the commit goes ahead. To change it any time, run Git: Set Your Name and Email from the command palette. It is saved in git's own settings, so VS Code and the terminal use the same name.

Access: `All Features → Your name and email for commits`; `Set name and email`.

## Your session

<!-- feature:adcode.session.autoSave -->
### Auto-save after delay

Stop typing for a moment and your file saves itself.

Why use it: So losing work stops being possible, and so you stop pressing Ctrl+S out of habit every few seconds.

How to use it: Off by default. Turn it on and it waits until you pause, so it never saves a half-typed word. You can still save whenever you like with Ctrl+S.

Access: `All Features → Auto-save after delay`; `Turn on or off`; `Settings`; `Keyboard → Ctrl/Cmd+S`.

<!-- feature:adcode.session.crashRecovery -->
### Crash recovery

If ADCode closes unexpectedly, your unsaved typing is still there when it opens again.

Why use it: Crashes and power cuts happen, and losing an hour to one is miserable.

How to use it: On by default, and there is usually nothing to do: reopen ADCode and it offers your unsaved work back. File → Recover Unsaved Files asks again at any time, and answers "nothing to recover" when every file is already saved.

Access: `All Features → Crash recovery`; `Recover unsaved files`; `Turn on or off`; `Settings`.

<!-- feature:adcode.session.localFileHistory -->
### Local file history

ADCode quietly keeps its own copies of files as you edit them, separate from your project's history.

Why use it: For the moment you delete something you needed and had not saved into your project's history yet. It is the undo that survives closing the file.

How to use it: On by default. File → Local History lists every copy ADCode has kept of the file you are looking at, newest first, and tells you when there are none yet. Choose one and it opens read-only beside your working copy, so you can copy what you need back without overwriting anything.

Access: `All Features → Local file history`; `Open local history`; `Turn on or off`; `Settings`.

<!-- feature:adcode.session.workspaceRestore -->
### Restore workspace

Open ADCode again and everything is how you left it - the same folder, the same tabs.

Why use it: Setting your work back up every morning is a small tax you should not have to pay.

How to use it: On by default. Just close the window; next time you open it, your files are back.

Access: `All Features → Restore workspace`; `Turn on or off`; `Settings`.

## The workbench

<!-- feature:workbench.agentsBoard -->
### Agents board

Hand tasks to AI agents that work at the same time, each in its own copy of your project, and follow them as boxes in Working, Needs you and Ready.

Why use it: One assistant doing one thing at a time keeps you waiting. Several agents can fix a bug, write tests and polish a page at once while you keep chatting, and each box shows at a glance which one is busy, which one needs you and which one is done - no scrolling back through a transcript to find out.

How to use it: Choose Agents in the Vibe sidebar, or Open Agents from the command palette (in the IDE window it opens as a large popup). Press New task, describe what you want, pick an agent - or keep the default, your connected model with every tool - and optionally a cost cap, then press Enter. The task appears as a box under Working with its agent's mascot, what it is doing right now (such as Editing src/app.ts), how long it has run, the files it touched, its tokens and - when the model's price is known - its cost. Start as many as you like: the number working at once follows Agents working at once in Settings, and the rest wait as Queued. Each agent works in an isolated copy, so nothing reaches your project until it finishes. With Apply automatically on, finished work lands straight away and its box offers Undo and Continue; with Review every change it waits under Ready with Review, Apply, Apply & continue and Discard. Needs you collects anything that cannot go on without you: a clash with your own edits (Resolve), an error (Run again, or Open in chat to talk it through), a spent cost cap (Run with a higher cap) and runs paused when ADCode closed (Resume). Every finished box shows its proof of work: the tests, type checks and linters the agent actually ran, with a tick or a cross, and warnings about its change - a possible secret, sign-in or payment code, removed tests, new dependencies or a very large change. With Apply automatically on, a run with a failed check or a possible secret is held under Ready for you to look at instead of applied. If an agent keeps trying the same failing thing, ADCode stops it and the box offers Try another way. When two agents edit the same file, both boxes warn you before their work collides. A cost cap set on a task, or a usual cap saved on the agent, shows as spend against the cap, and the header shows your ad earnings beside today's agent spend. Select a box to see what it reported, the files it changed, its proof of work and every step it took. Today's finished runs fold under Finished today. Your agents lists saved specialists - Run gives one a task, Edit changes its name, look, instructions, model and the tools it may use, Duplicate copies it, and New agent adds one. Five starter agents are added the first time. Select for a Team picks two to four agents to split one task; press Start on its box to begin.

Access: `All Features → Agents board`; `Open Agents`; `New task`.

<!-- feature:workbench.allFeatures -->
### All Features

A searchable library of everything ADCode can do, with an Open button and a plain explanation beside every feature.

Why use it: You should not need to know a command's name, shortcut, or menu before you can discover it.

How to use it: Choose the four-cell All Features button below Earnings, or open View and choose All Features. Search by a feature name or describe what you want to do. Choose Open to use it and ? to understand it.

Access: `All Features → All Features`; `Open`; `Preferences`; `Full screen`; `Toggle side bar`; `Toggle panel`; `Zoom in`; `Zoom out`; `Reset zoom`; `Problems`; `Output`; `Ports`; `Feature guide`; `About ADCode`.

<!-- feature:workbench.aiContext -->
### Ask AI about your code

The assistant already sees the file you are on, your cursor, your selection and the editor's errors. Ctrl+L adds a selection to the conversation as a chip.

Why use it: "Fix this" and "what does this function do" should just work. Ask about unsaved code, prepare a refactor, find issues or write tests without copying between tools.

How to use it: Nothing to switch on: every message carries the file you are looking at, the cursor line, any selected code, your open tabs and the errors and warnings the editor reports, so the assistant knows what "this" means. Select code and press Ctrl+L, or right-click and choose ADCode: Add Selection to Chat, to put it in the composer as a chip without sending - then ask your question. With nothing selected, Ctrl+L still selects the line as usual. Right-click for Explain, Refactor, Write Tests and Find Issues, which prepare instructions you edit before sending. In Vibe mode the editor is hidden, so only file names and errors are shared, never a stale selection.

Access: `All Features → Ask AI about your code`; `Add to chat`; `Ask AI`; `Explain`; `Refactor`; `Write tests`; `Find issues`; `Keyboard → Ctrl+L`.

<!-- feature:workbench.terminal -->
### Built-in terminal

A command line inside ADCode, already pointed at your project folder.

Why use it: Most work needs both an editor and a terminal, and switching windows between them adds up.

How to use it: Open it from the panel at the bottom. You can have several at once, and each remembers what it was doing.

Access: `All Features → Built-in terminal`; `Open`; `New terminal`; `New terminal with profile`; `Split`; `Next terminal`; `Previous terminal`; `Copy`; `Paste`; `Clear`; `Kill`; `Kill all`; `Run this file in the terminal`.

<!-- feature:workbench.changes -->
### Changes panel

Every file that changed since your last commit - what the assistant did and what you did - with its line counts, its diff one click away, and one button to commit and push it all.

Why use it: When the assistant edits as it works, this is where you see what it touched and save the result. It reads like Cursor's changes view, but you never have to learn staging: every file is included until you untick it, and if you leave the commit message empty ADCode writes one from the files.

How to use it: Choose Changes in the Vibe sidebar, or Show Workspace Changes in the command palette; it opens as a floating window you can move, resize and maximise. The bar at the top shows the uncommitted +added −removed total, the branch and Commit & Push; the line under it always says which files the next commit takes. Each row is a file with its line counts, a New or Deleted tag, a revert arrow and a checkbox. Select a file to see its diff - a new file shows its whole contents. Untick a file to leave it out of the next commit; while every box is ticked, Commit & Push takes every file. Commit & Push commits and pushes in one step, with a message such as Update css/app.css and 2 more files when you have not written one; the arrow beside it offers Commit only and Write the commit message. A project not yet connected to GitHub is committed on this computer, and the panel says how to connect it. The revert arrow asks first, then puts an edited file back as it was at the last commit, or moves a new file to the Recycle Bin. The branch button switches branch; the ⋯ button holds Include everything, Pull, Push, Revert all changes and Source Control. In a folder without Git, Turn on version control starts tracking it. On a drive that does not record who owns files (FAT32 or exFAT, most USB sticks), Git refuses a repository until the folder is trusted: one ADCode just created is trusted for you, and for any other the panel says Git needs your OK and offers Trust this folder - trust only folders you made or got from someone you trust, because a repository can run its own scripts. Work from Review mode or an AI Team that is waiting to be applied appears at the top of the panel.

Access: `All Features → Changes panel`; `Open Changes`.

<!-- feature:workbench.commandPalette -->
### Command palette

One box that can run anything ADCode does. Type what you want rather than hunting a menu.

Why use it: There are hundreds of commands and no menu can hold them all. If you can name it, you can run it.

How to use it: Press Ctrl+Shift+P and start typing. The shortcut for each command is shown beside it, so it teaches you the keys as you use it.

Access: `All Features → Command palette`; `Open`; `Keyboard → Ctrl/Cmd+Shift+P`.

<!-- feature:workbench.floatingPanels -->
### Floating panels

Changes, Preview, the project overview, Team activity and the IDE's assistant open as windows floating over your work instead of sidebars.

Why use it: A sidebar takes a column from the editor or the conversation for as long as it is open. A floating panel sits over the work only while you need it, goes where you put it, and gives the full width back the moment it closes.

How to use it: Open a panel as usual - Changes or Preview in the Vibe sidebar, Project overview from the project card, Ctrl+I for the assistant in the IDE. Drag it by its title bar, resize it from any edge or corner, and double-click the title bar or press Maximise to fill the window; press it again to restore. Escape or the close button hides it. Each panel remembers where you left it, and if the window shrinks it is pulled back so its title bar can always be reached. Several can be open at once; clicking one brings it to the front. On a narrow window panels open full-size instead.

Access: `All Features → Floating panels`; `Reset panel positions`.

<!-- feature:workbench.imagePreview -->
### Image preview

Click an image file and it shows as a picture instead of text.

Why use it: Opening a PNG as text shows garbage characters. A picture is what you actually want to check.

How to use it: Click any png, jpg, gif, webp, svg, ico, or bmp file in the Explorer. It previews in the editor area with its file size and dimensions. Images cannot be edited here - they are preview-only. Use File > Open Image Preview or the command palette to pick one directly.

Access: `All Features → Image preview`; `Open image preview`.

<!-- feature:workbench.keybindings -->
### Keyboard shortcuts

Every shortcut can be changed to whatever keys you prefer.

Why use it: Keeping the shortcuts you already know makes changing editors much easier.

How to use it: Help, then Keyboard Shortcuts. Search for a command, click its keys, and press the combination you want. Conflicts are pointed out rather than silently taking over.

Access: `All Features → Keyboard shortcuts`; `Open`.

<!-- feature:workbench.collab -->
### Live collaboration

Someone else can open the same files at the same time and you both see each other typing.

Why use it: For fixing something together without one of you reading the other's screen over a call.

How to use it: Start a session and share the invitation. It works over your local network - the code does not travel through anybody else's server.

Access: `All Features → Live collaboration`; `Open`; `Leave session`.

<!-- feature:workbench.preview -->
### Live preview

See a web page you are building in a floating window over your code, updating as you type.

Why use it: Saving, switching to a browser, and refreshing is three steps too many when you are adjusting a layout.

How to use it: Open a HTML file and start the preview. It reloads itself when you save. To see another page, click the address in the preview's bar, type its path - /about.html, or #pricing - and press Enter; the address follows the links you click. The preview floats over your work: drag it by its bar, resize it from any edge, and double-click the bar or press Maximise to fill the window. Open device sizes for one-click Phone, Tablet, or Desktop, labelled W and H boxes with minus and plus steppers, or drag the frame's visible edges — the page reshapes in place without reloading, and Fit scales it down so you never scroll to see it. Turn on Inspect, then right-click anything in the preview to see its width, height, padding, margin, and markup; if it grabs an inner piece instead of the card you meant, walk up the breadcrumb to the parent, which flashes in the page as you pick it. Choose List all for every element's spacing at once. To change an element, pick it with Inspect and choose Change this with AI: New task opens with that element already attached, so you only say what should change.

Access: `All Features → Live preview`; `Open`; `Reload`; `Maximise or restore`; `Switch project or files`; `Another screen size`; `Inspect element size and spacing`.

<!-- feature:workbench.newProject -->
### New project from an idea

Describe what you want to build, and ADCode makes a new project folder for it, opens it and starts building.

Why use it: You came with an idea, not a folder. Finding or making an empty folder first is a step between you and seeing the idea work.

How to use it: With no folder open, ask the assistant for something to be built - "build a snake game", "make a landing page for my bakery" - and ADCode makes a folder for it in Documents, ADCode Projects, named after the idea, opens it and sends your request. Or run New Project from an Idea from the command palette, or use the welcome screen's What do you want to build box. A new project is built as plain HTML, CSS and JavaScript unless you name a framework, so it runs in the preview straight away without installing anything. The folder starts with version control turned on, so Changes shows everything the assistant made and any of it can be reverted or committed. Questions asked with no folder open are just answered; no folder is made for them.

Access: `All Features → New project from an idea`; `New project`.

<!-- feature:workbench.openIde -->
### Open IDE in a separate window

Keep the Vibe-first launcher where it is and open the full editor-first IDE beside it, on the same project.

Why use it: Planning and building want different screen shapes. Two windows means the conversation stays visible while the editor, terminal and preview get a whole window of their own.

How to use it: Choose Open IDE at the bottom of the Vibe sidebar, or in the top bar when the window is narrow. ADCode opens one editor-first IDE window and focuses it on later clicks. The Vibe window stays open; use Vibe in the IDE toolbar to return to it.

Access: `All Features → Open IDE in a separate window`; `Open IDE in a separate window`.

<!-- feature:workbench.openSource -->
### Open source licences

ADCode's code is open source. This shows the licence it is shared under, and the licences of the other open-source software built into it.

Why use it: So you can check what you are allowed to do with ADCode - use it, read it, change it, share it - and see exactly which other projects it is built on, without leaving the editor.

How to use it: Choose Help > Open Source Licences. The first tab is ADCode's own licence, the Apache License 2.0. Notice names the copyright holder. Third-party lists every package built into ADCode with its licence text. The source code is at github.com/bluethenics/adcode, where you can read it, report a problem or send a change. The ADCode name and logo are not covered by the licence, so a changed copy has to use its own name.

Access: `All Features → Open source licences`; `Show licences`.

<!-- feature:workbench.debugLog -->
### Report a problem with a debug log

When something goes wrong, ADCode records what failed - the assistant, a window, or the app itself - in a debug log you can send with a report.

Why use it: "The AI stopped working" is hard to fix from a description. The log says which part failed, with the exact error, the version and the model you had selected, so a problem can be fixed from one report instead of a back-and-forth.

How to use it: Choose Help > Report a Problem, describe what happened, and keep Include debug log ticked; select See exactly what is included to read the attached text first. When the assistant fails, the error card's Report problem button opens the same form, already filled in. To send the full log another way, choose Help > Copy Debug Log and paste it, or Help > Save Debug Log to save it as a text file. The log keeps recent errors, which tool failed, and turn timings. It never holds your API keys, prompts, answers, file contents, file paths or project names - those are removed before anything is written - and nothing is sent unless you send it.

Access: `All Features → Report a problem with a debug log`; `Report a problem`; `Copy debug log`; `Save debug log`.

<!-- feature:workbench.run -->
### Run

One button that runs whatever you are working on, working out the right command by itself.

Why use it: Every language and project starts differently, and remembering which is which is pointless work.

How to use it: Press Run. If the tool it needs is not installed, ADCode says which one and where to get it rather than failing with an error you have to decode.

Access: `All Features → Run`; `Run`.

<!-- feature:structure.popup -->
### Structure

A window showing what is inside the file you are reading, and what is inside the project, drawn as a tree with lines joining each thing to what it belongs to.

Why use it: The file list tells you what is there. It does not tell you what any of it is. This does - and for a function it also shows what that function calls, and what calls it.

How to use it: Open it from the activity bar or its shortcut. Two tabs: This file, and This project. Click any row to jump to it. For a style rule it shows the elements that rule actually affects, and for an element the rules that style it.

Access: `All Features → Structure`; `Open`.

<!-- feature:structure.cssLinks -->
### Style and markup links

Click a style rule to see the things on the page it changes, or click something on the page to see the rules that style it.

Why use it: A class name written in one file and used in another is the most common untraceable link in a codebase. This traces it, both ways.

How to use it: Works in HTML, JSX className, and Vue, Angular, and Handlebars templates. It can also point out rules that style nothing, and class names nothing defines - both switchable, since on a large project either list can be long.

Access: `All Features → Style and markup links`; `Open project map`.

<!-- feature:workbench.toolsPage -->
### Tools page

Everything the assistant and your agents can use, as cards: ADCode's own tools, MCP servers, skills and project memory, with one search across them.

Why use it: Agents are who; tools are what. Seeing which agent may use which tool, why a server is not working and what the assistant remembers - in one place - beats hunting through settings and config files.

How to use it: Choose Tools in the Vibe sidebar, or Open Tools from the command palette. Built-in lists ADCode's tools in plain words, grouped by what they do, and says which agents may use each one. MCP servers shows each server with a health light, its tools and uses, and - when something is wrong - what to do about it; Tools on a connected server turns individual tools on or off, and Retry reconnects. Add server offers a catalogue of servers that work in one click, such as Playwright for testing pages in a real browser and Context7 for current library docs, or Custom for your own. Skills turns written routines on or off, previews them, and creates new ones. Memory shows what the assistant has learned. Search filters every tab at once.

Access: `All Features → Tools page`; `Open Tools`; `Add an MCP server`.

<!-- feature:workbench.universalSearch -->
### Universal search

The search box in the title bar finds ADCode features, commands, files, recent folders, and symbols together.

Why use it: One search is faster when you remember what you want but not which menu, panel, or file contains it.

How to use it: Choose the title-bar search and type a name or goal. Use the arrow keys and Enter to open a result. Start with > for commands. Ctrl+P, Ctrl+Shift+P, Ctrl+T, and Ctrl+Shift+F still open their focused searches.

Access: `All Features → Universal search`; `Search`.

<!-- feature:workbench.modes -->
### Vibe and Code modes

Vibe is the default conversation window. Code opens as a separate IDE window for the same project.

Why use it: Keep planning and editing visible at the same time, with each window sized for its own work.

How to use it: Start in Vibe and choose Open IDE at the bottom of the Vibe sidebar to open or focus the Code window. Use Vibe in the Code toolbar to return to the conversation window. Opening a file, Browse files in the IDE or Search in files from Vibe opens the IDE on exactly that. Both windows follow the same project; Code restores its editor tabs.

Access: `All Features → Vibe and Code modes`; `Vibe`; `Code`; `Project`; `AI tasks`; `Preview`.

<!-- feature:workbench.vibeSidebar -->
### Vibe sidebar

The left side of the Vibe window: start a conversation, switch project, and see at a glance what has changed.

Why use it: Vibe hides the editor, so something has to tell you that an agent is still working or what has changed. The Changes badge says so without opening anything, and every everyday workflow has a row of its own instead of hiding in a menu.

How to use it: New conversation (Ctrl+Shift+N) starts fresh; earlier ones stay under Conversations, grouped by day and searchable. The project card shows the folder, its branch and how many files have changed - select it to switch to a recent project, open or clone one, or see the project overview. Chat, Agents and Tools switch the page in the middle of the window: Chat is the conversation, Agents is the board of agents working in parallel and your saved agents, and Tools is where built-in tools, MCP servers, skills and project memory live. Changes opens the Changes panel as a floating window over the page (select it again to close it); its badge counts the files you have not committed, and turns blue when something needs you, such as a conflict or - if you chose Review every change - AI edits waiting to apply. Preview shows the running app in a floating window, and Automations schedules messages. Nothing docks on the right, so the page always keeps the full width. The footer holds Open IDE, notifications, your earnings, Settings and More for everything else. Drag the sidebar's right edge to resize it. Press Ctrl+B to hide or show it; on a narrow window it becomes a drawer that the menu button or Ctrl+B opens.

Access: `All Features → Vibe sidebar`; `Show or hide`; `Keyboard → Ctrl+B`.

<!-- feature:workbench.welcome -->
### Welcome: what do you want to build?

The first screen asks what you want to build, gets the AI connected if it is not, and builds it.

Why use it: The fastest way to know whether a tool is any good is to watch it make the thing you had in mind.

How to use it: On first launch, type your idea or pick one of the ideas under the box, then press Build it or Enter. If no AI model is connected yet, the next step offers a free one. ADCode then makes the project, opens it and sends your idea to the assistant. Skip or Escape closes it at any time; Open a folder uses a project you already have. Run Show Welcome from the command palette to see it again. Theme, ad frequency and account are in Settings.

Access: `All Features → Welcome: what do you want to build?`; `Show welcome`.

## Appearance

<!-- feature:adcode.appearance.theme -->
### Appearance

Warm light, charcoal dark, or midnight. System follows your computer's appearance.

Why use it: Dark is easier at night, light is easier in daylight, and following the system means you never think about it.

How to use it: Light is the default for new installs. Choose Dark, Midnight, or System in Settings. Your explicit preference stays selected across modes.

Access: `All Features → Appearance`; `Settings`.

<!-- feature:adcode.appearance.density -->
### Density

How much space there is between things. Comfortable is roomier; compact fits more on screen.

Why use it: Generous spacing looks good on a large monitor and wastes a laptop screen.

How to use it: Pick Comfortable or Compact. It changes immediately, everywhere.

Access: `All Features → Density`; `Settings`.

## Account

<!-- feature:account.earnings -->
### Earnings

What you have been paid for the sponsored cards you have seen, listed one by one.

Why use it: So the number is something you can check rather than something you are told.

How to use it: Open the earnings view from the title bar. Every row is a real event with the exact amount. The total is worked out by adding the rows up, so it can never disagree with them. Nothing in ADCode can edit or delete a row - a correction is a new row that points at the one it corrects.

Access: `All Features → Earnings`; `Open`.

<!-- feature:account.invite -->
### Invite & earn

Send your invite link to a friend, and you get a share of the ad money ADCode makes when they use it.

Why use it: If someone you know would like a free AI code editor, this pays you for telling them, and it costs them nothing: they keep every cent of their own earnings.

How to use it: Open Invite & earn from the Earnings card or the command palette. Copy your link, or post it on X or Threads, or email it. When someone installs ADCode from your link, the editor picks the invite up by itself. For 365 days you get 10% of what ADCode earns from the ads they see, and 5% of what any advertiser you bring spends. Both come out of ADCode's half, never theirs. Earnings arrive the day after the ads were seen. If a friend sent you a code, paste it into the box in your first 14 days.

Access: `All Features → Invite & earn`; `Open`.

<!-- feature:account.signIn -->
### Signing in

Signing in keeps your earnings attached to you rather than to this one computer.

Why use it: Without it, your balance lives only on this machine and is lost if the machine is.

How to use it: Use the account button in the title bar. You can sign in with Google, GitHub, or an email address, and anything you already earned anonymously comes with you.

Access: `All Features → Signing in`; `Open account`.

## Files and gestures

<!-- feature:gestures.multiSelect -->
### Selecting and moving files

Files can be renamed, moved, copied and deleted straight from the file list.

Why use it: Leaving the editor to use a file manager for something this ordinary is a break in the work.

How to use it: Right-click any file for the full list. Drag to move, hold Ctrl while dragging to copy, and F2 to rename. Deleting sends to the recycle bin, not to nowhere. Use Split editor right in a file header or the command palette to edit two files side by side. Each panel has a file picker; selecting a tab or opening a file uses the focused panel. Drag the divider to resize, or focus it and use arrow keys. Merge editor panels returns to the focused file without closing your buffers.

Access: `All Features → Selecting and moving files`; `Open Explorer`; `New file`; `Open file`; `Save`; `Save as`; `Save all`; `Revert file`; `Close editor`; `Close all editors`; `Split editor right`; `Merge editor panels`; `Insert file template`; `Open folder`; `Open recent`; `Open a recent folder`; `Clear recent folders`; `Close folder`; `Keyboard → F2`.

## Ads and earnings

<!-- feature:adcode.ads.frequency -->
### Frequency

How often a sponsored card is allowed to appear. Off, Light, Standard, or Max.

Why use it: Fewer cards means less interruption and less earned; more means the opposite. It is your trade to make.

How to use it: Standard by default - at most one every 10 minutes and 24 a day. Light is one every 30 minutes and 8 a day; Max is one every 5 minutes and 60 a day. These limits are counted on your machine, and the server is only ever allowed to make them stricter, never looser.

Access: `All Features → Frequency`; `Settings`.

<!-- feature:adcode.ads.enabled -->
### Sponsored messages

A small advert card appears in the corner sometimes, and you get paid a little each time one is shown.

Why use it: It is how ADCode is free. If you would rather not, turning this off costs you nothing else - no nag screens, no locked features.

How to use it: On by default. This switch is the final say on this machine: with it off, nothing is shown and nothing is earned, whatever the server says. Cards arrive while you work - that is how they are seen at all - but never during a debug session, never when the window is not in front, not for the first minute after launch, and never twice in a row without a gap. On a new install no card appears until the assistant has built something for you, or for the first 15 minutes, whichever comes first.

Access: `All Features → Sponsored messages`; `Turn on or off`; `Settings`.

## Updates

<!-- feature:adcode.updates.auto -->
### Install updates automatically

New versions download in the background. When one is ready, the status bar says Restart to update and a small card offers to restart now.

Why use it: So you are never out of date, and you always know when a new version is waiting - without a box that stops your work.

How to use it: On by default. While a new version downloads, the status bar shows its progress; when it is ready it reads Restart to update, and a card offers Restart now or Later - once per version, and only when you are not typing. Restart now keeps anything unsaved and offers it back when ADCode reopens - if crash recovery is off, it asks you to save first. Later, or ignoring it, installs the update the next time you close ADCode. On Linux the card simply says the update is ready, and it installs when you close ADCode. ADCode never restarts itself. Help → Check for Updates asks now and tells you where you stand, including when you are already on the latest version. If an update ever fails, Help → Report a Problem includes what the updater recorded. Turn this off to update by hand instead. If you installed ADCode from the Microsoft Store, or from a Linux package manager, that is what updates it and this setting does nothing - Settings says so rather than pretending to check.

Access: `All Features → Install updates automatically`; `Check now`; `Restart to update`; `Turn on or off`; `Settings`.

<!-- feature:updates.whatsNew -->
### Tell me what changed

Now and then, a small card tells you what changed in the version you just got.

Why use it: A feature nobody is told about may as well not exist. This is the one interruption ADCode allows itself, so it is kept rare.

How to use it: Four rules keep it quiet: you see a given version's note once on this machine and never again, it waits for a moment when you are not typing, not running a command, and not debugging, it only appears for releases worth reading - small fixes install silently - and it never appears on a brand new install. Dismiss it and it is gone for good. Turn this off and nothing ever pops up; Help > What's New still has every note. A security fix is the one thing that will not wait for a quiet moment, though even that respects the switch being off.

Access: `All Features → Tell me what changed`; `Read it`; `Turn on or off`; `Settings`.
