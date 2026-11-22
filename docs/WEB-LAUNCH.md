# ADCode web launch

> **Superseded (2026-11-21).** The web version no longer gives each person a cloud sandbox: it runs
> the desktop's main process in the tab with projects from GitHub. See `WEB-VERSION.md`. The
> container checks below no longer exist.

The consolidated source is on `codex/web-launch-2026-10-18`. This is a local integration branch, not a production deployment. The marketing site/API (`apps/web`) and browser workspace (`apps/cloud`) deploy separately.

## Source and verification

- Account controls share the existing website implementation and open inside the workspace.
- Mobile navigation, official Lucide icons, preview feedback, helper timelines, connectors and workspace resizing are integrated.
- Failed restoration cannot expose or snapshot an empty replacement home.
- The shared monthly cloud budget now pauses existing sessions as well as new admissions. The interval is 60 seconds plus save/stop time; it is not a precise provider billing cap.
- Cloud type checking is included in `npm run verify` and both verification/release workflows install the cloud dependencies.
- Cloud builds require all syntax grammars; the container uses a committed dependency lockfile.

Run the following before deployment:

```sh
npm run verify
npm run cloud:build
npm run web:build
npm run smoke:web-vibe -- --no-build
npm run smoke:cloud-container
```

Account acceptance uses synthetic responses, never real payouts. `npm run smoke:account` requires a local Vite server; set `ADCODE_ACCOUNT_TEST_URL` if its port differs from 5180. Run heavy browser checks separately on machines where concurrent Chromium fixtures cause contention.

The container check requires a working local Linux Docker engine and the freshly generated cloud bundle. It builds the image, then checks the real bundled host, secret-protected access, Git/files, Chromium at desktop and phone sizes, native terminal commands, downloads and home-archive restoration in two fresh disposable containers. Runtime networking is isolated, no host ports are published, and cleanup removes only the check's own labeled containers/network. Test traffic reaches container loopback through the local Docker connection. It leaves the image available locally and writes screenshots/results under `.tmp/cloud-container-check-*/`. `-- --no-build` checks the existing image and verifies its host bundle against the current build.

## Production preparation and remaining launch steps

1. Inspect migration history AND actual objects. The initial inspection found the legacy tables/RPCs present and credit windows/RPCs missing. Preparation is now complete after explicit approval.
2. Completed: applied `supabase/migrations/20261018184813_free_ai_credits.sql`, then `supabase/migrations/20261018184823_unlimited_included_ai.sql`. The filenames now match the remote migration versions. Do not replay them on production; migration history and actual schema were verified.
3. Completed: verified `reserve_included_ai` (16 arguments), `settle_included_ai` (7), and `reserve_unlimited_ai` (16). Require service-role execution, no anonymous/authenticated execution, and RLS on `ai_credit_windows`. Keep legacy RPCs for rollback.
4. Completed: added proxied wildcard DNS `*.web.bluethenics.com` as AAAA `100::`. Public DNS resolves, normal TLS verification succeeds, and an unknown preview ID returns the expected 404. A real authenticated preview remains part of deployment acceptance.
5. Completed on 2026-10-19: the Linux image build and full runtime acceptance passed, including real Chromium, native terminal commands and restoration into a fresh home. Repeat with `npm run smoke:cloud-container`. Both stopped Docker data disks and settings were backed up and hash-verified before a supported in-place update to Docker Desktop 4.95.0; Linux Engine 29.8.2 is healthy and existing inventory/preferences remain available. No reset or reboot was performed. The image explicitly permits the pinned native terminal dependency's install scripts and verifies that its Linux binding loads during build. A Worker-only dry run skips the image checks.
6. After launch authorization, record fresh deployment version IDs, then deploy the reviewed website/API followed by the cloud Worker, assets and image together. The cloud configuration includes `ACCOUNT_API` bound to the existing `adcode` Worker. Current production predates this account gateway. Run `node scripts/cloud-probe.mjs https://web.bluethenics.com` and inspect every result: the production page must omit development sign-in, send its security headers, and reject unauthenticated API/socket access and foreign origins. The probe prints findings; its exit code alone is not acceptance.
7. Complete signed-in acceptance: Google/GitHub or email login, workspace startup, a real included-AI request AND settlement, file editing, preview, reconnect, saved-home restore, and account navigation. Use a test account; synthetic tests do not establish real payouts or provider entitlement.

`web.bluethenics.com` is already in Firebase's authorized domains. Presence of secret names does not verify their values. Only the explicitly approved database and preview DNS preparation changed production. No application deployment, payment action, or email send was performed.

The `adcode-cloud-homes` bucket's enabled 90-day object expiration rule was independently verified through the Cloudflare API on 2026-10-19.

## Rollback and local work

Record current deployment version IDs before publishing. Roll back application code if needed; keep additive credit tables/columns/RPCs so old and new code remain compatible. Both budget RPC response shapes are accepted during rolling deployment.

Local campaign drafts, chat exports, AI notes and workspace memory remain on disk and excluded from release source. Completed features were integrated, obsolete clean checkouts retired, and all branch history retained. The private inventory, file hashes, patches and verification logs are in `.tmp/launch-readiness-2026-10-18/`. Do not blanket-stage personal files or delete an intentionally locked worktree.
