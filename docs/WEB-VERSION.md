# ADCode on the web (web.bluethenics.com)

> **Status: paused in production.** We are not ready for a web release. Production builds
> (`npm run cloud:build` / `npm run cloud:deploy`) ship a static "The web version is paused"
> notice with a link to the desktop app; they no longer ship the app entry. Development
> (`npm run web:vibe`, `npm run smoke:web`) runs the real app. To resume, change
> `webEntry(mode === "production")` to `webEntry(false)` in `apps/desktop/vite.web.config.ts`.

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

The sections below describe the retired per-person sandbox (`?host=local` in development still
reaches a local adcode-host, and `npm run smoke:web-vibe` still covers it).

```
browser ── web.bluethenics.com (Worker: apps/cloud) ──► UserSession DO (one per Firebase uid) ──► Container
 Vibe UI     page + security headers                       usage, archives, previews              adcode-host
 boot.ts     Firebase token check (subprotocol)            Budget DO: monthly cap, slots          = src/main + electron shim
             p-<port>-<id>.web.bluethenics.com previews    PreviewRoute DO: preview id -> owner   + headless Chromium
```

| Piece | Where | What it does |
|---|---|---|
| Web entry | `apps/desktop/src/web/` | Sign-in gate, reconnecting socket, `window.adcode` built from `bridgeTable.ts` (checked against the untouched preload by `test/webBridgeTable.test.ts`), project picker, uploads, Connect GitHub, Cloud workspace panel |
| adcode-host | `apps/desktop/src/host/` | The main process headless: `electron` is aliased to `electronShim.ts`; IPC handlers answer socket frames; home archive and download routes; agent browser over CDP |
| Cloud | `apps/cloud/` | Worker router, `UserSession` (owns the container via `ctx.container`), `Budget`, `PreviewRoute`; R2 home archives |
| Image | `apps/cloud/container/Dockerfile` | `node:24-trixie-slim` + git, tar, Chromium, node-pty, adcode-host |

The spec is `docs/superpowers/specs/2026-10-14-adcode-web-vibe-design.md` (local, not in git).

## Working on it locally

```
npm run web:vibe          # adcode-host + the page on http://localhost:5180 ("Continue in dev mode")
npm run smoke:web-vibe    # end to end in headless Edge with a fake model - read the printed values
```

`web:vibe` keeps its home in `.tmp/web-vibe-home` and makes a dev sealing key there. The page reads
Firebase's public settings from `ADCODE_FIREBASE_*` or `apps/web/.env.production`.

Wrangler cannot run containers on Windows (it wants WSL). Check the image with plain Docker:

```
npm run cloud:build
docker build -t adcode-sandbox apps/cloud/container
docker run --rm -p 7397:7300 -e ADCODE_HOST_SECRET=s -e ADCODE_SEAL_KEY=<32 bytes base64> adcode-sandbox
curl localhost:7397/__adcode/health
```

## Settings

`apps/cloud/wrangler.jsonc` `vars` (change without a code change; `keep_vars` keeps dashboard edits):

| Var | Default | Meaning |
|---|---|---|
| `SESSION_HOURS` | 5 | Usage-accounting window; personal cloud runtime is unlimited in this release |
| `IDLE_SLEEP_MIN` | 5 | Sleep this long after the last tab closes, if nothing is working |
| `UNTOUCHED_TAB_MIN` | 15 | Sleep an open tab nobody has touched, if nothing is working |
| `SNAPSHOT_EVERY_MIN` | 10 | Archive `/home/adcode` to R2 this often while running |
| `MONTHLY_CAP_USD` | 20 | Stop new admissions and pause running sandboxes once the shared monthly resource estimate reaches this |
| `MAX_INSTANCES` | 20 | Sandboxes running at once |
| `INSTANCE_TYPE` | standard-1 | ½ vCPU, 4 GiB, 8 GB disk |
| `ADMIN_UIDS` | (empty) | Firebase uids that may read `/admin/stats` |
| `ADCODE_API_BASE` | (empty) | `/v1` origin for adcode-host; empty = production |

Secret: `npx wrangler secret put PREVIEW_COOKIE_KEY` (any long random string; signs preview cookies).

Cost estimate: $0.0012336 per running minute on standard-1 (memory 4 GiB + disk 8 GB + the full
½ vCPU), about $0.074 an hour. There is no personal running-time allowance. At $20 the shared
monthly resource budget covers about 270 sandbox-hours across everyone.

Every running sandbox charges elapsed time and checks the global cap on its 60-second alarm.
At the cap it saves its home, reports `full`, closes browser sockets with code `4402`, and stops
the container even if an agent is working. Reconnecting also checks admission for already-running
containers. Account reads remain available without starting a sandbox. A paused person's session
status stays `full` until the next UTC calendar month; they may then choose Try again. Raising
the configured cap can also admit them again before then. Personal runtime remains unlimited
while the shared budget and capacity are available.

