# ADCode on the web (web.bluethenics.com)

> **Status: live from 2026-11-22**, running in the person's tab. To pause it again, pass `true`
> to `webEntry` in `apps/desktop/vite.web.config.ts`: production builds then ship a static "The
> web version is paused" notice with a link to the desktop app.

## How it works now (2026-11-21): the main process in the tab

No computer per person. The web version runs the **desktop's own main-process code in a Web
Worker** in the person's tab (`apps/desktop/src/browserHost`), and the Vibe renderer talks to it
with exactly the frames it used to send a cloud sandbox over a WebSocket
(`src/web/workerSocket.ts`). So the web has the desktop's chat, models, helpers, plans, usage
and slash commands, and every future desktop feature arrives on the web with it.

```
tab ── page (renderer, src/web/boot.ts) ──postMessage── Worker: browser-host.js (src/main + shims)
                                                          │ fs  → shims/vfs.ts: memory, written to IndexedDB
                                                          │ git → browserHost/githubGit.ts (base copy + pull requests)
                                                          └ fetch /v1, /api/github → cloud Worker → API / GitHub
```

| Piece | Where | What it does |
|---|---|---|
| Worker build | `apps/desktop/vite.browserHost.config.ts` | `src/browserHost/worker.ts` as one script; `node:*` → `src/browserHost/shims`, `electron` → the cloud host's shim, `@adcode/git` → GitHub-backed git, anything else Node-only loads but throws when used |
| Files | `shims/vfs.ts` | Node's fs in memory, written behind to IndexedDB (`adcode-files`); settings, chats, own API keys and projects survive reloads, per browser |
| Programs | `shims/childProcess.ts` | Every spawn fails like a missing program (`ENOENT`), so callers' own "not installed" paths run |
| Projects | `browserHost/githubProjects.ts`, `web/githubRepoPicker.ts` | Open from GitHub copies a repository's text files (≤256 KB each) plus a hidden base copy |
| Git | `browserHost/githubGit.ts` | Status/diff/discard against the base; commit/push open a pull request on a new `adcode/` branch (≤50 files, ≤1 MB) |
| Cloud Worker | `apps/cloud` | Serves the page and `browser-host.js`, forwards all of `/v1` except `/v1/admin`, keeps the GitHub token (`/api/github/*`). `/socket` refuses: no sandbox starts |

Not on the web: a terminal, running commands, a live dev-server preview, local models and CLI
agents. A closed tab stops a running turn. Checks: `npm run smoke:web` (this path, with a fake
model and fake GitHub routes) and `test/browserHost*.test.ts`.

## Working on it locally

```
npm run web:vibe          # builds the browser host, serves the page on http://localhost:5180 ("Continue in dev mode")
npm run smoke:web         # end to end in headless Edge with a fake model and fake GitHub routes - read the printed values
```

In development, Vite forwards `/v1` to the live API (`ADCODE_ACCOUNT_API_ORIGIN` overrides it) and
`/api` only when `ADCODE_WEB_API_ORIGIN` is set: GitHub needs the cloud Worker's routes, so locally
"Open from GitHub" works against a stand-in only.

## Deploying

`npm run cloud:build` builds the browser host, the page and the Phone link page into
`apps/cloud/public`. From `apps/cloud`, `wrangler deploy --containers-rollout=none` publishes the
Worker and assets without touching the old sandbox image. The page is paused until
`webEntry(mode === "production")` becomes `webEntry(false)` in `apps/desktop/vite.web.config.ts`.
The website/API Worker deploys separately (the `/v1` routes the web calls live there).

## What is left of the sandbox

`/socket` refuses (4410) and nothing starts a container. The cloud Worker still declares the
`UserSession`, `Budget` and `PreviewRoute` Durable Objects and the container image: removing them
needs a Cloudflare migration that deletes the cloud workspaces people saved, so it is a decision
of its own. Until then `/api/download` and `/api/delete` keep that saved work reachable.
