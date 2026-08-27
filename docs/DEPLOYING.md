# Deploying ADCode

**[`SETUP.md`](../SETUP.md) is the authority.** It is a numbered click path from an empty
account to a running deployment, and it is kept in step with the code. Follow it.

This file is the shorter, architectural companion: what the deployment *is*, and the
release step, which SETUP.md covers in one paragraph because it is the same on every
platform and does not need clicking through a dashboard.

---

## What the deployment is

One Cloudflare Worker. `apps/web` is a Next app built through `@opennextjs/cloudflare`, and
`services/api` is folded into it at `apps/web/src/app/v1/[...segments]/route.ts` — so the
marketing site, the dashboard, the advertiser portal, the admin panel and the API are one
origin, one certificate and one set of secrets. There is no second host to keep alive and no
CORS preflight on the common path.

Behind it:

| Piece | What it holds | Why |
|---|---|---|
| **Supabase Postgres** | every table, and the five money-critical operations as Postgres functions | PostgREST cannot do transactions, so anything that must not half-apply is a function |
| **Firebase** | authentication only | free on Spark forever; tokens are verified with Web Crypto in `adapters/firebaseJwks.ts`, because `firebase-admin` cannot run on workerd |
| **Dodo Payments** | advertiser funding | the only paid dependency, and only once you have advertisers |

Worker secrets are `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `FIREBASE_PROJECT_ID`.
Everything else is a `NEXT_PUBLIC_` build-time value in `apps/web/.env.production` and is
public by design — those identify the project, they do not authorise anything.

> **Not Firestore, not Cloud Run.** An earlier version of this file described a Google
> Cloud deployment: Firestore in Native mode, `gcloud run deploy`, an `api.` subdomain, and
> the admin bit as a Firebase custom claim. All of it needed Blaze, so on 2026-08-24 it was
> replaced by the stack above. `services/api/adapters/firestoreStore.ts` still exists and is
> still tested, but nothing deploys it, and `firestore.rules` is dead weight for the same
> reason. Admin is now a row in Supabase, matched on the verified email in the token —
> `services/api/src/auth.ts`.

## Deploying

```
cd apps/web && npm run deploy
```

Three things break only here, and none of them names its own cause:

1. **Never `npm install` inside `apps/web`.** Next and `@opennextjs/aws` find the workspace
   root by walking up to the first lockfile. A `package-lock.json` in `apps/web` makes them
   stop there, which puts `services/api` outside the project — `module-not-found` on every
   adapter. Install from the repository root.
2. `output: "standalone"` in `next.config.ts` is **required**. `@opennextjs/aws` reads
   `.next/standalone` by hard-coded path.
3. `wrangler secret put` refuses until a version is deployed. Deploy first, secrets second.

`npm run verify` and `npm run web:build` from the root pass while any of these fails, which
is why they are listed rather than trusted to a test.

## Releases and updates

The GitHub owner and repo appear in **four** places, and all four are already
`bluethenics/adcode`. If you ever fork or rename, change all four together — getting this
wrong ships installers that check an update feed nobody publishes to, and there is no way to
fix that remotely:

- `electron-builder.yml` → `publish.owner` / `publish.repo`
- `apps/web/public/install.ps1` → the `$Owner` / `$Repo` defaults
- `apps/web/public/install.sh` → the `OWNER` / `REPO` defaults
- `apps/web/.env.production` → `NEXT_PUBLIC_GITHUB_REPO`

Then:

```
npm run package                       # builds installers into release/
gh release create v0.1.0 release/*    # publish, including latest*.yml
```

The `latest.yml`, `latest-mac.yml` and `latest-linux.yml` files matter: electron-updater
reads them to find updates, and the install scripts read them to verify checksums. Publish
them with the binaries.

Until a release exists, `/download` and `/dl/<platform>` answer "That build isn't published
yet" — the site is up and the button is dead. Shipping the first release is what turns the
download page on.

Builds are **unsigned**. Windows shows a SmartScreen warning and macOS calls the app
unidentified. Both download pages say so. Signing needs an OV/EV certificate (~$200-600/yr,
several days to issue) and, for macOS, an Apple Developer account for notarisation.

## Before real users

- **Have a lawyer read `apps/web/src/app/terms/page.tsx`.** Its own second paragraph says it
  is a template and has not been reviewed, and that paragraph is live on the site right now.
- **The support addresses have to exist.** `terms`, `privacy` and `advertise` publish
  `support@`, `privacy@` and `advertise@adcode.bluethenics.com`. That domain has no DNS
  record until SETUP.md step 13, so today those are three promises nobody can keep.
- Decide whether the economics work for you. Campaigns compete in a second-price auction
  from $1 per 500 impressions, and developers receive 50% of each clearing price. Earnings vary
  with live demand and should not be presented as a fixed hourly figure.

## What is designed but not built

**Automatic payouts.** Cash-out is built, but the transfer itself is made by hand: a user
requests at least $50, `withdrawal_requested` holds the amount, an administrator approves
it, uses a legally permitted manual bank-transfer method, and records the reference, which
raises `withdrawal_paid`. An India personal Wise account must not be assumed valid for
business-related developer payouts; verify that use with Wise before enabling a route. Nothing
here talks to a payout API, and adding one would replace only the admin decision — the
ledger, the holds and the eligibility rules are already the shape a provider would need.
