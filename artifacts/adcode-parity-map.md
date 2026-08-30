# ADCode Parity Map

*Extension research — 29 August 2026*

What the most-installed extensions in five editor ecosystems say ADCode should build
next, and what it has already quietly built.

| | |
|---|---|
| ~55,000 | extensions in the VS Code marketplace |
| 40 | that cover almost everyone's daily use |
| 16 | native ADCode packages already doing this work |
| 0 | extensions ADCode can install — there is no host |

---

## The short answer

**Nobody installs 55,000 extensions. They install about forty.** And roughly half of those
forty are not features at all — they are language support. That single fact should decide
ADCode's roadmap, because ADCode has no extension host: every language a person can use is
one you shipped.

Install counts were pulled live from the VS Code Marketplace gallery API, Open VSX (what
Cursor, VSCodium and Windsurf users install), the Zed extension API, Sublime's Package
Control, and dotfyle's index of 1,000+ real Neovim configs. Those were then mapped against
ADCode's own source tree. The gap is smaller than you would expect, and it is concentrated
in three places.

> **Read install counts as ordinal, not literal.** They are cumulative since publication and
> inflated by bundling — Jupyter drags four companion extensions in with it, and the Java
> pack installs six. Rank is evidence of demand; the absolute number is not usage.

---

## Finding 01 — The head of every marketplace is language support

Six of the ten most-installed VS Code extensions are a language, a language's debugger, or a
language's build tool. On Open VSX the top twenty is almost nothing else: Pyrefly, debugpy,
Python, Ruby LSP, Java, PHP, Go, clangd. On Zed — the closest architectural cousin to
ADCode — the entire top thirty is languages, themes and icons, with *one* exception, a Git
syntax highlighter.

### VS Code Marketplace — top installs, August 2026

| Installs | Extension | What it is | ADCode |
|---:|---|---|---|
| 234.3M | `ms-python.python` | Language: Python | — |
| 201.1M | `ms-python.vscode-pylance` | Language: Python | — |
| 139.7M | `ms-python.debugpy` | Language: Python debugger | — |
| 108.5M | `ms-toolsai.jupyter` | Notebooks | — |
| 103.2M | `ms-vscode.cpptools` | Language: C/C++ | — |
| 81.8M | `ritwickdey.LiveServer` | Live preview | **ships this** |
| 77.9M | `GitHub.copilot-chat` | AI chat | **ships this** |
| 74.5M | `GitHub.copilot` | AI completion | **ships this** |
| 71.2M | `esbenp.prettier-vscode` | Formatter | **format-on-save** |
| 62.2M | `ms-vscode.cmake-tools` | Build tooling: C/C++ | — |
| 56.6M | `redhat.java` | Language: Java | — |
| 52.5M | `dbaeumer.vscode-eslint` | Linter | **diagnostics** |
| 52.4M | `ms-azuretools.vscode-docker` | Containers | — |
| 52.3M | `eamodio.gitlens` | Git | **blame, log, diff** |

Installs, not active users. Pylance and debugpy ship alongside the Python extension, which is
why one language occupies three of the top five rows.

> **The concrete gap.** `packages/lsp/src/servers.ts` ships ten servers — pyright,
> rust-analyzer, gopls, clangd, lua-language-server, solargraph, intelephense, bash, yaml,
> marksman — plus Monaco's own TypeScript worker. There is no Java, C#, Kotlin, Swift, Dart,
> Vue, Svelte, Astro, Tailwind, Terraform, TOML, XML or SQL. And all ten only work *if the
> person already installed them on their PATH*, which is the largest usability cliff in the
> product.

---

## Finding 02 — Every ecosystem installs the same eight jobs

Strip out the language packs and what remains is strikingly consistent across editors that
share no code and no users. Different names, same eight jobs — which is exactly the list a
batteries-included editor should own natively.

| The job | VS Code | Neovim | Sublime | JetBrains | ADCode today |
|---|---|---|---|---|---|
| Language servers | Python 234M; Java, C++, Go | lspconfig 2,385; mason 1,548 | SublimeCodeIntel 1.9M | bundled | **Partial** — 10 servers, PATH only |
| Format & lint | Prettier 71.2M; ESLint 52.5M | conform 1,399 | SublimeLinter 2.3M | bundled | **Shipped** — `packages/format`, LSP-first |
| Git beyond commit | GitLens 52.3M; History 17.2M; Graph 15.2M | gitsigns 1,772 | — | GitToolBox | **Partial** — blame, log, diff; no graph or stash |
| Debugging | debugpy 139.7M; Java debug 52.0M | nvim-dap 1,128 | — | bundled | **Shipped** — `packages/debug`, DAP client |
| Snippets | ES6 22.0M; React 17.6M | LuaSnip 1,550; friendly-snippets 1,443 | bundled | Live Templates | **Missing** — keyword completion only |
| Inline diagnostics | Error Lens 9.7M | trouble 1,139 | — | bundled | **Shipped** — `renderer/editor/errorLens.ts` |
| Themes & icons | Material Icons 35.4M; One Dark 12.7M | devicons 1,861; catppuccin 977 | — | One Dark 4.7M; Atom icons | **Partial** — 3 themes, 1 icon set |
| Modal editing | Vim 9.0M | native | Vintage | IdeaVim 12M | **Missing** |

