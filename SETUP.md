# Everything you have to do by hand

Work through this in order. Each step unblocks the ones under it, so skipping ahead mostly
produces confusing errors rather than progress.

The code is finished and tested — 1496 tests, all green. Nothing below is a coding task.
Every item needs your account, your card, or your signature, which is exactly why it isn't
already done.

**Costs money:** step 4 (Blaze), step 12 (code signing, optional), step 15 (a lawyer).
Everything else is free.

---

## Phase 0 — See what's already built, right now

Free, no accounts, five minutes. Do this first so the rest has context.

### 0.1 · The sign-in UI is hidden unless you pass a key

This is almost certainly why `npm start` looked unchanged. The account button, the welcome
screen sign-in row, and the earnings prompt **hide themselves** when there is no Firebase
key, because a button that cannot work is worse than no button.

Two changes are visible without any key — the **settings icon is now a gear** (bottom of
the activity bar) and the **feedback icon is a speech bubble** rather than a bell (top
right, after the search box).

To see the sign-in surfaces, pass your project's key:

```powershell
$env:ADCODE_FIREBASE_API_KEY = "AIzaSyATZzX5Fw2HjR34VxB3UQWTmljprA5uXqE"
npm start
```

You should now see a person icon in the title bar after the speech bubble, and a row on
the welcome screen reading *"Sign in to keep your earnings — recommended"*. The buttons
will not complete a sign-in yet — that needs steps 5 and 6.

- [ ] Ran with the key, saw the account button and welcome row

### 0.2 · The website

```
npm run web
```

Then open `http://localhost:3000`. The public pages all work offline. `/portal`,
`/dashboard`, and `/admin` will say sign-in isn't configured until step 4.

- [ ] Opened the site and clicked through it

---

## Phase 1 — Decisions only you can make

### 1 · Read the terms and privacy pages

`/terms` and `/privacy` on the local site. **The terms page says in its own first paragraph
that it is a template and has not been reviewed by a lawyer.** That is true. Read both now
so you know what they claim, because step 15 is where that gets fixed.

The privacy page is written against what the code actually does — the closed 45-tag
vocabulary, no filename field in the serve request. If you change what is collected, that
page becomes wrong.

- [ ] Read both

### 2 · Decide whether the economics work

At the shipped rates a user earns **about $0.016 an hour** — roughly $2.50 a month at
full-time use. The marketing site states this openly rather than burying it.

If that is wrong for your business, the levers are `defaultCpmMicros` and
`revSharePercent` in the `config/serving` document (step 7). Changing them changes every
figure on the site and in the editor with no code change and no client release.

- [ ] Decided the rate, or accepted the defaults

### 3 · Create a GitHub repository and push

This repo has **no git remote at all**. That blocks two separate things:

- Firebase App Hosting deploys *from* a GitHub repository. It cannot deploy from your disk.
- The installers and the auto-updater fetch releases from GitHub.

Create the repo, then:

