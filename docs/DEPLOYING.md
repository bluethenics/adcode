# Deploying ADCode

Everything in the repo is built and tested. What remains needs credentials, a card, and in
one place a lawyer — none of which can be done from a keyboard here.

Work through this in order; each step unblocks the next.

---

## 1. Google Cloud and Firebase

1. Create a GCP project and enable billing.
2. Enable **Firestore in Native mode**.
3. Create a Firebase project on top of it.
4. In Firebase Auth, enable **Anonymous** (the editor needs it), **Email/Password**, and
   **Google** (the portal and admin panel use these).
5. Deploy the security rules in `firestore.rules`. They deny every direct client read and
   write, deliberately — the browser never talks to Firestore, only to `services/api`,
   which uses the Admin SDK and bypasses rules.

Then set two TTL policies in Firestore, or these collections grow without bound:

| Collection | TTL field |
|---|---|
| `serves` | `expiresAt` |
| `rateCounters` | `expiresAt` |

## 2. Seed serving config

`services/api` reads its rates from a single document, `config/serving`. Create it:

```
killSwitch:        false
caps:              { minIntervalMs: 300000, dailyCap: 12 }
defaultCpmMicros:  "8000000"      # $8.00 CPM
revSharePercent:   "50"           # the user's cut
spendShardCount:   4
serveTtlMs:        600000
rateWindowMs:      60000
requestsPerWindow: 120
```

Money fields are **strings**, not numbers. Firestore hands integers back to JavaScript as
doubles, which silently lose precision above 2^53; the service parses these as BigInt.

## 3. Make yourself an admin

The admin claim lives in the Firebase token, not in a database row:

```js
await getAuth().setCustomUserClaims(uid, { admin: true });
```

It takes effect on that account's next sign-in.

## 4. Deploy the API

```
gcloud run deploy adcode-api --source . --dockerfile services/api/Dockerfile
```

Environment it needs:

| Variable | Purpose |
|---|---|
| `DODO_API_KEY` | Creating checkout links |
| `DODO_PRODUCT_ID` | The product advertiser funding is billed against |
| `DODO_WEBHOOK_SECRET` | Verifying settlement webhooks (`whsec_…`) |
| `DODO_MODE` | `live` for real money. Anything else stays in test mode |
| `ADCODE_CORS_ORIGINS` | Extra allowed origins, comma-separated, for local development |

Point DNS at it: **api.adcode.bluethenics.com**.

## 5. Deploy the site

```
npm --prefix apps/web run build
```

Environment:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SITE_ORIGIN` | Canonical URLs, sitemap, installer commands |
| `NEXT_PUBLIC_API_ORIGIN` | Where the browser calls the API |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Browser sign-in |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Browser sign-in |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Browser sign-in |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Browser sign-in |

The `NEXT_PUBLIC_FIREBASE_*` values are public by design — they identify the project, they
do not authorise anything. What protects the data is token verification in the API.

Point DNS at it: **adcode.bluethenics.com**.

## 6. Dodo Payments

1. Create a product for advertiser funding; note its id.
2. Add a webhook endpoint: `https://api.adcode.bluethenics.com/v1/webhooks/dodo`.
3. Copy the signing secret into `DODO_WEBHOOK_SECRET`.
4. **Test in test mode first.** `services/api/adapters/dodoPayments.ts` was written from
   the published API reference and has never been run against a real account. Its request
   shape is a first draft. The webhook side — signature verification, idempotent
   crediting — is covered by 28 tests and is the half that would cost you money if wrong.

## 7. Releases and updates

Set the real GitHub owner and repo in **two** places, or installers will check an update
feed nobody publishes to and never update again:

- `electron-builder.yml` → `publish.owner` / `publish.repo`
- `apps/web/public/install.ps1` and `install.sh` → the `adcode/adcode` defaults

Then:

```
npm run package                       # builds installers into release/
gh release create v0.1.0 release/*    # publish, including latest*.yml
```

The `latest.yml`, `latest-mac.yml`, and `latest-linux.yml` files matter: electron-updater
reads them to find updates, and the install scripts read them to verify checksums. Publish
them with the binaries.

Builds are **unsigned**. Windows shows a SmartScreen warning and macOS calls the app
unidentified. Both download pages say so. Signing needs an OV/EV certificate (~$200-600/yr,
several days to issue) and, for macOS, an Apple Developer account for notarisation.

## 8. Before real money moves

- **Have a lawyer read `apps/web/src/app/terms/page.tsx`.** It says in its own first
  paragraph that it is a template and has not been reviewed. That is true.
- Run `npm run test:emulator` once with a JDK installed. It exercises the Firestore
  adapter — bigint round-trips, transaction atomicity, receipt idempotency — and has never
  been run.
- Decide whether the economics work for you. At the shipped defaults a user earns about
  **$0.016 an hour**, roughly $2.50 a month at full-time use. Both figures are on the
  marketing site deliberately. Changing `defaultCpmMicros` or `revSharePercent` in
  `config/serving` changes them everywhere with no client release.

## What is designed but not built

**Paying users out.** The ledger has `withdrawal_requested`, `withdrawal_paid`, and
`withdrawal_failed`, with `providerRef` and `currency` shaped for Wise, and the balance
fold is unit-tested against all three. No endpoint raises them yet. Cash-out is additive
when you build it, not a migration over live money — which is why they exist now.
