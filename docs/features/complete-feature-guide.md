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
- Zoom: `Ctrl/Cmd+=`
- Text size: `Ctrl/Cmd+Shift+.`
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

<!-- feature:ai.buyTokens -->
### Adding AI credits

Add USD credits once and use any paid model in ADCode. They never expire and nothing renews.

Why use it: Use popular models without a subscription, an API key or an account with each model company.

How to use it: Run AI: Buy AI Credits or open adcode.bluethenics.com/ai-tokens with the same account as the editor. Choose $10, $20, $50 or $100, enter your billing country, and pay through Dodo, which shows tax before you pay. Credits arrive within seconds of payment and show on the same page with every charge since. Every model's price is listed there and on adcode.bluethenics.com/pricing. Credit packs from before 6 November 2026 were converted into USD credits at the price paid. For a refund of unused credits, contact support.

Access: `All Features → Adding AI credits`; `Buy credits`.

<!-- feature:ai.agentMascots -->
### Agent mascots

Each saved agent has its own little character - a shape and a colour - and its face shows how that agent's work is going.

Why use it: On a busy board you should not have to read to know what needs you. A worried face with a ! stands out from a sleepy one, and a Reviewer never looks like a Tester.

How to use it: Every agent gets a look of its own from the moment it is created; change it in the agent editor by picking one of eight shapes and ten colours. On the board the face follows the work: thinking while it works, alert with a ! when it needs you, proud when its work is ready to review, happy once it has landed, confused when something went wrong, and sleepy while it waits or after it stops. With Reduce motion on, mascots stay still but still change face. Each card on the Agents board has Run, Edit, Duplicate and Delete; Delete asks first, and runs an agent already did stay on the board. The built-in assistant's own face and name are in Customise chat. ADCode also has a mascot of its own, Buck: the <$> logo come alive, with the brackets for hands and the dollar as a coin he flips. He greets you in the welcome tour and on the Browser's start page, searches while Move In scans for your conversations and celebrates when they arrive, and shows how your connected apps are doing on the Apps page. Click him for a reaction. With Reduce motion on he holds a still pose for each mood instead of moving.

Access: `All Features → Agent mascots`; `Create an agent`; `Edit an agent`.

<!-- feature:ai.agentRules -->
### Agent rules and hooks

A file in your project that says what the AI may do on its own, what it must ask about first, and what it may never do - plus your own commands that run before and after each step.

Why use it: Before you leave the AI working unattended, or on a project where a wrong command is costly: block git push, keep it out of .env files, ask before any file is deleted, run your linter after every edit, and refuse to finish until the tests pass.