Two patterns cut against the assumption that people want *plugins*. Sublime's
second-most-installed package of all time is **Emmet** (6.1M) — which VS Code simply built
in, and therefore never shows up in its numbers at all. And the top three Neovim entries are
a syntax layer, an LSP config and a plugin manager: infrastructure people install so they can
stop thinking about infrastructure. Nobody wants a marketplace. They want the thing to
already work.

---

## Finding 03 — ADCode is further along than the file tree suggests

Sixteen native packages already reproduce, with no extension host, most of what people
install a marketplace to get. This is the part to protect in any roadmap — it is the moat.

### Already native

- **LSP + DAP** — `packages/lsp`, `packages/debug`
- **Format-on-save**, server-first with a built-in fallback — `packages/format`
- **Error Lens** equivalent (9.7M) — `errorLens.ts`
- **Code Spell Checker** equivalent (18.1M) — `packages/spell`
- **Live Server** equivalent (81.8M), with a device toolbar — `main/liveServer.ts`
- **Code Runner** equivalent (41.6M) — `renderer/run/`
- **Live Share** equivalent (24.0M) over Yjs and LAN — `packages/collab`
- **Path Intellisense** (19.3M) — `pathComplete.ts`
- **Auto Rename Tag** (25.8M) — `pairedTagRename.ts`
- **Better Comments** (10.6M) — `commentTones.ts`
- **Local History**, a JetBrains staple — `main/localHistory.ts`
- **AI chat, inline edit, tools, MCP** — `packages/ai`

### Half-built — finish these first, they are cheap

- **Git** has status, stage, commit, push, pull, fetch, clone, branches, checkout, log, blame
  and diff. No graph, no stash, no rebase, no merge-conflict UI.
- **TODO highlighting** exists in the editor; there is no Todo Tree panel listing them (7.7M).
- **Themes** stop at `light`, `dark`, `midnight`. Catppuccin alone is top-ten in both Neovim
  and Zed.
