# ADCode

**A free, open-source AI code editor that pays you.** ADCode is a desktop IDE with a built-in
AI assistant, real terminals and git. It shows an occasional sponsored card and credits you
half the revenue, on a ledger you can audit.

Open source under the [Apache License 2.0](LICENSE).
[Website](https://adcode.bluethenics.com) ·
[Documentation](https://adcode.bluethenics.com/docs) ·
[Contributing](CONTRIBUTING.md)

## Install

Windows (PowerShell):

    irm https://adcode.bluethenics.com/install.ps1 | iex

Linux:

    curl -fsSL https://adcode.bluethenics.com/install.sh | sh

Both scripts are in this repository, under `apps/web/public/`, so you can read them first.
macOS builds are not published yet.

## What it does

- **Edits.** Monaco editing, language servers, formatting, search and replace across a folder.
- **Runs.** Several real terminals, a Run button, and a built-in preview server.
- **Understands git.** Stage, commit, branch, blame, file timelines and conflict resolution.
- **Has an assistant that shows its work.** Connect a model provider with your own key, any
  OpenAI-compatible endpoint, or a local model. Its edits land in your project as it works,
  and every turn that changed files can be undone.
- **Two ways to work.** Vibe, where you describe what you want, and Code, the full IDE.
- **Explains itself.** Every feature has a plain-language entry, in the app under
  **All Features** and on the [docs site](https://adcode.bluethenics.com/docs).

## How the ads work

ADCode is free because it shows sponsored cards. Half of what an advertiser pays for a view is
credited to you.

- Targeting uses a fixed vocabulary of generic tags, such as the language or framework in use.
  ADCode does not read your source code to target advertising.
- A view earns only when its receipt matches a card the server actually sent. That check runs
  on the server, in [`services/api`](services/api), and is why a modified client cannot mint
  money.
- Your code stays on your machine unless you send it somewhere: to an AI provider you
  connected, or to people you invite to a live session.

The full terms are at [adcode.bluethenics.com/terms](https://adcode.bluethenics.com/terms).

## AI models and pricing

The editor is free, and Tagflow AI's sponsored models are free for every signed-in account,
with no API key. For the other hosted models, premium ones included:

- **Plans** give fresh credits every day on every hosted model: Builder $19, Pro $39 and Max
  $149 a month (580, 1,190 and 4,500 credits a day), or two months free when paid yearly.
  Cancel any time; the plan keeps working until the period you paid for ends.
- **Credits** are US dollars you add once, any whole amount from $5 to $1,000. They never
  expire and pay for each model at the price listed for it.

Your own provider keys, coding CLIs and local models are always free to connect. Current
prices for every model are on the [pricing page](https://adcode.bluethenics.com/pricing).

## Build from source

You need Node 24 or newer and npm 11 or newer.

    npm install
    npm --prefix apps/web install   # verify typechecks the website too
    npm start               # build if needed, then launch the editor
    npm run dev             # the editor with hot reload
    npm run verify          # types, architecture rules and every test
    npm run package         # installers into release/

A source build talks to ADCode's production ad server. To run with no backend:

    npm run mock-server
    ADCODE_AD_SERVER=http://127.0.0.1:8787 npm start

## Terminal app

From a source checkout, install the command once with `npm link`. Then run it from any project:

    adcode                    # open the terminal app
    adcode app                # open this folder in the desktop editor
    adcode app "../my project" # open another project
    adcode chat               # start a conversation
    adcode chat --continue    # resume your latest conversation
    adcode models             # choose an AI model
    adcode sessions           # browse saved conversations
    adcode sessions open 1    # resume the newest (a number, latest or an id prefix all work)
    git diff | adcode chat "review this"   # ask about anything you pipe in
    adcode chat "write a haiku" > haiku.md # redirected output is the reply alone
    adcode completion install # Tab completion for bash, zsh, fish or PowerShell
    adcode help               # commands, options and shortcuts

Without linking, use `npm run cli` or `node scripts/adcode.mjs` from this checkout.
On the home screen, type a question to begin chatting, press **Tab** to choose a model,
or type **/** for commands. Model and theme pickers return to the home screen.
`adcode --continue` resumes your latest chat directly. The older `adcode open` also opens the editor.

The terminal app shares the desktop account and saved provider connections. It supports
Included AI, your own provider keys, and local Ollama models. Chat streams real replies,
saves conversations locally, and supports Markdown export through `adcode sessions export`.
Chat currently answers questions and explains code; use the desktop editor for file editing.
Sponsored cards use the existing ad service and show real earnings.

Use `--no-motion`, `--no-color`, or `--ascii` for a simpler terminal. Piped output and
`--snapshot` print a still view; `--json` returns structured reports. `adcode app --dry-run`
prints its launch plan without opening a window. `adcode help <command>` shows detailed help.

CLI checks: `npm run cli:typecheck` and `npm run cli:test`.

## What is in the repository

| Path | What it is |
|---|---|
| `apps/desktop` | The Electron app: main process, preload, renderer. |
| `apps/cli` | The terminal app: chat, model picker, sessions, themes and sponsored cards. |
| `apps/web` | The website, docs, advertiser portal, user dashboard and admin panel. |
| `packages/*` | The logic, as plain TypeScript with no Electron and no DOM: `ai`, `ads`, `git`, `help`, `settings` and more. |
| `services/api` | The ad server: serves ads, verifies receipts, keeps an append-only ledger. |
| `mock-server` | The ad-serving contract for local development. |
| `scripts` | Build, packaging, smoke tests and generators. |

[docs/STATUS.md](docs/STATUS.md) records what is built, what is not, and the engineering
lessons behind the codebase.

## Contributing

Bug reports and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md).
Report security problems privately, as described in [SECURITY.md](SECURITY.md).

## Licence

The code is licensed under the [Apache License 2.0](LICENSE); see [NOTICE](NOTICE) for
attribution. The ADCode name and logo are not part of that licence: a modified build needs its
own name. See [TRADEMARKS.md](TRADEMARKS.md).

ADCode is made by [Bluethenics](https://bluethenics.com/).