How to use it: Run AI: Open Agent Rules and Hooks; ADCode creates .adcode/settings.json in your project with a commented starter and opens it. Under permissions, list rules in allow, ask or deny: a tool name, optionally with a pattern in brackets - run_command(git push*), edit_file(src/**), delete_file(*), fetch_url(domain:example.com). Deny always wins; between ask and allow the more specific rule decides, so ask: ["run_command"] with allow: ["run_command(npm test*)"] asks before every command except the tests. A path pattern without a slash matches at any depth, and a rule on a folder covers everything in it. A chained command such as npm test && git push is checked part by part. A denied call fails with the rule's name, so the AI tells you instead of trying another way; an ask opens a dialog with Allow once, and when nobody is there to answer, the call is refused. Under hooks, preToolUse, postToolUse, sessionStart and stop each take a list of { "matcher": "run_command", "command": "node check.mjs" } entries. The command gets the call as JSON on stdin, with the same field names Claude Code uses. Exit code 2 is the one that counts: from preToolUse it blocks the call, with what the command printed to stderr as the reason; from postToolUse that text is added to the step's result for the AI to fix; from stop it sends the AI back to work, up to three times. Any other failure is written to the debug log and the work goes on. sessionStart's output is given to the AI. A project's hooks run only after you approve them once, and you are asked again whenever they change. For rules in every project, run AI: Open My Agent Rules for Every Project, which opens ~/.adcode/settings.json; a project's allow rules never lift an ask from your own file. Rules apply to the chat, its helpers and Team agents alike. Changing the rules file itself always asks first. With no rules, nothing changes: the AI works exactly as before.

Access: `All Features → Agent rules and hooks`; `Open the project rules`; `Open my rules for every project`.

<!-- feature:adcode.ai.parallelAgents -->
### Agents working at once

How many agents on the Agents board, and Team roles, may work at the same time. The rest wait their turn as Queued.

Why use it: More agents at once finishes a pile of tasks sooner, but spends your key faster and is likelier to run into a provider's rate limit. Three is quick without being greedy.

How to use it: Settings > AI > Agents working at once: pick 1 to 6. A run that is waiting shows Queued on its box and starts on its own, oldest first, as soon as another agent finishes or is stopped. Raising the number starts queued runs straight away. It counts agents in this window; the main chat is never queued.

Access: `All Features → Agents working at once`; `Settings`.

<!-- feature:adcode.ai.chatWidget -->
### AI chat workspace

A conversation workspace with searchable history, a timeline of the work behind each answer, copyable code blocks, per-response actions, a jump-to-latest pill, and an interrupted banner with Edit prompt and Try again.

Why use it: Asking in the editor beats copying code into a browser, because the assistant can already see the project. A playful mascot, a scroll pill that respects your place, and a clear way back from an interrupted turn keep long runs feeling alive instead of hung.

How to use it: Open Assistant from the workbench or command palette. Write in the composer and send your request. Each answer is a timeline that reads in the order it happened, as in Claude: under a Working for Ns heading come its thoughts (a Thinking row with a one-line summary - open it to read the whole thought), the steps it takes (a run of the same tool is one row, such as Search project · 11 calls, and opening it lists each call with a tick), and the text it writes between them. The blue mascot with white eyes sits in the heading while it works - its eyes follow your pointer, and clicking it pops a morale-boosting quip - and a small pixel mosaic marks whatever is still running. When the turn ends the timeline folds to Worked for Ns with the answer below it; select the heading to unfold it. Scroll up and the transcript stays pinned while a Jump to latest pill appears with a count of new messages; select it to return to the tail. Type a follow-up while the assistant is still working and press Enter: it is queued above the composer and sent by itself when the current turn finishes - Send now stops the current turn and sends it at once, and × drops it. While a turn runs, a line at the bottom of the conversation shows what the assistant is doing, for how long, and a Stop button; while the timeline is open it keeps the time, so the line shows just the pixel mosaic and Stop. One assistant at work shows one face: the mascot in the timeline heading. The name above the turn gets its face back once the reply is finished. Esc stops it too, and so does the send button, a stop square while a turn runs. If you stop a turn, an interrupted banner offers Edit prompt (your last message back in the composer) and Try again. If a turn fails, a card in the conversation says why in plain words - a rate limit, a request too large for the model, a rejected key, a broken tool call, a network problem - with buttons to try again, switch model, start fresh or report it, and the provider’s exact message under Details. When another model is the fix - out of credit, a rejected key, a model that is gone - choosing one picks the request back up by itself, whether you choose it from the card, the model chip, Connect a model or Settings. A failed turn never breaks the conversation: the next message works as normal. Code arrives in labelled blocks with a Copy button and inline commands read as pills. Every response offers icon actions for Copy, Read aloud, helpful or not helpful, and Retry, with relative time like just now. Use History to browse conversations - opening another one never stops a chat that is working: several work at once, each marked in the list; Team, schedules and activity opens as a floating panel, and the Agents page shows every agent at work. Share copies the conversation as markdown. When nothing is running, Escape closes the workspace without losing the conversation. A history row's ⋯ menu opens, renames, copies as Markdown or deletes a conversation. The assistant changes existing files with exact replacements instead of rewriting them, reads several files at once, and works through up to 50 steps per request, and Keep going until done carries it on past that by itself. Its edits land in your files as it works, and each turn that changed files gets an Undo card. On an empty conversation, starters get going in one click: Continue picks up the conversation this project was left on, then Explain this project, Build something, Fix an error, Plan new idea and Multitask. With no folder open the starters are things to build - a landing page, a snake game, a to-do app, a portfolio - and asking for something to be built makes a project folder for it. In Vibe a short checklist shows anything still missing: connecting your AI (free in about a minute), then describing what to build.

Access: `All Features → AI chat workspace`; `Turn on or off`; `Settings`.

<!-- feature:ai.credits -->
### AI credits and free models

Tagflow AI is free for every signed-in account. Every other model is paid from USD credits at the price listed for it.

Why use it: Start free on Tagflow AI, and pay only for the other models you actually use: no subscription, nothing renews, and each request is charged only for what it used.

How to use it: Sign in with a verified account. Tagflow AI's models are free and need no credits. Every other ADCode-hosted model, Heabsy's included, shows its price in the model picker and charges your USD credits: input, cached input and output at the price listed for that model. A request holds its maximum possible charge while it runs and releases what it did not use. When credits run out, paid models pause with a message and Tagflow AI keeps working. Plans ended on 6 November 2026: a plan already paid for covers every model until its period ends and does not renew. Your own provider keys, coding CLIs and local models are billed by their own provider.

Access: `All Features → AI credits and free models`; `Show credits`.

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

Create named agents with their own instructions and models, then let a team divide a task - messaging each other as they work and sharing the project's memory - and bring its results back for review.

Why use it: Independent research, coding, and checking can finish faster without making one assistant carry every detail in the same context.

How to use it: Open Agents from the Vibe window's rail or the command palette. Five starter specialists appear on the first visit and use your currently connected model. Create agents under Your agents with a name, look, instructions and the tools they may use. In Edit, keep Use the currently connected model on to follow your selection in Connect a model, or turn it off to pin a connection and model to that agent. Enable Run after teammates for an agent that should receive others' handoffs first. Choose Select for a Team, tick two to four agents, press Set up Team and describe the shared task. The Team appears as one box under Needs you with its members' mascots; press Start to begin. Select the box to see each step it took. Review combined changes before applying them, or Stop a running team. Requests share each connection's rate limit, and Teams count towards Agents working at once. The assistant can also suggest a Team for a big request in the chat.

Access: `All Features → AI Team`; `Set up Team`; `Settings`.

<!-- feature:ai.usage -->
### AI usage

Shows how much AI you used and what it cost, on this computer - by project, provider, model, day and chat - with plain sentences that say what it means.

Why use it: So you know where your money and tokens go, what the cache saves you, which chats got expensive and when you use AI most, without waiting for a provider's bill. Every provider and coding CLI is in one place.

How to use it: Run AI: Show Usage, or select Usage in the chat's header. At the top, choose a project and a provider (or All), a range - Today, 7 days, 30 days or 90 days - and Cost, Tokens or Limits. The page has four tabs, each with one line saying what it is for. Overview: In short (a few plain sentences, such as where most of the money went and what caching saved), the big total with how many chats and requests it covers and the change from the period before, a row per provider with its share - point at one to light up its colour in the chart - and Over time, each provider by day (Today shows requests by hour; move the pointer or the arrow keys along it to read a day). Your models: a card for each model you actually used in that range, most expensive first, with requests, tokens, cost per request, share, how much came from cache and its speed; select a card for what it read fresh, read from cache and wrote, tokens per request and its average answer time. Compare your models prices the same work on another model you have used, when at least two have a known price (cached input is counted at full price, so it is the most it would cost). When and where: Busiest hours (weekday by hour), Most expensive chats (press one from this project to open it) and Activity, your past year of streaks. Details: totals counted four ways and what the cache saved, cost or tokens split by type, and a breakdown by model or by day. Limits shows your included AI allowance and when it refills, or tells you to sign in; it answers within a few seconds, with Try again if it could not be read. Chats, projects and hours are recorded from ADCode 2.6 on, so older use says Not yet rather than a number; ≈ marks estimates and No price means no list price. Costs are estimates at list prices, not a bill. Clear usage removes this computer's history, activity and streaks.

Access: `All Features → AI usage`; `Show usage`.

<!-- feature:ai.workspaceStorage -->
### AI workspace storage

Limits how much disk space task copies use and how long finished sandboxes and rollback checkpoints stay.

Why use it: Project copies can be large, but deleting the only safe way back is worse than filling a quota. ADCode treats active work and rollback checkpoints differently for that reason.

How to use it: Terminal sandboxes are cleaned oldest first. An applied task may lose its sandbox when space is tight, but its only rollback checkpoint is kept. If active work leaves no safe room, ADCode refuses the new task and tells you to raise the quota or discard one.

Access: `All Features → AI workspace storage`; `Settings`.

<!-- feature:adcode.ai.askBeforeConnectorTools -->
### Ask before connector tools

Whether ADCode stops to ask you before the assistant calls a tool from a connector - Gmail, Figma, Playwright or any other MCP server you added.

Why use it: A connector is only useful if the assistant can use it while it works. A dialog on every call turns a five-step job into five interruptions, so by default the tools you enabled just run. Turn the question back on when a connector can send mail, spend money or change something you care about.

How to use it: Off by default: a tool you enabled on a connector runs as soon as the assistant calls it, and the chat's timeline shows the call and its result. Turn it on in Settings, under AI, to see each call's exact arguments in a dialog first, with Allow once or Cancel. Either way, nothing runs until you have enabled that tool in Tools; enabling the assistant's own request to use a connector's tools follows this switch too. Starting a local program for a stdio connector always asks, and a project's ask rules still ask when this is off.

Access: `All Features → Ask before connector tools`; `Turn on or off`; `Settings`.

<!-- feature:ai.sessions -->
### Chat history and memory

Every conversation is kept in Today, Yesterday, and older groups, so you can go back to one. A strip at the top shows exactly what the assistant is remembering right now, and a button clears it.

Why use it: Assistants that forget everything are frustrating, and assistants that remember invisibly are worse. Showing what is remembered makes clearing it something you can actually see work.

How to use it: Press Ctrl+Shift+N or choose New conversation to start fresh; the current one is kept. In Vibe, past conversations are listed in the sidebar, grouped into Today, Yesterday and older; in the IDE the assistant is a floating window over the editor (Ctrl+I shows or hides it) - choose History from the conversation's actions menu. Search them by title or by anything said in them, rename them, or delete one. The header shows the current conversation name and Share copies it as markdown. Conversations are stored on your own machine, per project, and are never uploaded.

Access: `All Features → Chat history and memory`; `Open Assistant`; `New conversation`.

<!-- feature:ai.backgroundChats -->
### Chats that keep working

Several chats can work at once, and each keeps working when you open another chat, minimise ADCode or put the browser tab in the background.

Why use it: A real job takes minutes. You should not have to watch one finish before starting the next, or keep the window in front for it to carry on - start a landing page, then a game in another chat, and come back to both done.

How to use it: Send a message, then open another conversation (or press + New) and send there too: up to four chats work at the same time, one at a time in Review mode. In Conversations a spinner means a chat is working, a green dot means it finished while you were elsewhere, and an amber dot means it stopped before finishing - each until you open it. Opening a working chat shows its timeline so far and carries on live; Stop stops only the chat on screen. A message typed into a chat while it works waits for that chat, even if you leave it. Minimise the app or switch to another program and the work goes on: ADCode keeps the computer from suspending it while a chat works, and a notification says when one finishes. On the web the cloud workspace stays awake while a chat works, even with the tab in the background or closed - it counts against the day's cloud time - and the tab's title gets a dot when one finishes. With Keep going until done on, a long job carries on past the step limit by itself. Run AI: Show Working Chats to see them all.

Access: `All Features → Chats that keep working`; `Show working chats`.

<!-- feature:ai.connect -->
### Connect a model

Choose ready models in Free · no API key, or use Bring your own key to connect a provider or named API endpoint.

Why use it: A key that was pasted wrong should say so immediately, not silently fail the first time you ask a question.

How to use it: Open Connect a model. Free · no API key opens first with included models and ready local models: choose Use this model. Included models require a verified ADCode account; Tagflow AI and all other included models share one weekly free allowance. Use the local setup buttons to start or download Ollama. Bring your own key contains personal provider connections and the three-step guide: choose a provider, check and save its key, pick a model. Add a named connection with an OpenAI-compatible base URL and exact model ID for other endpoints; the NVIDIA NIM preset fills its hosted endpoint. Set requests per minute, save the connection, then check and save its API key. Select the connection for chat or an agent. Chat, completion, and team requests share its queue. Server cooldowns are respected; token or account quotas can still cause rate-limit errors. Keys remain encrypted by the operating system. Administrators can add, hide and select default models in the linked Free models and BYOK models catalogs.

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

<!-- feature:ai.exportChat -->
### Export a conversation

Save the conversation you have open as a file: Markdown to read or share, or JSON to keep or move to another computer.

Why use it: A good conversation is worth keeping outside the app: to paste into a ticket, send to a teammate, or put in the repository next to the change it produced.

How to use it: Open the conversation, then run Export This Conversation as Markdown, or as JSON, from the command palette. Choose where to save it. The file holds what you and the assistant said, in order, and nothing else: no tool output, no file contents the assistant read, no attachments. A JSON export can be brought back in with Move In, under Import an exported file. Share in the chat header still copies the same Markdown to the clipboard.

Access: `All Features → Export a conversation`; `Export as Markdown`; `Export as JSON`.

<!-- feature:ai.chatForks -->
### Fork chats

Split a job into visible fork chats that work in parallel, already know the conversation, and message each other. The assistant forks on its own when a request has independent parts.

Why use it: Some jobs split naturally into independent parts - research two APIs while a third part writes the tests. Helpers disappear into one tool result, but a fork is a real conversation you can open, redirect or continue afterwards.

How to use it: Ask for a task with independent parts and the assistant forks it by itself, saying which forks it started; turn off Fork chats on its own in Settings > AI to have it fork only when you ask. You can also fork the conversation yourself: press Fork in the chat header, choose Fork this conversation from a conversation's menu, or run AI: Fork This Conversation. A manual fork copies the conversation, appears in History with a branch mark, and waits for you to send in it. The assistant can also start up to three forks in one go with up to six per chat; only the main chat can start or stop a fork. Each fork has its own tab, model turn and history, and starts from a copy of the parent's conversation so it does not need the same explanation again. Forks can send each other short messages - a decision, a warning about a shared file, a question - which arrive between tool calls, and the main chat can wait for its forks and collect their reports. Fork chats cannot start more forks. All chats share the same project files, so assign separate files where possible. The family can exchange up to forty messages before it is asked to finish.

Access: `All Features → Fork chats`; `Fork this conversation`; `Turn on or off`; `Settings`.

<!-- feature:ai.freeKey -->
### Free AI in a minute

Get the assistant working for free: a free Google Gemini key, a model already on your computer, or a key you already have.

Why use it: You should not need a credit card, or to know what an API key is, to see what ADCode can build. Google gives anyone with a Google account a free Gemini key, and this gets it connected without copying settings around.

How to use it: Choose Connect your AI - free in the Vibe checklist, run Get a Free AI Key from the command palette, or just send a message - with no model connected, the reply offers the same choices. Press Get my free key: Google AI Studio opens in your browser. Sign in, click Create API key, and copy it. Come back to ADCode and the copied key is picked up and checked on its own; you can also paste it. If Ollama is running on this computer, Use it connects a local model instead, and nothing leaves your machine. Already have a key from OpenAI, Anthropic, OpenRouter, Groq, xAI, DeepSeek or Cerebras? Paste it under I already have a key and ADCode works out which service it belongs to. Nothing is saved until the model has answered a test message. Google's free tier may use what you send to improve its products, so use a paid key for private or work code.

Access: `All Features → Free AI in a minute`; `Get a free key`.

<!-- feature:ai.subagents -->
### Helpers: agents that start agents

The AI can split a big task into parts and hand them to helper agents that work at the same time, each with a fresh memory.

Why use it: A large job finishes sooner when its independent parts run side by side, and long searches stay out of the main conversation, so it keeps its focus on your request.

How to use it: Ask for something large, or start your message with /helpers (or run AI: Split a Task Across Helpers) to ask for it outright. The AI calls its Helpers step with up to four tasks; each helper gets its own instructions and the same model. Explore helpers only read and search; build helpers can change files and run commands, and are told to stay in their own files. You see each one's progress on the working line - Helper 2 of 3 · Tests: running npm test - and a Helpers row in the timeline with every report. Their edits belong to the same turn, so Undo reverts them together, and Stop stops every helper. Helpers cannot start helpers of their own. Each helper's requests count toward the same included AI allowance as any other. Local models are not offered helpers.

Access: `All Features → Helpers: agents that start agents`; `Split a task across helpers`.

<!-- feature:ai.tagflow -->
### Included AI without a key

Use the AI included with your verified ADCode account without buying or pasting an API key.

Why use it: Start with an allowance paid for by ADCode. You can still switch to your own provider or a local model when you need more capacity.

How to use it: Open Account, sign in and verify your email, then send a message. If you send one before signing in, the chat offers Sign in and sends it again by itself once you are. If the connection drops mid-task, the task retries by itself for about two minutes and carries on where it was. Included AI is selected automatically for new installations when enabled, using the administrator's default model. Older installations with an unconnected default provider also switch automatically. In Connect a model, the Free · no API key tab lists included and ready local models; choose Use this model to switch. Bring your own key keeps your personal provider connections separate. Administrators manage Free models and BYOK models from separate linked catalogs: add new models, set defaults, and hide models. Free models can use Tagflow, OpenAI, Gemini, Groq, OpenRouter or any OpenAI-compatible provider an administrator registers, through configured server keys. Chat, completions and agents across all included models share 5M free tokens a day, then use tokens you buy (see Buying AI tokens). Open AI usage to review activity. Provider availability and model context limits still apply. Prompts, project context and tool results pass through ADCode's server to the selected provider; the server stores usage counts, not prompts or replies. Included AI currently accepts text and tool calls, not image attachments.

Access: `All Features → Included AI without a key`; `Choose included AI`.

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

How to use it: On by default. Turn it off from the approval menu in the chat's composer or in Settings. When a turn ends at the step limit, ADCode carries on by itself, up to twenty times in a row - about a thousand steps - and the timeline says so each time. It is the app that carries on, not the chat window, so it keeps going while ADCode is minimised, while you work in another chat, and on the web with the tab in the background. Pressing Stop ends it. With it off, the assistant stops at its step limit and a Continue button picks up where it left off. Together with Apply automatically, and Automations to schedule the job, work runs start to finish without you.

Access: `All Features → Keep going until done`; `Turn on or off`; `Settings`.

<!-- feature:ai.toolBridge -->
### Let other AI tools use ADCode

Claude Code, Codex, Cursor and other coding agents on this computer can use ADCode's own tools: look up and run its features, change its settings, set up connectors, and use the Browser panel and your live room.

Why use it: You may do your coding in another agent's terminal, but ADCode still holds things that agent cannot reach - your connectors, the Browser with your sign-ins, the room your team is in. Rather than switching windows to do those steps by hand, the agent you are already talking to does them through ADCode, with the same checks ADCode's own assistant gets.

How to use it: On by default. Open Tools, choose Memory, and find Let other AI tools use ADCode: it shows the address (http://127.0.0.1 and a port) and a ready config for Claude Code (one command to run in a terminal), for Cursor and other tools that read an mcpServers JSON file, and for Codex (lines for ~/.codex/config.toml). Press Copy and paste it into that tool once; it keeps working across restarts. When you choose Claude Code, Codex or OpenCode as ADCode's chat model, ADCode hands it these tools itself on every message, with nothing to copy - plus the live preview, the page viewer and the page audit (to open and check what you are building), skills, and your connectors. How it stays safe: it only listens on this computer (127.0.0.1), never the network; every request must carry the key in the config, and requests from web pages are refused; anything ADCode would ask you about - a setting that changes ads or updates, starting a connector's program - still opens a dialog in ADCode first, and says another AI tool is asking. Regenerate key makes a new key, and every config you pasted stops working until you copy it again. Switch it off on that card or in Settings, under Assistant, to close it completely.

Access: `All Features → Let other AI tools use ADCode`; `Turn on or off`; `Settings`.

<!-- feature:adcode.browser.agentControl -->
### Let the assistant use the Browser

Whether the assistant may open pages, click and type in the Browser panel's tabs.

Why use it: Those tabs hold your sign-ins. Most people want the assistant to be able to look something up or fill in a form for them; some would rather the Browser stayed theirs alone.

How to use it: On by default. Open Settings, choose Assistant, and switch Let the assistant use the Browser. With it off, the assistant says so when a task needs the web and asks you to do that step; it can still check your own project's pages in its separate, signed-out browser.

Access: `All Features → Let the assistant use the Browser`; `Turn on or off`; `Settings`.

<!-- feature:ai.richReplies -->
### Links, buttons, images and mockups in replies

The assistant's replies can contain links you can click, rows of link buttons, pictures, and small live mockups of a design.

Why use it: "Go to the dashboard and click..." is slower than a button that takes you there, and a paragraph describing a layout is worse than seeing it. Showing the thing is usually the shorter answer.

How to use it: Nothing to turn on. Ask for it in plain words: "give me buttons for the docs and the dashboard", "sketch three layouts for the pricing section", "show me that image". A link or button opens the page in the Browser panel. A mockup is drawn in a sealed frame: none of its scripts run, it cannot reach your files or the app, and it can load nothing but images over https; press Phone width to see it narrow, and Show the HTML for its source. A mockup is a sketch to react to, so ask the assistant to build the one you like. Only web addresses become links; anything else stays plain text.

Access: `All Features → Links, buttons, images and mockups in replies`; `Ask for a mockup`.

<!-- feature:ai.liveAgents -->
### Live agent view

Watch every agent at work in the chat: the code it is writing types in as the model produces it, commands show their output as they run, and agents on a Team pass messages you can see.

Why use it: An agent working out of sight is hard to trust and hard to stop in time. Seeing the code appear line by line, and seeing teammates tell each other what they changed, shows you what is happening while there is still time to step in.

How to use it: On by default. When the assistant writes a file or runs a command, a live window appears in the conversation: the file's name, the code typing in, then the files it touched and whether it ran checks. When agents from the Agents page, a Team, a race or Team in the terminal are working, a live room appears in the conversation with their mascots side by side and a window for each; while they work it moves down with the conversation, so it stays just below the newest message. When one agent messages another, hands off its work, or edits a file a teammate already edited, the sender turns to the receiver and a speech bubble crosses between them; the line under the mascots keeps what was said. Click a mascot or a window's title bar to fill the room with that agent, and Hide windows to keep just the mascots. Every background agent's window has Stop in its title bar (Stop team for a Team, which stops its members together), and the assistant's own turn stops from the line under its window; with two or more runs going, Stop all in the room's header stops them in one go. A reply types in as the agent writes it, and its mascot is marked typing. The ⋯ beside Stop opens the agent's actions: open it on the Agents board, edit the saved agent, or hide the windows. Each window shows Checks passed, Check failed or Unverified, from the commands the agent actually ran - never from what it claims. Turn it off in Settings > AI > Live agent view.

Access: `All Features → Live agent view`; `Turn on or off`; `Settings`.

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

Which particular AI answers you, and how hard it thinks. Click the model name under the chat box to pick one; star the ones you like and they stay on top.

Why use it: Bigger models are cleverer and slower; smaller ones are quick and cheap. Most people want a big one for hard questions and a small one for everything else. Changing model used to mean opening the big Connect screen; now every connected model, your favourites and the thinking level are one click from where you type.

How to use it: Click the model chip under the chat box, or run AI: Choose Model and Reasoning. On the left are Favourites and each connected provider by name (a dot marks the one in use); or type in Search models to find one by name. Each row says what the model is and what it costs. Click a model, or move with the arrow keys and press Enter; the one in use has a check. Press the star on a row to keep it in Favourites: your first nine get Ctrl+1 to Ctrl+9 (Cmd on a Mac), which switch model straight from the chat box. Show more lists the rest of a provider's models. On the right, Reasoning lists only the levels that model really accepts - Auto (the model decides), Low, Medium, High, Max; models that do not reason say so. At the bottom, When it changes files chooses whether edits land right away or wait for you, and Connect more models opens Connect a model. The chip shows the model and level, for example Fable 5.1 · High. Escape closes it. Connect a model has the full list: only models that can work as your assistant - ones that write text and use tools - newest first, each saying what it reads at once and what it costs per million tokens, tagged Recommended, New, Free or Free tier where that is true. Switching takes effect on your next message - it does not restart the conversation. Thinking effort sets how hard reasoning models think: Auto lets the provider decide, higher efforts answer harder questions better and cost more; each model is sent the nearest level it actually has. A long reply that reaches the model's output limit carries on by itself with more room.

Access: `All Features → Model`; `Choose a model`; `Settings`.

<!-- feature:ai.moveIn -->
### Move in: bring your AI accounts and conversations

One screen that connects the AI coding tools already on your computer and imports the conversations you had in them.

Why use it: Trying a new editor usually means paying for another AI and starting every conversation from nothing. Your Claude, ChatGPT or OpenCode subscription already works through its command-line tool, and months of context sit in files on your disk. Move in uses both, so the first hour in ADCode is not spent re-explaining your project.

How to use it: Run Move In from the command palette, or choose Bring your accounts and chats on the welcome screen. Your AI accounts lists Claude Code, Codex (your ChatGPT account), OpenCode, Gemini CLI and Freebuff: Use in ADCode makes an installed one answer in ADCode's chat with its own subscription and models, Sign in or Install opens a terminal with the right command, and Check again looks afresh. ADCode never sees a password or key for any of them. Your conversations: press Scan this computer and ADCode looks in the three folders Claude Code, Codex and OpenCode keep their sessions in, nowhere else, and lists what it finds by project with titles, dates and message counts. Everything is ticked; untick what you do not want and press Import. Each conversation is filed under the project folder it happened in, so it is in that project's conversation list when you open it, or tick the box to put them all in the project open now. Only what you and the assistant said is imported; tool output and system prompts are left behind. Nothing is uploaded and the other tools' files are only read. Claude Desktop and ChatGPT keep conversations online, so export them there and use Import an exported file with the conversations.json you get. Importing the same conversation again replaces it rather than duplicating it. The welcome tour does the same in four guided steps: run Show the Welcome Tour. After a scan, Where ADCode looked lists each tool with the folder on this computer it read (for example ~/.claude/projects) and what was there, or Not on this computer. Below it, every project those conversations belong to: its folder, which tools worked in it and how many conversations each had, when it was last used, and Open to work on it in ADCode - or Moved or deleted if the folder is gone.

Access: `All Features → Move in: bring your AI accounts and conversations`; `Open Move in`; `Import conversations`; `Show the welcome tour`.

<!-- feature:adcode.phone.link -->
### Phone link: chat from your phone

Chat with ADCode on this computer from your phone. Your computer does the work; your phone sends messages and follows along, live.

Why use it: Long jobs do not need you at the desk. With Phone link you can start a task on the sofa, check on it from the bus and answer it from anywhere, while everything - your projects, your model keys, your tools - stays on your own computer.

How to use it: In the chat box, open Tools (the sliders button) and choose Phone link, or type /phone, or run Phone Link: Chat From Your Phone. Switch on Let my phone chat with this computer. A QR code appears as soon as it is on. Scan it with your phone, sign in with the same ADCode account, and the phone opens this computer's chats directly (opening web.bluethenics.com/phone by hand, you pick this computer from a list). You see its chats, open one to read it and watch a reply arrive, start a new chat, press Stop, switch the model it answers with (any model this computer has connected), and set what the computer does when the work is done. Add the page to your home screen and it opens like an app. Your computer has to be on, awake and online: it is the one doing the work, so if it sleeps, shuts down or runs out of battery the phone says it is offline, and nothing can wake it from there. The connection goes out from this computer to ADCode's relay, so no port is opened and no router changes; the relay only forwards messages between your two signed-in devices and keeps nothing. Only chatting is possible from the phone - no files, terminals or settings - and when the assistant asks a question, you answer it on the computer. A phone that connects shows a notice with Disconnect, the status bar says how many are connected, and switching Phone link off closes it for all of them.

Access: `All Features → Phone link: chat from your phone`; `Connect my phone`; `Turn on or off`; `Settings`.

<!-- feature:adcode.ai.doneSound -->
### Play a sound when the assistant finishes

A short, soft chime plays when the assistant finishes a task.

Why use it: A long task is a chance to look at something else, and then you have to keep checking whether it is done. The chime tells you, so you can stop watching.

How to use it: Off by default. Open Settings, choose Assistant, and switch on Play a sound when the assistant finishes. It chimes when a task that took more than about twelve seconds ends, and for any task that ends while ADCode is not the window in front. A quick answer you are watching makes no sound, and neither does a task that stopped with an error - that one shows a card instead. The sound follows your computer's volume.

Access: `All Features → Play a sound when the assistant finishes`; `Turn on or off`; `Settings`.

<!-- feature:adcode.ai.designTaste -->
### Product design guidance

Give the assistant and agents a practical workflow for professional styling, purposeful animation, accessible interactions and verified results.

Why use it: A polished product needs a coherent visual system and complete behavior. The guidance helps agents make choices that fit your users, then check what they built.

How to use it: On by default. Interface work loads ADCode's compact production-quality guide; motion and release references load when needed. The existing taste-skill and redesign guides (Leonxlnx, MIT licence) remain available for deeper visual direction. You will see Reading product guidance in the steps. The guide preserves your project's stack and design system. In Tools, Quality lists Inspect project checks, Run project checks and Audit a page. The audit checks phone, tablet and desktop layouts, automated accessibility findings and reduced motion; manual keyboard and visual review still matter. Missing or unrun checks are reported as unverified. Turn guidance off in Settings > AI > Product design guidance.

Access: `All Features → Product design guidance`; `Turn on or off`; `Settings`.

<!-- feature:ai.projectInstructions -->
### Project instructions (AGENTS.md)

The AI follows your project's AGENTS.md - the file teams write to tell any coding agent how their project works - and CLAUDE.md or GEMINI.md if that is what you have.

Why use it: Write down once how to build, test and lay out your project, and every chat, helper and Team agent in ADCode works the way your project expects - the same file Claude Code, Codex and Gemini read.

How to use it: Put an AGENTS.md at the root of your project, or let the AI write one: type /init in the chat, or run AI: Write Project Instructions. ADCode also reads CLAUDE.md, GEMINI.md and .github/copilot-instructions.md, shows a file that only repeats another once, and follows a line that is just @other.md to that file. For rules you want in every project, put them in AGENTS.md inside a .adcode folder in your home folder. A folder can have its own AGENTS.md; the AI reads it before changing files there. The instructions describe your project; they cannot give the AI permissions, and what you say in the chat wins. Long files are cut at about 12,000 characters and the AI reads the rest when it needs it. ADCode's own project memory is separate and lives in .adcode/memory.

Access: `All Features → Project instructions (AGENTS.md)`; `Write AGENTS.md`.

<!-- feature:ai.memoryEditor -->
### Project memory

Read, correct and add to what the assistant has learned about your project - decisions, conventions and preferences - all in one place.

Why use it: Memory you cannot see is memory you cannot trust. When a note is wrong, fixing it once stops every assistant and agent repeating the mistake.

How to use it: Open Tools and choose Memory, or Tools: Project Memory in the command palette. Notes are grouped into Decisions, Conventions, Preferences and Session notes, each showing who wrote it and when. Edit changes a note, Delete forgets it, and Add memory writes one yourself - give it a short name, a one-line summary and the detail. Changes are searchable by the assistant straight away. Share with your other AI tools gives the command that lets Claude Code, Cursor and others use this same memory.

Access: `All Features → Project memory`; `Open project memory`.

<!-- feature:ai.plans -->
### Promo codes, and plans that have ended

Plans are no longer sold. A plan you already paid for covers every model until its period ends; promo codes still work.

Why use it: Paying per model replaced daily allowances, so nobody pays for credits they do not use.

How to use it: Plans ended on 6 November 2026 and renewals were cancelled, so nobody is charged again. A Builder, Pro, Weekly or Max plan already paid for keeps working until its paid period ends and covers every hosted model until then. Afterwards, Tagflow AI stays free and other models use USD credits. Invoices stay in your Dodo billing portal, reached from adcode.bluethenics.com/ai-tokens. To redeem a promo code, open the same page and use the promo-code box: a code grants what it promises, once per account, while it is unexpired and has uses left.

Access: `All Features → Promo codes, and plans that have ended`; `Upgrade plan`.

<!-- feature:ai.promptCaching -->
### Prompt caching

Each step of a long chat re-sends the same instructions, tools and earlier messages. ADCode lets the AI provider keep those in a cache, so you are not charged full price to send them again.

Why use it: An agent that reads ten files makes ten requests, and every one carries the whole conversation so far. Without caching, a long session pays for its beginning over and over. With it, the repeated part costs a fraction - Anthropic bills cached input at a tenth, OpenAI at a half or less - and comes back faster, so the same budget on your own key goes further.

How to use it: Nothing to switch on: chats and agents ask for it on every step. With Claude, ADCode marks the tool list, the instructions and the conversation so far for Anthropic's cache. OpenAI, DeepSeek, Gemini and other compatible providers cache a repeated beginning by themselves, and ADCode sends each step's history in exactly the same order and bytes so their cache matches. To see it working, run AI: Show Prompt Cache Savings or open AI usage: Tokens says how much input was cached, and hovering a model shows its share. A cache lasts a few minutes, so a chat you come back to much later starts a fresh one. Free AI credits still count every input token, cached or not. One-off requests such as inline completions are not cached, because writing a cache costs a little more and nothing would read it.

Access: `All Features → Prompt caching`; `Show cached tokens`.

<!-- feature:adcode.ai.provider -->
### Provider

Choose included Tagflow AI, a provider with your own key, or a local model.

Why use it: Use your account's included allowance when available, or choose your own provider and budget for another model.

How to use it: Included AI is selected by default on a new installation when enabled. Sign in with a verified account and chat without a key. Open Connect a model: Free · no API key lists included and ready local models; Bring your own key lists providers for your own keys. ADCode checks your key before saving it in your operating system's password store. Ollama runs on this computer and needs no key. Use a local model that supports tools for file tasks. If it prints a complete tool call as JSON, ADCode recovers the call and continues; invented tools get correction feedback. Repeated failed calls stop with an explanation. Your own provider requests go directly to that provider; included requests pass through ADCode's dedicated AI relay to the selected provider, which enforces your account allowance.

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

<!-- feature:ai.mcpSignIn -->
### Sign in to a connector

A remote connector that needs your account - Gmail's MCP server, for one - gets a Sign in button on its card in Tools. You sign in once in your browser, and every call the assistant makes to it carries your sign-in.

Why use it: Servers like Gmail's answer the first handshake without a key and then refuse every real call, so a connector looked connected and did nothing. These servers publish how to sign in to them; ADCode reads that and signs in the standard way (OAuth with PKCE), so there is no token to find, copy or paste - and none that quietly expires an hour later.

How to use it: Add the server on the Tools page (Add custom connector, with its URL - for Gmail, https://gmailmcp.googleapis.com/mcp/v1) and press Connect. When the server says it wants a sign-in, the card says so and its main button becomes Sign in. Run Tools: Sign In to a Connector to jump to it, or press it: your browser opens the server's own sign-in page, you approve the access it lists, and ADCode connects as soon as you are back - the button reads Finish in your browser while it waits, for up to three minutes. The sign-in is kept in the OS-encrypted store on this computer, separate from the connector's other values; ADCode refreshes it before it expires and once more if the server refuses a call, so you sign in again only when you revoke it. Sign out on the card forgets it, and so do Forget and Remove. A server whose sign-in offers no automatic client registration needs its OAuth client ID saved on the connector as OAUTH_CLIENT_ID (and OAUTH_CLIENT_SECRET if it issued one); Google servers use ADCode's own Google client. A saved Authorization value is used as it is, with no sign-in.

Access: `All Features → Sign in to a connector`; `Sign in to a connector`.

<!-- feature:ai.composerCommands -->
### Slash commands and @ files

Type / in the assistant's composer for ready-made commands like /review and /test, or @ to put any project file in the conversation.

Why use it: Typing is faster than hunting for a button, and each command asks the way an experienced engineer would - including checking its own work - so answers come back verified rather than guessed.

How to use it: Type / at the start of the composer to list every command; keep typing to filter, then press Enter or Tab. Or type a command and your words in one go - /fix the login button does nothing - and press Enter. The conversation and its title show /fix and your words, and the assistant receives the command's full instruction, so your history stays readable. /fix, /test, /plan, /refactor, /explain, /optimize, /security, /docs and /build send that careful instruction with whatever you add; on its own, a command is about the file you have open. /review and /commit attach your uncommitted changes and ask for a review or a commit message: picked from the list they go at once, and typed with words - /review focus on auth - they say what to look at. /check asks the assistant to look at your running app in its own browser and fix what is broken. /new, /history, /model, /preview and /schedule act at once, even while an answer is being written; /new with words starts a fresh conversation and sends them. /team followed by a task sets up an AI Team for it. /compact makes room in a long conversation, and /compact with words says what to keep. /sleep chooses what the computer does when the work is done, and /phone opens Phone link. Type @ anywhere to search the project's files and add one as a chip; a file open in the editor sends its unsaved text. In an empty composer, the Up arrow brings back your earlier prompts.

Access: `All Features → Slash commands and @ files`; `Show commands`; `Add a file`.

<!-- feature:ai.skillOrder -->
### Sort, pin and group skills

Put your skills in order: pin the ones you use, push rarely useful ones to the back, sort and filter the list, and turn a whole group on or off at once.

Why use it: Skills pile up - a few of your own, dozens that came with other tools and plugins. With eighty in the list you cannot find the three you use, and the assistant has the same problem: every enabled skill competes when it searches for one. Ordering them fixes both.

How to use it: Run Tools: Skills. Sort by Pinned first, Name, Where it came from, Smallest first or Enabled first. The chips above the list show each place skills came from with how many are on; press one to see only those, then Turn these on or Turn these off to switch the whole group. On a skill, Pin makes it a favourite: listed first, named to the assistant up front, and ahead of the rest whenever it matches. Last resort keeps a skill on but only offers it when nothing else fits. Search narrows the list as you type. Your ordering applies to every project.

Access: `All Features → Sort, pin and group skills`; `Sort and pin skills`.

<!-- feature:ai.statusAlerts -->
### Status alerts by email

Get an email when one of the included AI models starts failing requests, and another when it is back to normal. No account needed.

Why use it: When answers start failing, the first question is whether it is you or the service. An alert tells you before you start debugging your own setup - and the all-clear tells you when to try again, so you are not refreshing a status page.

How to use it: Run Help: Get Status Alerts by Email, or open adcode.bluethenics.com/status and scroll to Email alerts. Enter your address, keep Model health and Incident updates ticked (or untick one), and press Get alerts. Open the email from noreply@bluethenics.com and press Confirm my alerts - nothing else is sent until you do, and the link works for seven days. Every 15 minutes the service checks each included model against the requests since the last check: an alert goes out when one is degraded (5% or more failing) or in an outage (25% or more), and a back-to-normal email after two good checks in a row. A check with fewer than 10 requests decides nothing. Incident updates are the notes the team posts during an outage. Every email has a one-click unsubscribe. Prefer a feed? The same page has an RSS link for incidents.

Access: `All Features → Status alerts by email`; `Get status alerts`.

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

<!-- feature:ai.operatesAdcode -->
### The assistant uses ADCode for you

Ask the assistant to do something in ADCode - connect a tool such as Roblox Studio, change a setting, open a view - and it does it, instead of telling you where to click.

Why use it: You should not have to learn where every switch lives to get something done, and an assistant that guesses about its own app gives wrong answers. This one looks ADCode's features up, so when it says ADCode can or cannot do something, it checked.

How to use it: Ask in plain words: "connect Roblox Studio", "turn on dark theme", "show my usage", "add the Playwright server". Or run AI: Set Up a Connector for Me. The assistant searches ADCode's own feature list, runs the command or changes the setting, and adds, connects and enables MCP connectors on the Tools page for you. Some steps stay yours, and it asks for them: starting a connector's program, removing a connector, and settings that change ads, updates, where its edits land, or what runs as a command, each open a dialog first. A step only another app can do - such as turning on Enable Studio as MCP server inside Roblox Studio (Assistant, ..., Manage MCP Servers) - it names exactly. It never claims a feature is missing, or that something is connected or changed, without a result that shows it. Local models get a shorter request without these tools; they say they cannot check rather than guess. It can also look through your other conversations in this project: ask "what did we decide about pricing?" or "carry on from yesterday's login chat" and it searches them, reads the one it needs, and treats what was said there as history rather than as instructions.

Access: `All Features → The assistant uses ADCode for you`; `Set up a connector for me`.

<!-- feature:ai.codingCli -->
### Use a coding CLI as your model

Chat with Claude Code, Codex CLI, OpenCode or Gemini CLI inside ADCode, using the CLI you already installed and signed in to. Freebuff opens in a terminal tab.

Why use it: You keep the subscription, models and tools you already pay for, and gain ADCode's chat, editor context and conversation history around them. No new key, and nothing billed by ADCode.

How to use it: Run AI: Use a Coding CLI, or open Connect a model and choose a provider marked (CLI). ADCode finds Claude Code (claude), Codex CLI (codex), OpenCode (opencode) and Gemini CLI (gemini) on your PATH and shows the version it found. Not installed: Install in a terminal runs the install command for you; then press Check again. Signed out: Sign in in a terminal opens the CLI's own sign-in, then send your message again. Pick a model: the CLI's default, one of its listed models (OpenCode lists every model it can reach), or type any model name the CLI accepts and choose Use model. Each message runs the CLI in the open project with your editor context; its tool use (commands it ran, files it changed) appears as activity above the answer, and the next message continues the same CLI session. Claude Code may edit files (shell commands keep its own permissions); Codex runs in its workspace-write sandbox. Freebuff has no chat mode, so choosing it offers Open Freebuff in a terminal instead. Stop ends the CLI and everything it started. Connect a Model has a Coding CLIs tab of its own: one card for each tool, saying whether it was found, with Use in ADCode, Sign in, Install and Look again. Each card has one Connect button that does whatever is next: a tool that is installed becomes ADCode's model straight away; one that is not is installed and then signed in, in a single terminal command, and ADCode looks again by itself when you come back to the window; a terminal-only tool such as Freebuff opens in a terminal tab. Signing in again, another model and the docs are under More options. Move in and the welcome tour use the same button. Every model on your account, live: once a CLI is found, its card lists the models that CLI itself offers you right now - asked from Claude Code and Codex directly, the same list their own pickers show, and OpenCode's full list - with the CLI's own name and description for each. Press one and it is ADCode's model; the one in use is marked. Eight show first, and Show all lists the rest. When a CLI cannot be asked (signed out, an older version), its usual names are offered instead. Reasoning: when the CLI says which reasoning levels a model has, the level you pick for the chat (Auto, Low, Medium, High, Max) is passed to it as the nearest level that model has - Claude Code's --effort, Codex's model_reasoning_effort, OpenCode's --variant. Auto leaves it to the CLI. ADCode's own tools come along: when Let other AI tools use ADCode is on, every message gives Claude Code, Codex and OpenCode ADCode's tools for that run - the live preview, the page viewer and page audit, skills, your connectors, the Browser and ADCode's own features - so the CLI never answers that it cannot see your app. Gemini CLI reads tools only from its own settings file; add the copied config there.

Access: `All Features → Use a coding CLI as your model`; `Use a coding CLI`.

<!-- feature:ai.agentTools -->
### What the assistant can do

The assistant can change files, run project checks, inspect responsive layouts and accessibility, keep a dev server running, show its plan as a checklist, and ask you a question with choices when the decision is yours.

Why use it: When it cannot do a job with a proper tool, an assistant improvises with shell commands no Undo can reverse, gives up on anything slower than half a minute, or tells you to run the server yourself. With the right tools it just does the job, and you can put it back. And when a decision really is yours, the question arrives as a card with the choices laid out, not buried in a paragraph.

How to use it: Nothing to set up - ask for what you want. Deleted, moved and renamed files are part of the turn's Undo: the Changed files card under the answer lists them, deletions struck through, and Undo puts every one back, images included. A dev server or watcher runs in the background while the assistant keeps working, reads what it prints and looks at the address it serves; it stops when you close the folder or quit. Commands may run for up to ten minutes and report their real exit code, and Stop ends a command and everything it started. For a bigger job the assistant keeps a Plan card in the conversation, ticking steps off as it goes. When something is genuinely yours to decide - which of two designs, where a file should live, what the wording should say - it asks in a question card: up to four questions, each with choices to pick from (pick several where that makes sense), a box to answer in your own words, and Dismiss to tell it to carry on with its best guess instead of waiting. Its search shows the lines around each match and finds code as plain text, edits survive a mismatch in indentation, it can look at images in your project, and web pages it reads for documentation come back as clean text. Every tool is listed in plain words on the Tools page under Built-in - run Tools: The Assistant's Built-in Tools. Deleting and moving work when AI edits apply automatically; in review mode the assistant says what to move instead.

Access: `All Features → What the assistant can do`; `Show the built-in tools`.

<!-- feature:adcode.power.whenDone -->
### When the assistant finishes: sleep or shut down

Once every chat has finished its work, ADCode can put your computer to sleep, hibernate it, shut it down or lock the screen - after a countdown you can cancel.

Why use it: A long job is a reason to walk away, and then the computer stays on all night with nothing left to do: a drained laptop battery, a warm room, a desktop burning power. You should not have to come back just to turn it off.

How to use it: In the chat box, open Tools (the sliders button) and choose When done, or type /sleep. You can also run AI: When the Assistant Finishes, or click the status bar's reminder once it is on. Pick Sleep, Hibernate, Shut down or Lock the screen, and whether to do it only the next time (the default, so it never surprises you tomorrow) or every time. ADCode waits for the last working chat - one chat finishing while another still works does not count - and never acts when you pressed Stop yourself, because then you are at the computer. A finished or failed turn starts a countdown (one minute by default; change it in Settings > AI > Countdown before it happens) shown over the whole window, with a system notification as well. Cancel, Escape or Enter stops it, and so does any chat starting to work again. Before a shutdown or hibernate, ADCode saves every open file first. With Phone link on you can arm it, change it or cancel the countdown from your phone. Windows, macOS (no hibernate) and Linux; the web version has no computer of yours to put to sleep. If the computer refuses (a policy, or Linux without permission to suspend), the countdown ends and the debug log says why.

Access: `All Features → When the assistant finishes: sleep or shut down`; `Choose what happens`; `Cancel the countdown`; `Settings`.

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

How to use it: On by default. Open the Source Control panel in the activity bar. Tick the changes you want in this set - that is 'staging' - write a short note saying what you did, and press Commit. The Changes panel (Changes on the Vibe window's rail) shows the same work Cursor-style: an uncommitted +added −removed total, one row per file with its count, a revert arrow and an include checkbox, the diff one click away, and Commit & Push, which commits and pushes in one go and writes the message if you leave it empty.

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

<!-- feature:workbench.webVersion -->
### ADCode on the web

Open ADCode in a browser at web.bluethenics.com. Chat and saved conversations open without waiting for a coding workspace. Connect GitHub to read a project, prepare changes, and review a pull request.

Why use it: Start discussing an idea or reviewing a repository without installing an app or reserving a cloud computer. Your code stays on GitHub, and you choose when a proposed change becomes a pull request.

How to use it: Sign in with Google, GitHub or email. Start chatting with included AI, or choose Connect GitHub and authorize the code on GitHub. Select a repository and branch, then ask about the code or request a change. Review Proposed changes and choose Create pull request to save them on a new branch. The assistant can read code and prepare edits here; it does not run tests or commands. Open cloud workspace is optional for execution and previews, with shared capacity and budget limits. Your GitHub proposals are not automatically copied into that separate workspace. Saved chat history and your account remain available even when coding capacity is full.

Access: `All Features → ADCode on the web`; `Open ADCode on the web`.

<!-- feature:community.addons -->
### Add-ons

Small panels a plugin adds to the chat, the sidebar or the status bar - a usage meter, a focus timer, one-click prompts.

Why use it: The thing you check twenty times a day should sit where you are already looking, not one menu away.

How to use it: Open Plugins › Discover and choose Add-ons, or install one from Made by ADCode: Usage meter and Quick prompts sit above the chat's message box, Git at a glance in the sidebar, and Focus timer, Problems at a glance and Earnings ticker in the status bar. Each runs sealed in a frame of its own: it has no internet, cannot read your files or account, and sees only the data listed when you install it - your AI usage as a percentage of this session's and this week's allowance with your plan, how full the open conversation is, whether you are signed in, the branch and changed-file count, the open file's name and line, its error count, the project name, the model or your earnings. Its buttons can run only the ADCode commands it declared, and it can put a prompt in the message box but never send one. To build one, choose Add… › Add-on in the Studio: write HTML and an inline script that uses adcode.on("data", …), adcode.run(…), adcode.prompt(…), adcode.store and adcode.options. Turn a plugin off on the Installed tab to remove its add-on.

Access: `All Features → Add-ons`; `Browse add-ons`.

<!-- feature:workbench.agentsBoard -->
### Agents board

Hand tasks to AI agents that work at the same time, each in its own copy of your project, and follow them as boxes in Working, Needs you and Ready.

Why use it: One assistant doing one thing at a time keeps you waiting. Several agents can fix a bug, write tests and polish a page at once while you keep chatting, and each box shows at a glance which one is busy, which one needs you and which one is done - no scrolling back through a transcript to find out.

How to use it: Choose Agents on the Vibe window's rail, or Open Agents from the command palette (in the IDE window it opens as a large popup). Press New task, describe what you want, pick an agent - or keep the default, your connected model with every tool - and optionally a cost cap, then press Enter. The task appears as a box under Working with its agent's mascot, what it is doing right now (such as Editing src/app.ts), how long it has run, the files it touched, its tokens and - when the model's price is known - its cost. Start as many as you like: the number working at once follows Agents working at once in Settings, and the rest wait as Queued. Each agent works in an isolated copy, so nothing reaches your project until it finishes. With Apply automatically on, finished work lands straight away and its box offers Undo and Continue; with Review every change it waits under Ready with Review, Apply, Apply & continue and Discard. Needs you collects anything that cannot go on without you: a clash with your own edits (Resolve), an error (Run again, or Open in chat to talk it through), a spent cost cap (Run with a higher cap) and runs paused when ADCode closed (Resume). Every finished box shows its proof of work: the tests, type checks and linters the agent actually ran, with a tick or a cross, and warnings about its change - a possible secret, sign-in or payment code, removed tests, new dependencies or a very large change. With Apply automatically on, a run with a failed check or a possible secret is held under Ready for you to look at instead of applied. If an agent keeps trying the same failing thing, ADCode stops it and the box offers Try another way. When two agents edit the same file, both boxes warn you before their work collides. A cost cap set on a task, or a usual cap saved on the agent, shows as spend against the cap, and the header shows your ad earnings beside today's agent spend. Select a box to see what it reported, the files it changed, its proof of work and every step it took. Today's finished runs fold under Finished today. Your agents lists saved specialists - Run gives one a task, Edit changes its name, look, instructions, model and the tools it may use, Duplicate copies it, and New agent adds one. Five starter agents are added the first time. Select for a Team picks two to four agents to split one task; press Start on its box to begin.

Access: `All Features → Agents board`; `Open Agents`; `New task`.

<!-- feature:workbench.allFeatures -->
### All Features

A searchable library of everything ADCode can do, with an Open button and a plain explanation beside every feature.

Why use it: You should not need to know a command's name, shortcut, or menu before you can discover it.

How to use it: Choose All features at the bottom of the Vibe sidebar, or open the menus - the button beside ADCode - and choose View, All Features. Search by a feature name or describe what you want to do. Choose Open to use it and ? to understand it. Preferences opens Settings, where sections sit in a sidebar - Ads & Earnings, Appearance, Editing and the rest - and one shows at a time; the search box looks through every section and counts the matches in each.

Access: `All Features → All Features`; `Open`; `Preferences`; `Full screen`; `Toggle side bar`; `Toggle panel`; `Problems`; `Output`; `Ports`; `Feature guide`; `About ADCode`.

<!-- feature:workbench.annotate -->
### Annotate a page

Click things on a page in the Browser or the Preview, type what should change, and send it all to the chat as a marked-up screenshot.

Why use it: "Make this blue" needs a "this". Numbered pins tell the assistant exactly which element you mean - its tag, its words and a selector - so you never have to describe a layout in words.

How to use it: Press Annotate in the Browser or Preview toolbar (the arrow with a sparkle), or run Annotate a Page from the command palette. A line at the bottom says what to do. Click anything on the page: a big numbered pin drops on it and a note opens - type the change and press Enter. Drag instead of clicking to box an area. Scroll as usual; pins stay on their element, and a pin whose element has gone fades. Clicks while annotating never press the page's own buttons or follow its links. Hover a note in the list to find its pin, and the other way round; click a pin or its row to edit or delete it, and Clear all removes every pin. Send to chat (with the number of pins) puts a screenshot with the pins drawn on it and the numbered list into the chat box - it is not sent until you press Send, so you can add more. Esc or Done leaves annotate mode.

Access: `All Features → Annotate a page`; `Annotate this page`.

<!-- feature:community.artifacts -->
### Artifacts

Share a project, or build one together with friends - everyone's AI works from the same plan. Friends join with an invite code; anyone else can make their own copy and send changes back.

Why use it: Getting help usually means giving someone access to your repository. An artifact lets strangers improve your project without any access at all: you see every changed line and decide. A live room goes further: friends join the project itself, edit the same files at the same time, and see each other's file and caret. No branch, no merge, no GitHub checkout.

How to use it: Choose Artifacts in the Vibe sidebar. The Start tab asks what you want to do, with three choices. To build with friends, open your project folder and press Start working together under Work together on this project. The first time, ADCode shows exactly what will be shared and starts it as Private - only the project's own text files go: anything your .gitignore leaves out, hidden folders like .local and .config, .env files, keys, node_modules, build output, images and lockfiles stay on your machine, a file that looks like it holds a key is listed with Leave these files out, and a home folder or whole drive is refused. Press Share and start, and ADCode opens a team room, starts live editing and shows your invite code with a big Copy code button: send it to your friends, or press Copy a ready-made message for one that also says how to install ADCode. To join a friend, paste what they sent into the box under Join a friend and press Join - the code alone, the code without its adartifact: start, or their whole message all work. If nobody is working in that project right now, you are offered Make my copy instead. Otherwise ADCode downloads the project to Documents -> ADCode Projects (once), opens it and joins, and says You joined ... Your changes sync live. Find a project to copy takes you to All shared projects: press Make my copy on any card, change it, then open This project and press Send your changes back (Ask AI to describe it writes the message). Sent to you lists changes people sent you; open one to see every changed line, Ask AI to review it, then Accept or Decline with a reply. Accepting makes the next version and credits its author; Get version N on This project brings it into your folder, leaving files you edited meanwhile alone. Owners find the code again under Invite code on This project, where Make a new code stops an old one working and Who can open it switches between Public and Private. Open Team room on This project at any time. Right now at its top shows who is here, the invite code with Copy code, the plan's next step (I will do it takes it) and a box to talk to everyone. Below are Start live editing or Stop live editing for the owner and Join live editing for guests, the live editors list with each person's file and line (Go to opens that place; the host switches people between Can edit and View only), The plan, and People and their AI with four join checks - your role, a free seat, push access and an available AI; Watch only joins read-only and Join as editor switches back. More team tools folds away the rest, each with a one-line explanation: Session (the one branch and task), Coordination (warnings when two people touch the same file, and file locks), Approvals (ask before a push, a command, network use or a takeover; another owner or editor answers and the first answer wins), Handoffs (the branch, plan and fresh notes go to one teammate), Shared Brain (notes pinned to files with a commit), Comments (on a file, a diff hunk, a session or a transcript moment; one can become a plan step or a prompt to your AI) and Activity. A note or comment whose file moved on is labelled, never deleted. The host's copy autosaves every four minutes, and no GitHub checkout or merge is needed. The Live button beside any chat's message box is the same session from the chat: Start live session, Join on an open session, or paste the invite code under Join with code. Start also lists Live now, projects Asking for help, and Other things you can do. Close room makes the room read-only; start it again later.

Access: `All Features → Artifacts`; `Browse shared projects`; `Share this project`; `Changes sent to you`.

<!-- feature:workbench.aiContext -->
### Ask AI about your code

The assistant already sees the file you are on, your cursor, your selection and the editor's errors. Ctrl+L adds a selection to the conversation as a chip.

Why use it: "Fix this" and "what does this function do" should just work. Ask about unsaved code, prepare a refactor, find issues or write tests without copying between tools.

How to use it: Nothing to switch on: every message carries the file you are looking at, the cursor line, any selected code, your open tabs and the errors and warnings the editor reports, so the assistant knows what "this" means. Select code and press Ctrl+L, or right-click and choose ADCode: Add Selection to Chat, to put it in the composer as a chip without sending - then ask your question. With nothing selected, Ctrl+L still selects the line as usual. Right-click for Explain, Refactor, Write Tests and Find Issues, which prepare instructions you edit before sending. In Vibe mode the editor is hidden, so only file names and errors are shared, never a stale selection.

Access: `All Features → Ask AI about your code`; `Add to chat`; `Ask AI`; `Explain`; `Refactor`; `Write tests`; `Find issues`; `Keyboard → Ctrl+L`.

<!-- feature:workbench.browser -->
### Browser

A real web browser inside ADCode, with tabs, an address bar and your sign-ins, that you and your assistant can both use.

Why use it: Docs, a dashboard, your deployed site, a form to fill in: they all used to mean leaving the editor, and the assistant could not follow you there. Here the page sits beside your work, and you can hand a web task to the assistant and watch it happen in the same tab, then take over the moment you want to.

How to use it: Run Open Browser from the command palette, or pick Browser in the workspace menu. Type an address or a search in the bar; Ctrl+T opens a tab, Ctrl+W closes one, Ctrl+L goes to the address bar, Ctrl+R reloads. Sign-ins are kept between launches, in a store of their own that your everyday browser never sees. To let the assistant use it, just ask: "open the Supabase dashboard and find my project URL", "search for the Stripe webhook docs and summarise them". It opens the panel, a green outline and an Assistant is browsing label show while it acts, and you can click into the page at any time. It reads a page as a list of its buttons, links and fields and acts on those, the way agent-browser does. It is told never to type passwords or card numbers; type those yourself. Links in chat replies open here. Downloads are off in this browser, and a page asking for your camera, microphone or location is refused. To sign out of everything, run Browser: Sign Out of Everything and Clear Its Data. The web version shows snapshots of the assistant's own page instead of a live browser.

Access: `All Features → Browser`; `Open Browser`; `Sign out and clear its data`.

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

How to use it: Choose Changes on the Vibe window's rail, or Show Workspace Changes in the command palette; it opens as a floating window you can move, resize and maximise. The bar at the top shows the uncommitted +added −removed total, the branch and Commit & Push; the line under it always says which files the next commit takes. Each row is a file with its line counts, a New or Deleted tag, a revert arrow and a checkbox. Select a file to see its diff - a new file shows its whole contents. Untick a file to leave it out of the next commit; while every box is ticked, Commit & Push takes every file. Commit & Push commits and pushes in one step, with a message such as Update css/app.css and 2 more files when you have not written one; the arrow beside it offers Commit only and Write the commit message. A project not yet connected to GitHub is committed on this computer, and the panel says how to connect it. The revert arrow asks first, then puts an edited file back as it was at the last commit, or moves a new file to the Recycle Bin. The branch button switches branch; the ⋯ button holds Include everything, Pull, Push, Revert all changes and Source Control. In a folder without Git, Turn on version control starts tracking it. On a drive that does not record who owns files (FAT32 or exFAT, most USB sticks), Git refuses a repository until the folder is trusted: one ADCode just created is trusted for you, and for any other the panel says Git needs your OK and offers Trust this folder - trust only folders you made or got from someone you trust, because a repository can run its own scripts. Work from Review mode or an AI Team that is waiting to be applied appears at the top of the panel.

Access: `All Features → Changes panel`; `Open Changes`.

<!-- feature:workbench.commandPalette -->
### Command palette

One box that can run anything ADCode does. Type what you want rather than hunting a menu.

Why use it: There are hundreds of commands and no menu can hold them all. If you can name it, you can run it.

How to use it: Press Ctrl+Shift+P and start typing. The shortcut for each command is shown beside it, so it teaches you the keys as you use it.

Access: `All Features → Command palette`; `Open`; `Keyboard → Ctrl/Cmd+Shift+P`.

<!-- feature:community.profile -->
### Creator profile

Your level, points, badges and streak, plus everything that happened to what you shared: installs, stars, remixes and improvements.

Why use it: Seeing that forty people installed your plugin, or that your fix was accepted into someone's project, is the reason to build the next one.

How to use it: Open Plugins › Your plugins or Artifacts › Your shared projects, or click the level chip beside the search box. Points come from installs (1), stars (3), remixes (5), each plugin or artifact you publish (10), and each improvement of yours someone accepts (20). Levels run from Newcomer to Legend; the bar shows how far the next one is. Badges mark firsts and milestones, and the streak counts days in a row you published, remixed or improved something. Each page lists its own activity, and the sidebar entries show a count when something new happened. Open one of your plugins to edit it as the next version, or unpublish it - people who installed it keep their copy.

Access: `All Features → Creator profile`; `Open my profile`.

<!-- feature:workbench.floatingPanels -->
### Floating panels

Changes, Preview, the project overview, Team activity and the IDE's assistant open as windows floating over your work instead of sidebars.

Why use it: A sidebar takes a column from the editor or the conversation for as long as it is open. A floating panel sits over the work only while you need it, goes where you put it, and gives the full width back the moment it closes.

How to use it: Open a panel as usual - Changes or Preview on the Vibe window's rail, Project overview from the project card, Ctrl+I for the assistant in the IDE. Drag it by its title bar, resize it from any edge or corner, and double-click the title bar or press Maximise to fill the window; press it again to restore. Escape or the close button hides it. Each panel remembers where you left it, and if the window shrinks it is pulled back so its title bar can always be reached. Several can be open at once; clicking one brings it to the front. On a narrow window panels open full-size instead.

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

How to use it: Keyboard shortcuts at the bottom of the Vibe sidebar, or Help, Keyboard Shortcuts. Search for a command, click its keys, and press the combination you want. Conflicts are pointed out rather than silently taking over.

Access: `All Features → Keyboard shortcuts`; `Open`.

<!-- feature:workbench.collab -->
### Live collaboration

Someone else can open the same files at the same time and you both see each other typing.

Why use it: For fixing something together without one of you reading the other's screen over a call.

How to use it: Open a project connected to GitHub, choose the live-session button on the sidebar, and share its invite. Keep the host app open. The connection uses ADCode’s encrypted internet relay and expires after 24 hours. New guests join view-only; grant edit access in People. Guests can open shared files and use their own AI models to read or edit the host’s current files. Guest commands and private memory are unavailable. The host reviews commits and pushes to GitHub. End session revokes the invite.

Access: `All Features → Live collaboration`; `Leave session`.

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

How to use it: Choose Open IDE at the bottom of the Vibe sidebar - in a narrow window, open the drawer with the top bar's menu button or Ctrl+B first. ADCode opens one editor-first IDE window and focuses it on later clicks. The Vibe window stays open; use Vibe in the IDE toolbar to return to it.

Access: `All Features → Open IDE in a separate window`; `Open IDE in a separate window`.

<!-- feature:workbench.openSource -->
### Open source licences

ADCode's code is open source. This shows the licence it is shared under, and the licences of the other open-source software built into it.

Why use it: So you can check what you are allowed to do with ADCode - use it, read it, change it, share it - and see exactly which other projects it is built on, without leaving the editor.

How to use it: Choose Help > Open Source Licences. The first tab is ADCode's own licence, the Apache License 2.0. Notice names the copyright holder. Third-party lists every package built into ADCode with its licence text. The source code is at github.com/bluethenics/adcode, where you can read it, report a problem or send a change. The ADCode name and logo are not covered by the licence, so a changed copy has to use its own name.

Access: `All Features → Open source licences`; `Show licences`.

<!-- feature:community.studio -->
### Plugin Studio

Make your own plugin, or your own version of any built-in feature, and share it with everyone.

Why use it: When ADCode does something almost the way you want - a /review that is not strict enough, a panel you wish was always visible - you can change it yourself, and everyone with the same wish can use your version.

How to use it: Open Plugins › Studio. Describe a plugin and press Build with AI: the assistant writes adcode-plugin.json in the open project, then Load adcode-plugin.json brings it in. Or use Add… to insert an add-on, AI action, slash command, skill, macro, theme or setting preset, and edit the JSON; the panel beside it lists anything to fix and previews what the plugin adds. Give your plugin its own settings with an "options" list - toggles, numbers, text or choices - and people change them on the Installed tab; add-ons read them as adcode.options, and prompts use them as {{option-id}}. To change a built-in feature, choose Customize a built-in feature…, or Customize on any card in All Features: its switches become a preset, its commands a macro, and its chat commands (/review, /commit and the rest) overrides whose instructions you can rewrite. Open any plugin made by ADCode in the Studio to see how it is built. Try it here installs it on this computer only. Publish puts it in the directory under your name; publish again with a higher version to update everyone who installed it. Save to project keeps the file with your code.

Access: `All Features → Plugin Studio`; `Build a plugin`; `Customize a built-in feature`.

<!-- feature:community.plugins -->
### Plugins

Add-ons for ADCode that you install with one click: AI actions, chat commands, skills, themes, and small panels for the chat, sidebar and status bar.

Why use it: Someone has probably already written the prompt, checklist or panel you were about to make. Installing theirs takes seconds, and turning it off is just as fast.

How to use it: Choose Plugins in the Vibe sidebar (in the Code window, run Plugins: Browse from the command palette). Discover starts with eight plugins made by ADCode - Usage meter, Quick prompts, Git at a glance, Focus timer, Problems at a glance, Earnings ticker, Strict reviewer and Explain simply - which install without an account, then the community directory by category. Open any plugin to see exactly what it adds before installing. AI actions appear in the command palette (Ctrl+Shift+P), chat commands behind / in the chat, skills are used by the assistant when a task matches, add-ons appear where they belong, and a theme recolours the app. Installing shows its progress on the button - Downloading, then Installing - and ends with a check. The Installed tab turns each plugin on or off, updates it and uninstalls it; turning one off puts back any setting it changed. Settings, on a plugin's row, changes the options its creator gave it, such as a timer's length; changes apply at once. Versions lists every published version with its notes: install an older one and ADCode keeps it there, offering no updates until you switch Keep this version off. Plugins cannot change your model, keys, ads, updates or tool approvals. Report sends a community listing for review; five reports hide it.

Access: `All Features → Plugins`; `Browse plugins`; `Installed plugins`.

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

How to use it: Press Run - at the right end of the tab row in the Vibe window, in the status bar in Code. If the tool it needs is not installed, ADCode says which one and where to get it rather than failing with an error you have to decode.

Access: `All Features → Run`; `Run`.

<!-- feature:community.monetize -->
### Sell your plugins (coming soon)

Soon you will be able to put a price on a plugin and get paid for it. You can join the waitlist today.

Why use it: If you build something people rely on every day, you should be able to earn from it. Joining now tells us what price creators want and puts you first in line.

How to use it: Open Plugins › Studio and find Sell your plugins at the bottom of the right-hand column, or the same card on Your plugins. Enter the price you would charge, or leave it empty, and press Join the waitlist. The card shows your place in line and how many creators are waiting. Selling is not available yet: every plugin in the directory is free, and plugins that are free today will stay free.

Access: `All Features → Sell your plugins (coming soon)`; `Join the waitlist`.

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

Everything the assistant and your agents can use, as cards: ADCode's own tools, connectors from other AI tools (MCP servers, Claude extensions, Claude Code plugins, OpenAI actions), skills and project memory.

Why use it: Agents are who; tools are what. Seeing which agent may use which tool, why a server is not working and what the assistant remembers - in one place - beats hunting through settings and config files. Connectors you already set up in Claude, Cursor, Windsurf or VS Code are read where they live, never moved or changed.

How to use it: Choose Tools on the Vibe window's rail, or Open Tools from the command palette. Built-in lists ADCode's tools in plain words, grouped by what they do, and says which agents may use each one. Connectors shows each one with a badge saying what it is - MCP, Extension, Plugin or Actions - a health light, its tools and uses, and, when something is wrong, what to do about it; Tools on a connected server turns individual tools on or off, and Retry reconnects. Add custom connector on the Connectors tab saves a server by name and URL and tries to connect it; Add connector offers four ways in: Catalogue for servers that work in one click, such as Playwright for testing pages in a real browser, Context7 for current library docs and Roblox Studio for working in the place you have open; Import scans what Claude Desktop, Claude Code, Cursor, Windsurf and VS Code already have; From a file reads a config file, an OpenAPI description, a chat-plugin manifest, a .mcpb extension or a plugin folder, or takes a link or pasted text; Custom connector is the same form, with a local command, SSE and credentials under Advanced. On the web, Import scans only the private cloud workspace, not apps on your computer; Link or text accepts a link, pasted config or a path to a file or plugin folder already in that workspace. What is found waits as a dashed card; nothing is installed until you press Add, and the Add dialog asks for any values it needs and keeps them in the encrypted store on your computer or in your private cloud workspace. Extensions and plugins are copied into ADCode's own folder - hooks are copied but never run - and Remove deletes those files with the connector. Skills turns written routines on or off, previews them, and creates new ones. Memory shows what the assistant has learned. Search filters every tab at once.

Access: `All Features → Tools page`; `Open Tools`; `Add a connector`; `Connectors`; `Skills`.

<!-- feature:workbench.universalSearch -->
### Universal search

The search button at the top of the Vibe sidebar finds ADCode features, commands, files, recent folders, and symbols together.

Why use it: One search is faster when you remember what you want but not which menu, panel, or file contains it.

How to use it: Choose the search beside ADCode and type a name or goal. Use the arrow keys and Enter to open a result. Start with > for commands. Ctrl+P, Ctrl+Shift+P, Ctrl+T, and Ctrl+Shift+F still open their focused searches.

Access: `All Features → Universal search`; `Search`.

<!-- feature:workbench.modes -->
### Vibe and Code modes

Vibe is the default conversation window. Code opens as a separate IDE window for the same project.

Why use it: Keep planning and editing visible at the same time, with each window sized for its own work.

How to use it: Start in Vibe and choose Open IDE at the bottom of the Vibe sidebar to open or focus the Code window. Use Vibe in the Code toolbar to return to the conversation window. Opening a file, Browse files in the IDE or Search in files from Vibe opens the IDE on exactly that. Both windows follow the same project; Code restores its editor tabs.

Access: `All Features → Vibe and Code modes`; `Vibe`; `Code`; `Project`; `AI tasks`; `Preview`.

<!-- feature:workbench.vibeSidebar -->
### Vibe sidebar

The left side of the Vibe window: a rail of places, a card for what you are working on, and a tab for each conversation.

Why use it: Vibe hides the editor, so something has to tell you that an agent is still working or what has changed. The Changes badge says so without opening anything, and every everyday workflow has a button of its own instead of hiding in a menu.

How to use it: The rail on the far left is the places. The ADCode mark returns to the conversation. Chat, Agents and Tools are the page in the middle of the window: Chat is the conversation, Agents is the board of agents working in parallel and your saved agents, and Tools is where built-in tools, MCP servers, skills and project memory live. Changes, Preview and Automations open over the page as floating windows, and selecting one again closes it; the badge on Changes counts the files you have not committed, and turns blue when something needs you, such as a conflict or - if you chose Review every change - AI edits waiting to apply. At the foot of the rail: notifications, an update while one is downloading, settings, More for everything else, feedback, your account, and - on the desktop - the live-session button. The card beside it starts a conversation (Ctrl+Shift+N) and keeps the earlier ones under Chats, grouped by day and searchable. The project card shows the folder, its branch and how many files have changed - select it to switch to a recent project, open or clone one, or see the project overview. Docs, All features and Keyboard shortcuts sit at the bottom of the card, above the Open IDE card. Every open conversation gets a tab along the top; use the mouse wheel over that row to reach tabs that do not fit. Changes, Preview and the sidebar toggle sit to its left and the workspace picker and Run to its right; the menus (File, Edit, View, Help) open from the button beside ADCode. Drag the sidebar's right edge to resize it, or press Ctrl+B to hide or show it. In a narrow window everything folds into a drawer that the top bar's menu button or Ctrl+B opens.

Access: `All Features → Vibe sidebar`; `Show or hide`; `Keyboard → Ctrl+B`.

<!-- feature:workbench.welcome -->
### Welcome: what do you want to build?

The first screen asks what you want to build, gets the AI connected if it is not, and builds it.

Why use it: The fastest way to know whether a tool is any good is to watch it make the thing you had in mind.

How to use it: On first launch, type your idea or pick one of the ideas under the box, then press Build it or Enter. If no AI model is connected yet, the next step offers a free one. ADCode then makes the project, opens it and sends your idea to the assistant. Skip or Escape closes it at any time; Open a folder uses a project you already have. Run Show Welcome from the command palette to see it again. Theme, ad frequency and account are in Settings. From ADCode 2.6 a short welcome tour comes first: four steps over an animated dot field for the AI you already pay for, your conversations from other tools, and your apps, each one optional. Skip leads straight to the question. If you were already using ADCode when 2.6 arrived, the tour shows once to set those up; run Show the Welcome Tour to see it again.

Access: `All Features → Welcome: what do you want to build?`; `Show welcome`.

<!-- feature:workbench.cloudWorkspace -->
### Your cloud workspace

The optional cloud workspace runs projects, commands and previews. Browser chat, its saved history and GitHub access work separately. This panel manages the running workspace's saved projects, downloads and GitHub credentials.

Why use it: Your cloud workspace has no personal running-time quota. You can take your work with you or remove it whenever you choose.

How to use it: Run Cloud Workspace from the command palette. There is no personal time quota. Shared service capacity still applies. Your workspace sleeps a few minutes after you stop using it, or 15 minutes after you last touched an open tab, unless an agent is still working. Your workspace is saved when it sleeps and comes back exactly as you left it. Download gives a project as a .tar.gz without node_modules. Connect GitHub lets Commit & Push and private imports work. Delete my cloud workspace removes every project and conversation in the cloud for good; your account and earnings stay. Workspaces nobody opens for 90 days are deleted.

Access: `All Features → Your cloud workspace`; `Open Cloud workspace`.

## Appearance

<!-- feature:adcode.appearance.theme -->
### Appearance

Warm light, charcoal dark, or midnight. System follows your computer's appearance.

Why use it: Dark is easier at night, light is easier in daylight, and following the system means you never think about it.

How to use it: Light is the default for new installs. Choose Dark, Midnight, or System in Settings. Your explicit preference stays selected across modes.

Access: `All Features → Appearance`; `Settings`.

<!-- feature:ai.chatAppearance -->
### Customise chat

Choose the assistant's name and face, whether replies show who wrote them, and how replies sit on the page.

Why use it: A chat you spend hours in should look the way you like. Faces and names also make it obvious which agent said what once several are working.

How to use it: Select Customise in the chat's header (or ••• when the chat is docked), or run AI: Customise Chat from the command palette. Type a name, pick one of eight shapes and ten colours, and choose a reply style: Document runs replies full width, Bubbles puts each in a soft card, Compact fits more on screen. Show who is replying adds the face and name above replies; while a reply is still being written the name stands alone, because the face at work is the mascot in the timeline heading. A live preview shows the result before you save. Saved agents keep their own look - change theirs in the agent editor on the Agents board. Every choice is also in Settings > Appearance.

Access: `All Features → Customise chat`; `Customise`; `Turn on or off`; `Settings`.

<!-- feature:adcode.appearance.density -->
### Density

How much space there is between things. Comfortable is roomier; compact fits more on screen.

Why use it: Generous spacing looks good on a large monitor and wastes a laptop screen.

How to use it: Pick Comfortable or Compact. It changes immediately, everywhere.

Access: `All Features → Density`; `Settings`.

<!-- feature:adcode.appearance.mascots -->
### Mascots

Whether Buck, ADCode's mascot, and the agents' little characters are shown.

Why use it: They make the app friendlier and say at a glance how work is going, but some people want a quieter screen, especially when recording or sharing it.

How to use it: On by default. Open Settings, choose Appearance, and switch Mascots. Off hides every mascot at once - Buck in the chat, the welcome tour, the Browser, Apps and Move in, and the agents' faces on the board - and keeps the words beside them. To keep them but stop them moving, set Motion to Reduce instead.

Access: `All Features → Mascots`; `Turn on or off`; `Settings`.

<!-- feature:adcode.appearance.motion -->
### Motion

Turns the window's animation down or up: messages rising in, mascots moving, and code typing into live windows.

Why use it: Movement helps some people follow what changed and makes others feel unwell or distracted. Your computer may already have a reduce-motion setting; this lets ADCode follow it or not.

How to use it: Settings > Appearance > Motion. Follow system uses your computer's reduce-motion setting. Reduce keeps everything still and shows changes at once - live windows show the finished code instead of typing it. Full keeps the animation even when the system asks for less.

Access: `All Features → Motion`; `Settings`.

<!-- feature:adcode.appearance.textSize -->
### Text size

Makes the words you read bigger or smaller - code in the editor, the terminal and chat messages - while the rest of the window stays the same size.

Why use it: When the code is hard to read, zooming the whole window costs you sidebar and panel space for nothing. Text size grows only the reading text.

How to use it: Press Ctrl+Shift+. (the > key) for bigger text and Ctrl+Shift+, (the < key) for smaller - the same keys Word uses for font size. View > Appearance > Reset Text Size goes back to Default. Settings > Appearance > Text size has five sizes from Small to Largest. It applies at once to every editor, terminal and chat, and is kept for next time.

Access: `All Features → Text size`; `Bigger text`; `Smaller text`; `Reset text size`; `Settings`; `Keyboard → Ctrl/Cmd+Shift+.`.

<!-- feature:adcode.appearance.zoom -->
### Zoom

Makes the whole window bigger or smaller - menus, panels, buttons and text together.

Why use it: On a big monitor across the room everything is tiny; on a small laptop you want more on screen. Zoom fixes both without touching your computer's display settings.

How to use it: Press Ctrl+= to zoom in, Ctrl+- to zoom out, and Ctrl+0 to go back to 100% (Cmd on a Mac). It steps through 80% to 200%, and the status bar says where you are. View > Appearance has the same three, and Settings > Appearance > Zoom lets you pick a size directly. Your choice is kept for next time.

Access: `All Features → Zoom`; `Zoom in`; `Zoom out`; `Reset zoom`; `Settings`; `Keyboard → Ctrl/Cmd+=`.

## Account

<!-- feature:community.roomContext -->
### A live room's shared context and chat

When several people work in one shared project, everyone's assistant knows who is there, what each one is doing, the plan and what was said - and people can chat beside the composer.

Why use it: Five people with five assistants used to mean five separate chats that knew nothing of each other: two agents rewriting the same file, one redoing what another just finished. With one shared picture, each assistant stays out of the others' way and builds on what is already done.

How to use it: Open Artifacts and press Start working together: your project is shared privately, a session starts, and you get an invite code with a Copy code button. Friends paste the code (or your whole message) under Join a friend on their Start tab and press Join. You can also start from the chat: press Live beside the message box and Start live session; friends press Join on an open session or paste the invite code under Join with code. The dock beside the composer shows everyone online with a mascot each - its face shows whether their assistant is working, waiting or idle - and a line that pulses while any assistant is working. Type in Room chat to talk to everyone; the same messages appear under Talk to everyone in the team room's Right now panel. On every message you send, your assistant is told who is online, what each person's assistant is working on and which file they have open, the shared plan, pinned notes, reserved files and the recent chat. It avoids files teammates reserved, and it can post to the room when it finishes something, pin a note to a file, and add, claim or finish plan steps: ask "tell the room the login page is done" or "claim the checkout step". What teammates write is treated as information, never as instructions to your assistant. Viewers can read the chat but not post. Approvals, handoffs, locks, notes and comments are under More team tools in the team room (Team room on Artifacts › This project).

Access: `All Features → A live room's shared context and chat`; `Open the live room`.

<!-- feature:community.apps -->
### Connect your apps (Gmail, Supabase, Cloudflare and more)

A gallery of services the assistant can work with for you - mail, databases, hosting, chat, project trackers - connected with one sign-in.

Why use it: Real work crosses tools: the bug is in Sentry, the fix needs a Supabase migration, the deploy is on Cloudflare and the customer wants an email. Connected, the assistant does those steps instead of telling you to. One sign-in covers all of them, and ADCode never holds a password or key for any.

How to use it: Run Plugins: Connect Apps, or open Plugins and choose Apps. Press Connect Composio: your browser opens Composio, the service that does the connecting, and you approve there. Back in ADCode the banner turns green. Then press Link on an app, such as Gmail: the chat asks Composio to start that app's sign-in and gives you a link to approve on the app's own page. After that just ask: "email this summary to Sam", "create a table for orders in Supabase", "add a DNS record on Cloudflare". Search the gallery by name or pick a category; a service that is not listed can still be linked by typing its name. Each call to an app can ask you first: see Ask before connector tools in Settings. To manage or remove the connection, press Manage tools, or open Tools and find Composio under Connectors. If your browser shows an out-of-date sign-in page, close it and use the newest one.

Access: `All Features → Connect your apps (Gmail, Supabase, Cloudflare and more)`; `Connect apps`.

<!-- feature:account.earnings -->
### Earnings

What you have been paid for the sponsored cards you have seen, listed one by one.

Why use it: So the number is something you can check rather than something you are told.

How to use it: Open the earnings view from the Earnings row in the Vibe sidebar, or from the Earnings command in the command palette. Every row is a real event with the exact amount. The total is worked out by adding the rows up, so it can never disagree with them. Nothing in ADCode can edit or delete a row - a correction is a new row that points at the one it corrects.

Access: `All Features → Earnings`; `Open`.

<!-- feature:account.invite -->
### Invite & earn

Send your invite link to a friend, and you get a share of the ad money ADCode makes when they use it.

Why use it: If someone you know would like a free AI code editor, this pays you for telling them, and it costs them nothing: they keep every cent of their own earnings.

How to use it: Open Invite & earn from the Earnings card or the command palette. Copy your link, or post it on X or Threads, or email it. When someone installs ADCode from your link, the editor picks the invite up by itself. For 365 days you get 10% of what ADCode earns from the ads they see, and 5% of what any advertiser you bring spends. Both come out of ADCode's half, never theirs. Earnings arrive the day after the ads were seen. If a friend sent you a code, paste it into the box in your first 14 days. With a project open, the panel can add a "Built with ADCode" line to its README, linked to your invite. In a live session, "Invite someone who doesn't have ADCode yet" copies how to install and join. Know a company that sells to developers? "Copy a pitch to send them" gives you a short message with your advertiser link.

Access: `All Features → Invite & earn`; `Open`.

<!-- feature:account.signIn -->
### Signing in

Signing in keeps your earnings attached to you rather than to this one computer.

Why use it: Without it, your balance lives only on this machine and is lost if the machine is.

How to use it: Use the account button - at the foot of the Vibe window's rail, or in the Code window's title bar. You can sign in with Google, GitHub, or an email address, and anything you already earned anonymously comes with you.

Access: `All Features → Signing in`; `Open account`.

## Files and gestures

<!-- feature:gestures.multiSelect -->
### Selecting and moving files

Files can be renamed, moved, copied and deleted straight from the file list.

Why use it: Leaving the editor to use a file manager for something this ordinary is a break in the work.

How to use it: Right-click any file for the full list. Drag to move, hold Ctrl while dragging to copy, and F2 to rename. Deleting sends to the recycle bin, not to nowhere. Use Split editor right in a file header or the command palette to edit two files side by side. Each panel has a file picker; selecting a tab or opening a file uses the focused panel. Drag the divider to resize, or focus it and use arrow keys. Merge editor panels returns to the focused file without closing your buffers.

Access: `All Features → Selecting and moving files`; `Open Explorer`; `New file`; `Open file`; `Save`; `Save as`; `Save all`; `Revert file`; `Close editor`; `Close all editors`; `Split editor right`; `Merge editor panels`; `Insert file template`; `Open folder`; `Open recent`; `Open a recent folder`; `Clear recent folders`; `Close folder`; `Keyboard → F2`.

## Ads and earnings

<!-- feature:ads.networks -->
### Ad network connections

Administrators can connect an ad provider and choose what users earn for verified views or clicks.

Why use it: Provider inventory can fill an empty sponsored slot while keeping the existing ad controls and direct campaigns.

How to use it: Open Ad network settings on the website and sign in as an administrator. Add a Generic JSON API connection with the provider's documented serve and event-verification endpoints and field mappings. Save it disabled, save its API key, test the preview, then enable delivery. Choose Pay users per View, Click, or View and click, and set the dollar amount; the other event pays nothing. Keys are encrypted and never shown again. An API key alone is not enough: each provider must support the configured delivery and verification contract. Imprezia Chat Ads works with just the publisher API key from Imprezia's API Keys page. The Imprezia partner ads panel at the top of the page says whether it is live, on a sandbox key, or off; paste the production key there and press Save key and go live, which creates the connection if needed, encrypts the key and turns delivery on in one step. That button refuses a sandbox key, so live always means real ads. People still see Imprezia's cards only after switching on sponsored cards under AI replies or partner notifications in Settings. Its ads fill the sponsored card when no direct campaign does, and only the project's language tags are sent. Zeekend Chat Ads is asked before Imprezia under every AI reply. The Zeekend partner ads panel beside Imprezia's works the same way: paste the pub_live_ key Zeekend sent and press Save key and go live. It refuses test keys (pub_test, pub_sandbox, pub_demo), whose placements earn nothing; save one of those from the connection's API key box to try it. Ask Zeekend to allow adcode.bluethenics.com as the key's origin; how often its placements appear is set in Zeekend's dashboard. A sandbox key (api_pub_sandbox_) delivers Imprezia's test ads and never pays users. Imprezia's Exchange preview, with an app bundle or domain, stays test-only. The beehiiv connection previews newsletter offer content only; it cannot deliver desktop ads or generate earnings. Users keep control over sponsored messages and frequency.

Access: `All Features → Ad network connections`; `Open ad network settings`.

<!-- feature:adcode.ads.frequency -->
### Frequency

How often a sponsored card is allowed to appear. Off, Light, Standard, or Max.

Why use it: Fewer cards means less interruption and less earned; more means the opposite. It is your trade to make.

How to use it: Standard by default - at most one every 10 minutes and 24 a day. Light is one every 30 minutes and 8 a day; Max is one every 5 minutes and 60 a day. These limits are counted on your machine, and the server is only ever allowed to make them stricter, never looser.

Access: `All Features → Frequency`; `Settings`.

<!-- feature:adcode.ads.chatSponsored -->
### Sponsored cards under AI replies

A sponsored card chosen for the conversation can appear above the message box. It is on unless you turn it off, and ADCode tells you once when it turns it on.

Why use it: A card that matches what you are asking about is more useful than one picked from the language you have open, and it is worth more to advertisers. Choosing it does mean your message and the reply leave your computer for ADCode's ad partners, so ADCode says so once, with a Turn off button, and the switch stays in Settings.

How to use it: It is on from ADCode 2.5.1 unless you switched sponsored messages off; a one-time card says so, with Turn off. To change it, open Settings, choose Ads, and switch Sponsored cards under AI replies; it needs Sponsored messages on too. After each answer in the desktop app, ADCode asks its ad partners for one card: Zeekend first, then Imprezia if Zeekend has nothing. Zeekend receives your message (its first 2,000 characters) and the reply (4,000), which question of the conversation it is, an identifier for the conversation that is not your account, and your IP address and browser details; it uses Anthropic's models to match a product to the conversation. Imprezia receives your message and the reply (4,000 characters each), the conversation's identifier, and your IP address and browser details. One card appears in a strip just above the message box and stays there while you work; when the next reply brings a new card it takes the old one's place only once it has arrived, so the strip is never empty in between, and a reply with no card leaves the last one where it is. It is a page from adcode.bluethenics.com walled off from the editor, so the ad partner cannot reach your files or the rest of ADCode. Clicking a card opens your browser. Nothing else from your project is sent. Turn it off in the same place and the next reply sends nothing. Not yet in the web version.

Access: `All Features → Sponsored cards under AI replies`; `Turn on or off`; `Settings`.

<!-- feature:adcode.ads.enabled -->
### Sponsored messages

A small advert card appears in the corner sometimes, and you get paid a little each time one is shown.

Why use it: It is how ADCode is free. If you would rather not, turning this off costs you nothing else - no nag screens, no locked features.

How to use it: On by default. This switch is the final say on this machine: with it off, nothing is shown and nothing is earned, whatever the server says. Cards arrive while you work - that is how they are seen at all - but never during a debug session, never when the window is not in front, not for the first minute after launch, and never twice in a row without a gap. On a new install no card appears until the assistant has built something for you, or for the first 15 minutes, whichever comes first.

Access: `All Features → Sponsored messages`; `Turn on or off`; `Settings`.

<!-- feature:adcode.ads.partnerNotifications -->
### Sponsored notifications from ADCode's ad partner

A sponsored notification from Imprezia, ADCode's ad partner, can appear when no ADCode advertiser has one for you. It is on unless you turn it off.

Why use it: Sponsored messages are what keep ADCode free, but on many days no ADCode advertiser has one that fits. This lets the ad partner fill that moment instead of leaving it empty, without showing you any more ads than you already agreed to: it uses the same schedule, daily limit and quiet times.

How to use it: It is on from ADCode 2.5.1 unless you switched sponsored messages off; the one-time card about sponsored cards mentions it too, with Turn off. To change it, open Settings, choose Ads, and switch Sponsored notifications from ADCode's ad partner; it needs Sponsored messages on too. When a sponsored message is due and no ADCode advertiser has one, the desktop app asks Imprezia instead, telling it only the names of the languages and frameworks you have open (like typescript, react, docker), an identifier that changes every time ADCode starts, and your IP address and browser details. If Imprezia has a card, it slides in like any sponsored message, with a countdown that pauses while you read and a close button; if not, nothing appears and the slot does not count toward your daily limit. The card is a page from adcode.bluethenics.com walled off from the editor, so the ad partner cannot reach your files. Clicking it opens your browser. ADCode advertisers always come first. These notifications are not credited to your earnings yet. Not in the web version.

Access: `All Features → Sponsored notifications from ADCode's ad partner`; `Turn on or off`; `Settings`.

## Updates

<!-- feature:adcode.updates.auto -->
### Install updates automatically

A small card tells you when a new version is available. Choose Update now to finish downloading and install it, or keep working and update later.

Why use it: So you are never out of date, and you always know when a new version is waiting - without a box that stops your work.

How to use it: On by default. A new-version card offers Update now or Later, once per version and only when you are not typing. Updates download in the background. A round arrow appears at the top right, beside Changes and Preview, and fills as the download runs; click it once to update. The status bar shows the same progress. Choose Update now to install when the download finishes. On Windows ADCode protects unsaved work in every window, closes, shows installation progress, then opens the updated app automatically without another setup wizard. On Linux it closes to finish installing. If you keep working, a separate ready card offers Restart now or Close and update. Unsaved work is kept as a recovery draft; if crash recovery is off, ADCode asks you to save first. Ignoring the cards installs a downloaded update quietly the next time you close ADCode normally. Microsoft Store installations get an Update in Microsoft Store button; the Store decides when its update reaches your device. Portable installations get a Download update button for the official ADCode site so you can replace your portable copy. Help → Check for Updates asks now, even with automatic checks off. If an update fails, your current version stays usable and Help → Report a Problem includes the updater log. Linux packages managed by your operating system still update through that package manager.

Access: `All Features → Install updates automatically`; `Check now`; `Update now`; `Turn on or off`; `Settings`.

<!-- feature:updates.whatsNew -->
### Tell me what changed

Now and then, a small card tells you what changed in the version you just got.

Why use it: A feature nobody is told about may as well not exist. This is the one interruption ADCode allows itself, so it is kept rare.

How to use it: Four rules keep it quiet: you see a given version's note once on this machine and never again, it waits for a moment when you are not typing, not running a command, and not debugging, it only appears for releases worth reading - small fixes install silently - and it never appears on a brand new install. Dismiss it and it is gone for good. Turn this off and nothing ever pops up; Help > What's New still has every note. A security fix is the one thing that will not wait for a quiet moment, though even that respects the switch being off.

Access: `All Features → Tell me what changed`; `Read it`; `Turn on or off`; `Settings`.

## Privacy

<!-- feature:adcode.privacy.usageStats -->
### Help improve ADCode

Lets ADCode count which features you use each day, so the team can fix what is hard to find. Only names and numbers are sent.

Why use it: A feature nobody uses is either not needed or not findable, and counts are the only way to tell which. Leave it on to have your use shape what gets improved; turn it off and nothing is counted.

How to use it: It is on by default. To turn it off, open Settings › Privacy and switch off Help improve ADCode, or search for it in All Features. What is counted: which commands run, which pages open (Chat, Plugins, Artifacts and the rest), product moments such as installing a plugin, and which directory add-ons are used - as fixed names with a count per day. What is never sent: your code, prompts, file or folder names, project names, the plugins you tried privately in the Studio, or anything you typed. Counts are kept on your computer and sent once a day as one report, which the service stores without your account. Switching it off deletes anything not sent yet.

Access: `All Features → Help improve ADCode`; `Turn on or off`; `Settings`.