When all `MAX_INSTANCES` slots are occupied, the browser shows "Waiting for a free sandbox"
and checks again automatically, first after about five seconds and then at intervals of up
to fifteen seconds. There is no reserved queue position. Existing idle sessions release their
slots after the configured idle timeout, including when a Durable Object restart lost the
tab-close event. An active agent keeps its sandbox while it works. Failed startup health or
restore checks stop the incomplete sandbox without replacing its saved home; a failed stop
schedules another cleanup attempt.

The cutoff RPC accepts both the new charge result and the prior budget object's void result.
During a mixed-version rollout, a void result triggers the old object's exact admission check
for the session's existing slot, so cap checks do not depend on rounded statistics. Runtime is
recorded before this extra check, preventing an admission-check retry from charging it twice.

This is an operational cutoff, not a hard Cloudflare billing limit. Under normal alarm timing,
the estimate can overshoot by up to one polling interval per running sandbox, plus the time to
finish shutdown snapshots. Startup/restoration, platform scheduling delays and stop failures can
extend that; a failed container stop schedules another attempt in 60 seconds. The estimate covers the modeled container
resources, not R2, Worker/Durable Object, network or other account charges.

Shutdown saving makes at most two attempts. If both fail, the previous R2 archives are kept,
the pause screen warns that recent changes may be missing, and the container still stops to end
its resource use. Successful snapshots complete before sockets close and the container stops.
On wake, a missing or failed archive restoration stops startup; an empty or partial home is never
exposed or snapshotted over the saved copy. Cloud regression tests exercise these failure paths,
active/busy-session cutoff, unlimited runtime below the cap, and UTC month rollover.

## One-time setup (Cloudflare and Firebase)

Initial setup was completed on 2026-10-15; later verification dates are noted below.

1. **R2 bucket** `adcode-cloud-homes`, with an enabled lifecycle rule deleting objects older than 90 days (verified through the Cloudflare API on 2026-10-19).
2. **The app's domain**: `web.bluethenics.com` is a Workers custom domain (`routes` in
   `wrangler.jsonc`); the first deploy created its DNS record and certificate itself.
3. **Previews (prepared 2026-10-18)**: the proxied `*.web` AAAA `100::` DNS record and
   `*.web.bluethenics.com/*` Worker route are installed. Public DNS resolves and an unknown
   preview host passes normal TLS verification before returning the expected 404.
   Preview hosts need certificate coverage for `*.web.bluethenics.com`, beyond Universal
   SSL's first wildcard level. Verify an actual authenticated preview after deployment.
4. **Firebase authorized domain (verified 2026-10-18)**: the public Firebase project configuration
   includes `web.bluethenics.com`. This meets the authorized-domain requirement for Google
   and GitHub sign-in from this origin.
5. **Secret** `PREVIEW_COOKIE_KEY` (above).
6. Docker Desktop running: `wrangler deploy` builds the image locally.

## Deploying

```
cd apps/cloud && npx wrangler deployments list     # note the current version for rollback
cd ../.. && npm run cloud:deploy                     # build page + host, then wrangler deploy
node scripts/cloud-probe.mjs https://web.bluethenics.com
```

The probe prints what it checked: the page and its CSP, no development sign-in, and every door
(API, socket, another site's origin) refusing a visitor without a token.

The image is about 2 GB, so the first push of a new image takes several minutes. Cloudflare's
registry times out on a single upload of a few hundred megabytes, which is why the Dockerfile
installs its packages in three layers rather than one. A push that fails on
`timeout awaiting response headers` is worth one retry: the layers already sent are kept.

Rollback: `cd apps/cloud && npx wrangler rollback <version-id> -m "reason"`.

A deploy does not restart running sandboxes; each picks up the new image the next time it wakes.
Archives are plain tar.gz of `/home/adcode`, so they restore into any image version.

### Trying a change on real Cloudflare first

`env.staging` in `wrangler.jsonc` is a throwaway copy: workers.dev only, its own bucket, two
sandboxes and a $2 cap, and it accepts the development token so a script can sign in.

```
npx wrangler r2 bucket create adcode-cloud-homes-staging
cd apps/cloud && npx wrangler deploy --env staging --secrets-file <file with PREVIEW_COOKIE_KEY>
node scripts/cloud-probe.mjs https://adcode-cloud-staging.<account>.workers.dev --staging --restore --delete
npx wrangler delete --env staging && npx wrangler r2 bucket delete adcode-cloud-homes-staging
```

`--restore` waits for the sandbox to sleep and checks the project came back from R2; `--delete`
ends with Delete my cloud workspace and checks the day's time stayed spent. Delete the staging
Worker as soon as the probe has run: while it exists, anyone with its URL can open a sandbox.

## Watching it

- `GET /admin/stats` (Bearer token of an `ADMIN_UIDS` account): month, spend estimate, running sandboxes.
- `cd apps/cloud && npx wrangler tail` for live logs; observability is on.
- Web usage shows as platform `web` in the included-AI model reports.

## Limits, on purpose

Vibe only: no code editor, terminal panel, debugger, language servers or local models (the help
surfaces hide them on the web). Files over 40 MB are left out of uploads; uploads cap at 200 MB.
Workspaces over 2 GB are warned. The Ollama row says local models need the desktop app.