```
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

Then replace the `adcode/adcode` placeholder in **three** places:

| File | What to change |
|---|---|
| `electron-builder.yml` | `publish.owner` and `publish.repo` |
| `apps/web/public/install.ps1` | the `$Owner` / `$Repo` defaults |
| `apps/web/public/install.sh` | the `OWNER` / `REPO` defaults |

Getting this wrong ships installers that check an update feed nobody publishes to. They
never update again, and there is no way to fix it remotely.

- [ ] Repo created, pushed, all three files updated

---

## Phase 2 — Firebase

Project **`adcode-idle`** (number `345488063416`) already exists and has a web app
registered. Its public config is already in `apps/web/apphosting.yaml`.

### 4 · Upgrade to the Blaze plan

https://console.firebase.google.com/project/adcode-idle/usage/details

This is the single gate in front of everything server-side: App Hosting, Cloud Run,
Cloud Functions, and Firestore all refuse to work on the free Spark plan. It needs a card.

**Set a budget alert while you are there.** Blaze is pay-as-you-go with no cap by default.

- [ ] On Blaze, budget alert set

### 5 · Enable authentication providers

Firebase console → **Authentication → Sign-in method**. Enable all four:

| Provider | Why |
|---|---|
| **Anonymous** | The editor signs in with no UI on first launch. Without this, nothing earns. |
| **Google** | Sign-in from the editor and the web |
| **GitHub** | Same |
| **Email/Password** | Advertiser and admin sign-in on the web |

Anonymous is the one that breaks everything if you forget it.

- [ ] All four enabled

### 6 · Create the OAuth client IDs

Full walkthrough in **`docs/OAUTH-SETUP.md`**. The two settings that will cost you an
afternoon if wrong:

- Google's client **must be type "Desktop app"**, not "Web application". Only Desktop
  permits the loopback redirect the editor uses.
- GitHub's **"Enable Device Flow" checkbox is off by default**. With it off, sign-in never
  starts.

Paste both IDs into the marked block at the top of `apps/desktop/src/main/oauth.ts`.

- [ ] Google client ID created and pasted
- [ ] GitHub client ID created, device flow enabled, ID pasted

### 7 · Enable Firestore and seed the config

Firebase console → **Firestore Database → Create database**.

**The location is permanent.** You cannot change it later without a new project. On IST,
`asia-south1` (Mumbai) is likely right.

Then create one document, `config/serving`:

```
killSwitch:        false
caps:              { minIntervalMs: 300000, dailyCap: 12 }
defaultCpmMicros:  "8000000"      ← $8.00 CPM
revSharePercent:   "50"           ← the user's cut
spendShardCount:   4
serveTtlMs:        600000
rateWindowMs:      60000
requestsPerWindow: 120
```

**Money fields are strings, not numbers.** Firestore hands integers back to JavaScript as
doubles, which lose precision above 2^53. The service parses these as BigInt.

- [ ] Firestore created, location chosen deliberately
- [ ] `config/serving` seeded, money fields as strings

### 8 · Set the TTL policies

Firestore → **TTL**. Two collections grow without bound otherwise:

| Collection | TTL field |
|---|---|
| `serves` | `expiresAt` |
| `rateCounters` | `expiresAt` |

- [ ] Both TTL policies created

### 9 · Deploy the rules

```
npx firebase deploy --only firestore:rules,storage
```

Both rule sets deny all direct client access on purpose. The browser never talks to
Firestore — only to `services/api`, which uses the Admin SDK and bypasses rules.

- [ ] Rules deployed

### 10 · Make yourself an admin

The admin claim lives in the Firebase token, not a database row. Sign in once on the web
so your account exists, find your UID in Authentication, then run once from anywhere with
the Admin SDK:

```js
await getAuth().setCustomUserClaims("<your-uid>", { admin: true });
```

It takes effect on your **next sign-in**, not immediately.

- [ ] Admin claim set, signed out and back in, `/admin` loads

---

## Phase 3 — Deploy

### 11 · The API

```
gcloud auth login
gcloud config set project adcode-idle
gcloud run deploy adcode-api --source . --dockerfile services/api/Dockerfile
```

Environment it needs:

| Variable | Purpose |
|---|---|
| `DODO_API_KEY` | Creating checkout links |
| `DODO_PRODUCT_ID` | The product advertiser funding bills against |
| `DODO_WEBHOOK_SECRET` | Verifying settlement webhooks (`whsec_…`) |
| `DODO_MODE` | `live` for real money; anything else stays in test |

Then point **api.adcode.bluethenics.com** at it.

- [ ] Deployed, DNS pointed, `/v1/config` responds

### 12 · The website

```
npx firebase apphosting:backends:create --project adcode-idle
```

App Hosting, not classic Hosting — the site is not static. The blog revalidates every 60s
so admin-published posts appear without a deploy, and one route renders on demand.

Point **adcode.bluethenics.com** at the backend it gives you.

- [ ] Deployed, DNS pointed, site loads on the real domain

---

## Phase 4 — Money in

### 13 · Dodo Payments

1. Create a product for advertiser funding; note its ID.
2. Add a webhook endpoint: `https://api.adcode.bluethenics.com/v1/webhooks/dodo`
3. Copy the signing secret into `DODO_WEBHOOK_SECRET`.
4. **Test in test mode first.** `services/api/adapters/dodoPayments.ts` was written from
   the published API reference and **has never run against a real account** — treat its
   request shape as a first draft. The webhook half (signature verification, idempotent
   crediting) has 28 tests and is the half that would cost you money if wrong.

