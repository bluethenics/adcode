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
- **Has an assistant that shows its work.** Connect any of a couple of hundred model providers
  with your own key, or a local model. Changes are prepared in a private task workspace and
  reach your project only through a checkpoint you can roll back.
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

## Build from source

You need Node 24 or newer and npm 11 or newer.

    npm install
    npm start               # build if needed, then launch the editor
    npm run dev             # the editor with hot reload
    npm run verify          # types, architecture rules and every test
    npm run package         # installers into release/

A source build talks to ADCode's production ad server. To run with no backend:

    npm run mock-server
    ADCODE_AD_SERVER=http://127.0.0.1:8787 npm start

## What is in the repository

| Path | What it is |
|---|---|
| `apps/desktop` | The Electron app: main process, preload, renderer. |
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