- **Recents** exist, but not a Project Manager (7.5M) that switches windows.
- **Activity tracking** already counts typed vs. AI-written characters and flushes to the
  dashboard — that is WakaTime (23.1M in VS Code, #6 all-time in Sublime) with no third party
  involved.
- **The shortcuts dialog** is one step from a which-key overlay (1,440 Neovim configs).

---

## The gap — what people install that ADCode cannot offer

One representative extension per unbuilt job, ranked by installs. Read it as a queue, not a
scoreboard.

| Installs | The job | Representative extension |
|---:|---|---|
| 108.5M | Jupyter notebooks | `ms-toolsai.jupyter` — four companions follow it in |
| 56.6M | Java language support | `redhat.java` — six more in the Java pack |
| 52.4M | Docker & Compose | `ms-azuretools.vscode-docker` |
| 41.4M | Dev Containers | `ms-vscode-remote.remote-containers` |
| 40.4M | WSL workspaces | `ms-vscode-remote.remote-wsl` |
| 37.0M | Remote — SSH | `ms-vscode-remote.remote-ssh` |
| 36.3M | GitHub pull requests | `GitHub.vscode-pull-request-github` |
| 35.4M | Icon themes | `PKief.material-icon-theme` |
| 23.4M | CSV & tabular files | `mechatroner.rainbow-csv` |
| 22.0M | Snippet packs | `xabikos.JavaScriptSnippets`; React pack 17.6M |
| 17.2M | Git history view | `donjayamanne.githistory` |
| 15.2M | Git graph | `mhutchie.git-graph` |
| 15.0M | EditorConfig | `EditorConfig.EditorConfig` |
| 14.5M | Tailwind IntelliSense | `bradlc.vscode-tailwindcss` |
| 14.4M | Markdown preview | `yzhang.markdown-all-in-one`; MPE 10.1M |
| 9.0M | Vim keybindings | `vscodevim.vim` — IdeaVim adds 12M more |
| 7.5M | HTTP client | `humao.rest-client`; Thunder Client 7.5M |
| 7.0M | SQL & database explorer | `mtxr.sqltools` |
| 6.1M | Emmet | built into VS Code; #2 of all time in Sublime |

All VS Code Marketplace installs except Emmet, which is Sublime Package Control — VS Code
reports no number for it because it never needed an extension.

---

## Build order

Three tiers, and the order inside each is real: earlier items unblock or cheapen later ones.
Tier 1 is parity people notice in the first ten minutes. Tier 2 is the large clusters. Tier 3
is the part no competitor can copy, precisely because ADCode has an account and no
marketplace.

### Tier 1 — first-session parity

*Cheap, because the packages already exist.*

1. **A toolchain installer — ADCode's `mason.nvim`.** *The highest-leverage item on this
   page.* Detect the languages in the open folder, then download and manage their servers,
   formatters and debug adapters into an app-owned directory. No PATH, no npm, no "install
   pyright first". This is what 1,548 Neovim configs install `mason.nvim` to do, and what the
   234M-install Python extension does under the hood. It turns the ten servers you already
   ship from a power-user feature into a default.
   → `packages/lsp/src/servers.ts` · new `packages/toolchain` · a Languages panel in
   `renderer/panels/`

2. **Triple the server catalogue** (ten → about thirty). In demand order: Java (jdtls), C#
   (Roslyn), vtsls for large TypeScript projects, Vue (Volar), Svelte, Astro, Tailwind,
   Kotlin, Swift (SourceKit), Dart, Terraform, TOML (taplo), XML (lemminx), SQL, Dockerfile,
   Prisma, GraphQL. Once item 1 exists, each of these is a table row rather than a project.
   → `packages/lsp/src/servers.ts`

3. **Finish Git** (GitLens 52.3M · History 17.2M · Graph 15.2M). A commit graph with branch
   lanes, stash, rebase, and a merge-conflict resolver in the editor. The IPC surface already
   runs through `git:log`, `git:blame` and `git:diff`, so this is a panel and four commands,
   not a subsystem.
   → `packages/git` · `main/gitIpc.ts` · `renderer/panels/commitBrowser.ts`

4. **Snippets** (39.6M across the two biggest packs). Tab-stop expansion, user-authored
   snippet files, and a curated built-in pack per language — the `friendly-snippets` model,
   1,443 Neovim configs. Today `completions/keywords.ts` offers keywords only.
   → `renderer/editor/completions/`

5. **Emmet** (Sublime's #2 package ever; invisible in VS Code because it is built in).
   Abbreviation expansion in HTML, JSX and CSS. Roughly a day of work for something every web
   developer notices missing within a minute.
   → `renderer/editor/`

6. **Markdown preview** (24.5M across the two main extensions). The preview pane and device
   toolbar already exist and point at a dev server; teach them to render Markdown, and
   Mermaid, side by side with the buffer.
   → `renderer/preview/previewPane.ts`

7. **Themes and icon themes** (Material Icons 35.4M · One Dark 12.7M · Dracula 10.9M). Three
   themes is not a choice. Ship eight, including the ones people actually pick in every
   ecosystem — Catppuccin is top-ten in both Neovim and Zed — plus a drop-in theme file
   format, so nobody needs a marketplace for a colour scheme.
   → `renderer/theme.ts` · `renderer/styles/` · `workbench/fileIcons.ts`

8. **EditorConfig and project-local tools** (15.0M). Honour `.editorconfig`, and when the open
   project carries its own Prettier, ESLint, Black or Ruff in `node_modules` or its venv, run
   *that* binary instead of the built-in formatter. This is how you stop being wrong about
   someone else's repo.
   → `packages/format` · `renderer/editor/formatting.ts`

9. **Small panels that punch above their weight** (Todo Tree 7.7M · Project Manager 7.5M ·
   Bookmarks 5.1M). A TODO panel over the existing highlighter, bookmarks with a jump list,
   and a project switcher over the existing recents store.
   → `renderer/panels/` · `main/recentsStore.ts`

### Tier 2 — the big clusters

*Real projects, each with a large audience behind it.*

1. **Remote workspaces** (156M combined across SSH, WSL, containers and Codespaces). The
   largest untouched cluster in the data, and no lightweight editor does it well. Start with
   WSL: you are on Windows, it is the cheapest of the three, and it is 40.4M on its own. Then
   SSH, then devcontainers.
   → new `packages/remote` · `main/terminal.ts` · `main/workspace.ts`

2. **Notebooks** (108.5M, the largest non-language extension in the marketplace). Open, edit
   and run `.ipynb` with inline outputs. A large build, but it is the entire data-science
   audience, and it pairs with the Python server you already ship.
   → new `packages/notebook` · `renderer/editor/`

3. **Test explorer and coverage** (Test Explorer 5.5M · Playwright 3.0M · Jest/Vitest Runner
   2.2M · Coverage Gutters 0.9M). Discover tests, run the one at the cursor, debug it through
   the DAP client you already have, and paint coverage in the gutter.
   → `renderer/run/` · `packages/debug`

4. **HTTP client and database explorer** (REST Client 7.5M + Thunder 7.5M + SQLTools 7.0M). A
   `.http` file you can execute in place, and a connection tree that runs queries into a
   results grid. Both are self-contained, and both demo extremely well.
   → new `packages/http`, `packages/db` · `renderer/panels/`

5. **GitHub inside the editor** (Pull Requests 36.3M · Actions 8.4M). Review and comment on
   pull requests, and watch CI without a browser tab. The OAuth plumbing already exists in
   `main/oauth.ts`.
   → `packages/git` · `main/oauth.ts`

6. **Docker and Compose awareness** (52.4M). Dockerfile and compose language support, plus
   running and attaching to containers from the ports panel you have already built.
   → `main/ports.ts` · `packages/lsp`

7. **Vim mode** (9.0M in VS Code, 12M in JetBrains). Not for everyone — but for the people who
   need it its absence is disqualifying, and they are exactly the Neovim and Zed users you are
   trying to win.
   → `renderer/editor/`

8. **Non-code file viewers** (Rainbow CSV 23.4M · PDF 13.2M · Hex 7.3M). A CSV table view with
   column colouring, an image and PDF viewer, a hex fallback for binaries. Small work, and
   each one removes an "I have to leave the editor" moment.
   → `renderer/editor/editorHost.ts`

### Tier 3 — where ADCode wins outright

*Not copyable by an editor built around a marketplace.*

1. **Make "no extensions" the pitch, not the caveat.** Extension supply-chain compromise is
   now a routine story in every marketplace ecosystem. A curated catalogue that ships signed
   with the app, updates with the app, and is audited by one person is a real security
   position — and it is also the honest reason everything works on first launch. Put it on the
   marketing site: *forty extensions' worth of editor, zero extensions to install.*

2. **Coding stats with no third party** (WakaTime: 23.1M in VS Code, #6 all-time in Sublime).
   Millions of people install a SaaS agent to answer "how much did I write this week?".
   `shared/activity.ts` already counts typed versus AI-written characters and flushes deltas
   to an account you own, into a dashboard you have already built. This is nearly free, and
   nobody else can ship it without asking the user to sign up for something.

3. **Settings, keybindings and themes that follow the account.** Sync is built into VS Code
   and a plugin everywhere else. ADCode already has authentication, a settings store and a
   keybindings store; wiring them to the account turns a second install into a thirty-second
   event.
   → `main/settingsStore.ts` · `main/keybindingsStore.ts` · `main/accountIpc.ts`

4. **An assistant that can see the whole IDE.** Copilot, Cline and Continue are all
   extensions, so they see files and a terminal. ADCode's assistant lives in the process that
   owns the language servers, the diagnostics, the debug adapter, git and the running dev
   server — it can answer "why is this test failing" from the live stack rather than a guess.
   That seam is the one thing an extension architecturally cannot reach, and it is the
   strongest claim the product has.
   → `packages/ai` · `main/aiTools.ts`

---

## Before any of this — the branch cannot build

Every item above touches `packages/`, and on `feat/dashboards-and-ios-web` that tree is
absent — `git ls-files packages` returns nothing, so typecheck, the dependency firewall and
six test files fail, and neither `npm run verify` nor the smoke run can pass.
`feat/ai-workspaces` has all sixteen packages restored and verifying green, and the two
branches touch disjoint file sets. Merge that first; then this roadmap is buildable.

---

## Sources

Install counts pulled live on 29 August 2026 from the VS Code Marketplace gallery API and the
Open VSX and Zed extension APIs; Neovim figures are configuration counts from dotfyle's index
of 1,000+ public configs; Sublime figures are Package Control installs; JetBrains figures come
from JetBrains' own marketplace write-up.

- [VS Code Marketplace](https://marketplace.visualstudio.com/vscode)
- [Open VSX Registry](https://open-vsx.org/)
- [Top Neovim plugins — dotfyle](https://dotfyle.com/neovim/plugins/top)
- [Sublime Package Control](https://packagecontrol.io/browse/popular)
- [Zed extensions](https://zed.dev/extensions)
- [Top 10 plugins for IntelliJ-based IDEs](https://blog.jetbrains.com/platform/2023/02/top-10-plugins-for-intellij-based-ides/)