- [ ] Test-mode payment completed end to end, balance appeared in the portal

---

## Phase 5 — Distribution

### 14 · Ship a release

```
npm run package
gh release create v0.1.0 release/*
```

Publish the `latest.yml`, `latest-mac.yml`, and `latest-linux.yml` files alongside the
binaries — the updater reads them to find updates and the install scripts read them to
verify checksums.

**Packaging note:** applying Electron fuses while electron-builder is still downloading
Electron fails with `Unable to update lock within the stale threshold`. It is a lock
collision, not a config error. Re-run once the download has cached.

Builds are **unsigned**. Windows shows a SmartScreen warning, macOS calls the app
unidentified. Both download pages say so. Signing needs an OV/EV certificate
(~$200–600/yr, days to issue) plus an Apple Developer account ($99/yr) for notarisation.

- [ ] Release published
- [ ] Installed from `https://adcode.bluethenics.com/install.ps1` on a clean machine
- [ ] Decided about code signing

---

## Phase 6 — Before real users and real money

### 15 · Have a lawyer read the terms

`apps/web/src/app/terms/page.tsx`. Non-negotiable before you take advertiser money or owe
users a payout.

- [ ] Reviewed

### 16 · Run the Firestore adapter tests once

Install a JDK (the emulator is a Java process), then:

```
npm run test:emulator
```

`services/api/adapters/firestoreStore.ts` **has never been executed.** It typechecks and
everything above it is fully covered, but the adapter itself — bigint round-trips,
transaction atomicity, receipt idempotency — has never run against a real Firestore.

- [ ] Emulator suite passed

### 17 · Decide about payouts

**Users can earn but cannot withdraw.** The ledger has `withdrawal_requested`,
`withdrawal_paid`, and `withdrawal_failed` with `providerRef` and `currency` shaped for
Wise, and the balance fold is unit-tested against all three — but **no endpoint raises
them**. Cash-out is additive when you build it, not a migration over live money, which is
why those entry kinds exist now.

Building it needs Wise API access, and paying people needs KYC and tax handling.

- [ ] Decided when payouts happen, and told users honestly in the meantime

---

## Reference — every environment variable

**`services/api`** (Cloud Run)

| Variable | Required | Purpose |
|---|---|---|
| `DODO_API_KEY` | for billing | Checkout links |
| `DODO_PRODUCT_ID` | for billing | Product funding bills against |
| `DODO_WEBHOOK_SECRET` | for billing | Webhook signature verification |
| `DODO_MODE` | no | `live` for real money |
| `ADCODE_CORS_ORIGINS` | no | Extra allowed origins, comma-separated |

**`apps/web`** — already set in `apps/web/apphosting.yaml`.

**`apps/desktop`** — baked in at build time.

| Variable | Required | Purpose |
|---|---|---|
| `ADCODE_FIREBASE_API_KEY` | yes | Anonymous auth and account linking |
| `ADCODE_GOOGLE_CLIENT_ID` | for Google | Or paste into `oauth.ts` |
| `ADCODE_GITHUB_CLIENT_ID` | for GitHub | Or paste into `oauth.ts` |
| `ADCODE_AD_SERVER` | no | Points at the mock server for development |
| `ADCODE_AD_DEBUG` | no | `1` logs why an ad was or wasn't shown |
| `ADCODE_DISABLE_UPDATES` | no | `1` turns off the updater |
