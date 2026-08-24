# Everything you have to do by hand

Work through this in order. Each step unblocks the ones under it, so skipping ahead mostly
produces confusing errors rather than progress.

Every step is written out click by click. Where a step says "you should see", check that you
see it before moving on — that is the whole point of the sentence.

**What this costs: nothing.** Supabase, Cloudflare, Firebase Authentication and GitHub are
all used inside their free tiers, and none of them asks for a card. The only steps that ever
cost money are optional and clearly marked: code signing (step 16) and a lawyer (step 18).

**No coding.** The code is finished and tested — 2119 tests, all green. Everything below
needs your account or your decision, which is exactly why it is not already done.

---

## Already done, on 2026-08-24

The first deployment is live. Steps 3 to 12 are finished; what is left is marked below.

| | |
|---|---|
| Live URL | **https://adcode.bluethenics01.workers.dev** |
| GitHub | `bluethenics/adcode` — `main` is the code, `design-docs` keeps the original plan |
| Supabase project | `adcode` · ref `fwtpczrutatendnuavsb` · region `ap-southeast-2` |
| Firebase project | `adcode-idle` — Anonymous, Google, GitHub, Email/Password all enabled |
| Worker secrets | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FIREBASE_PROJECT_ID` |
| Verified | `/v1/health` → `{"ok":true}`, 14 pages 200, `/v1/balance` 401 without a token, sign-in and dashboard working |

`NEXT_PUBLIC_SITE_ORIGIN` in `apps/web/.env.production` and `apps/web/wrangler.jsonc` is set
to the `workers.dev` hostname, because that is where the site actually answers. **Change both
to `https://adcode.bluethenics.com` once step 13 is done**, delete `apps/web/.next` and
`apps/web/.open-next`, and deploy again - canonical URLs, the sitemap and the social preview
tags all read from it. The API calls do not: the browser calls `/v1/*` same-origin, so those
keep working at whatever address the page is served from.

Firebase → Authentication → Settings → **Authorized domains** must list every hostname people
sign in from. Both `adcode.bluethenics01.workers.dev` and `adcode.bluethenics.com` are in it.

**Still to do: step 13** (your own domain) and the keepalive at the end of it — which
matters more than it looks, because a free Supabase project pauses after seven days idle.
Step 14 is already done: `bluethenics01@gmail.com` is the founding administrator, and more
can be appointed from `/admin` → **Admins**.

> ### `adcode` instead of `npm run …`
>
> `npm link` once from the repository root, and every command below has a shorter name that
> says what it does. `adcode open` builds and opens the editor, `adcode site` runs the
> website, `adcode check` runs everything, `adcode ship` deploys. `adcode help` lists them.
> The npm scripts still work; this is a name over the top of them, not a replacement.

> ### Never run `npm install` inside `apps/web`
>
> Install from the repository root instead. `apps/web` has no lockfile on purpose: Next and
> OpenNext both find the workspace root by walking up until they hit one, and a lockfile
> there makes them stop at `apps/web` — which puts `services/api` outside the project.
> `npm install` in that folder recreates it, and the next deploy fails with a
> `module-not-found` on every adapter, or a missing `pages-manifest.json`. Neither error
> mentions the lockfile.

---

## What you are building

One thing, on one address.

```
                    adcode.bluethenics.com
                             │
                  ┌──────────┴───────────┐
                  │  Cloudflare Worker   │   free, no card
                  │  ──────────────────  │
                  │  the website         │
                  │  /v1/*  the API      │
                  └──────┬────────┬──────┘
                         │        │
              ┌──────────┘        └──────────┐
              ▼                              ▼
   ┌────────────────────┐        ┌────────────────────────┐
   │ Supabase Postgres  │        │  Firebase Auth         │
   │ every table, the   │        │  who is signed in      │
   │ money ledger       │        │  (free plan, no card)  │
   └────────────────────┘        └────────────────────────┘
```

The website and the API are **one deployment**. That is deliberate: one hostname, one
certificate, one set of secrets, and no CORS. The editor on someone's laptop talks to
`https://adcode.bluethenics.com/v1/...`, and so do the portal and admin pages.

---

## Phase 0 — See what's already built, right now

Free, no accounts, five minutes. Do this first so the rest has context.

### 0.1 · Run the editor

```powershell
npm start
```

The account button and the "Sign in to keep your earnings" row on the welcome screen stay
hidden until there is a Firebase key to make them work — a button that cannot work is worse
than no button. You will switch them on in step 6.

Things you can look at with no accounts at all:

- **The bottom panel** — press <kbd>Ctrl</kbd>+<kbd>J</kbd>. Five tabs: Problems, Output,
  Debug Console, Terminal, Ports.
- **Ports** — click the Ports tab. It lists everything listening on your machine, names the
  process holding each port, and marks the ones ADCode started. This is the answer to
  "something is already using 3000".
- **Output** — the dropdown picks a log: Dev Server, Live Server, Git, Language Server.
  Run a git action and watch the Git channel fill up.
- **Responsive preview** — open a folder with an `index.html`, start the live preview, then
  click the tablet-and-phone icon in the preview bar. Pick a device, drag the frame's edge,
  press Rotate. The page never reloads while you do it.

- [ ] Ran the editor and looked at the five tabs

### 0.2 · Run the website

```
npm run web
```

Open `http://localhost:3000`. Every public page works with no accounts. `/portal`,
`/dashboard` and `/admin` will say sign-in is not configured until step 6.

- [ ] Opened the site and clicked through it

---

## Phase 1 — Decisions only you can make

### 1 · Read the terms and privacy pages

`/terms` and `/privacy` on the local site. **The terms page says in its own first paragraph
that it is a template and has not been reviewed by a lawyer.** That is true. Read both now so
you know what they claim, because step 18 is where that gets fixed.

The privacy page is written against what the code actually does. If you change what is
collected, that page becomes wrong.

- [ ] Read both

### 2 · Decide whether the economics work

At the shipped rates a user earns **about $0.016 an hour** — roughly $2.50 a month at
full-time use. The marketing site states this openly rather than burying it.

If that is wrong for your business, the levers are `default_cpm_micros` and
`rev_share_percent` in the `serving_config` table, which you can edit in the Supabase table
editor after step 4. Changing them changes every figure on the site and in the editor with no
code change and no release.

- [ ] Decided the rate, or accepted the defaults

### 3 · Create a GitHub repository and push

This repo has **no git remote**. That blocks two things: the installers and the auto-updater
fetch releases from GitHub, and the daily keepalive in step 13 runs as a GitHub Action.

```
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

Then replace the `adcode/adcode` placeholder in **four** places:

| File | What to change |
|---|---|
| `electron-builder.yml` | `publish.owner` and `publish.repo` |
| `apps/web/public/install.ps1` | the `$Owner` / `$Repo` defaults |
| `apps/web/public/install.sh` | the `OWNER` / `REPO` defaults |
| `apps/web/.env.production` | `NEXT_PUBLIC_GITHUB_REPO` (you create this file in step 7) |

Getting this wrong ships installers that check an update feed nobody publishes to. They never
update again, and there is no way to fix it remotely.

- [ ] Repo created, pushed, all four places updated

---

## Phase 2 — Supabase (the database)

This is where every table lives: users, campaigns, creatives, and the money ledger.

### 4 · Create the project

1. Go to **https://supabase.com** and click **Start your project**.
2. Sign in with GitHub. (Same account as step 3 is easiest.)
3. Click **New project**.
4. Fill in the form:
   - **Name**: `adcode`
   - **Database Password**: click **Generate a password**, then **copy it somewhere safe
     now**. You will not be shown it again. You do not need it for this setup, but you will
     the first time something goes wrong.
   - **Region**: the one physically closest to most of your users. If your users are in
     India, pick **South Asia (Mumbai)**. This is worth thinking about for ten seconds and
     then never again: **you cannot change it later without creating a new project.**
   - **Plan**: **Free**.
5. Click **Create new project** and wait. It takes about two minutes.

You should see a dashboard with your project name at the top left.

- [ ] Project created, database password saved somewhere safe

### 5 · Create the tables

1. In the left sidebar, click the **SQL Editor** icon (it looks like a terminal prompt).
2. Click **New query**.
3. Open `supabase/migrations/20260824000000_init.sql` from this repo in any text editor.
   Select all of it and copy it.
4. Paste it into the SQL editor.
5. Click **Run** (or press <kbd>Ctrl</kbd>+<kbd>Enter</kbd>).

You should see **"Success. No rows returned"** in the results area at the bottom.

If you see an error instead, read the message — it will name the line. Do not run the file
twice hoping it fixes itself; it is safe to re-run, but a real error will just happen again.

To check it worked: click **Table Editor** in the sidebar. You should see 18 tables, starting
with `advertisers` and `audit_log`. Click `serving_config` — it should contain exactly one
row, with `default_cpm_micros` of `8000000`.

- [ ] "Success. No rows returned", 18 tables exist, `serving_config` has one row

### 5b · Add the reporting and activity tables

This is a second, smaller migration. It adds the timestamp that makes the advertiser charts
possible and the table the editor reports coding activity into. **Run it after step 5, not
instead of it.**

1. Still in the **SQL Editor**, click **New query**.
2. Open `supabase/migrations/20260824190000_activity_and_receipt_time.sql` from this repo.
   Select all of it and copy it.
3. Paste it in and click **Run**.

You should see **"Success. No rows returned"** again.

To check it worked: click **Table Editor** and look for a new table called
`activity_daily` — that makes 19. Then click `receipts` and confirm it now has a
`created_at` column on the right-hand end.

If you skip this, the site still runs, but the portal's charts stay empty and the
dashboard's "Coding" tab says no activity has been recorded.

- [ ] "Success. No rows returned", `activity_daily` exists, `receipts` has `created_at`

### 6 · Copy the two Supabase values

1. In the left sidebar, click the **gear icon** at the bottom (**Project Settings**).
2. Click **API keys** (older dashboards call this section **API**).
3. You need two things from this page. Copy each into a scratch file for a moment:

| What | Looks like | Where |
|---|---|---|
| **Project URL** | `https://abcdefghijkl.supabase.co` | Under **Project URL**, or **Data API** |
| **`service_role` key** | a very long string starting `eyJ...` | Under **Project API keys**. Newer projects label this the **secret key**. You may have to click **Reveal**. |

> **The `service_role` key bypasses every security rule in the database.** Anyone who has it
> can read and rewrite the money ledger. It goes in exactly one place — a Cloudflare secret,
> in step 8. Never put it in a file in this repo, never paste it into a chat or an issue, and
> never let it reach the browser. If you ever think it leaked, come back to this page and
> click the rotate/reset option next to it.
>
> The *other* key on that page — `anon`, or the **publishable key** — is safe to expose, and
> this project does not use it at all. The database has row level security switched on with
> no policies, so that key can read nothing.

- [ ] Both values copied somewhere temporary

---

## Phase 3 — Firebase (sign-in only)

Firebase is used for one job: proving who a user is. No database, no hosting, no Blaze plan,
no card.

### 7 · Enable the sign-in methods

1. Go to **https://console.firebase.google.com** and open the **`adcode-idle`** project. (If
   it does not exist, click **Add project**, name it `adcode-idle`, and turn Google Analytics
   off — it is not used.)
2. In the sidebar, click **Build → Authentication**, then **Get started**.
3. Open the **Sign-in method** tab and enable all four:

| Provider | Why |
|---|---|
| **Anonymous** | The editor signs in with no UI on first launch. Without this, nothing earns. |
| **Google** | Sign-in from the editor and the web |
| **GitHub** | Same. Needs one more step - see 7b, or the button fails. |
| **Email/Password** | Advertiser and admin sign-in on the web |

**Anonymous is the one that breaks everything if you forget it.**

4. Still in Authentication, open **Settings → Authorized domains** and click **Add domain**.
   Add `adcode.bluethenics.com`. Without this, Google sign-in from the live site fails with a
   message about an unauthorised domain — and it will look like a code bug.

- [ ] All four providers enabled, `adcode.bluethenics.com` in Authorized domains

### 7b · GitHub sign-in *on the website*

Ticking **GitHub** in step 7 is not enough on its own. Google works with one switch because
Firebase already has Google's credentials; every other provider needs an app you register
yourself. Firebase will show the GitHub row as enabled and every attempt will fail with
*"That sign-in method is switched off"* until you do this.

This is a **different** OAuth app from the one in step 9b. That one is for the desktop
editor and uses the device flow; this one is for a browser popup and needs a callback URL.
One app cannot be both.

**First, get the callback URL from Firebase.**

1. In the Firebase console, **Build → Authentication → Sign-in method**.
2. Click the **GitHub** row.
3. Near the bottom is a line reading **"Authorisation callback URL"** with a value like
   `https://adcode-idle.firebaseapp.com/__/auth/handler`. Click the copy icon next to it.
   **Leave this tab open** — you come back to it in a moment.

**Then register the app on GitHub.**

4. In a new tab, go to **https://github.com/settings/developers**.
5. Click **OAuth Apps**, then **New OAuth App**.
6. Fill it in:

| Field | What to put |
|---|---|
| **Application name** | `ADCode` — this is what people see on the consent screen, so use the real name |
| **Homepage URL** | `https://adcode.bluethenics.com` |
| **Authorization callback URL** | the URL you copied from Firebase in step 3 |

7. Click **Register application**.
8. On the page that appears, copy the **Client ID**.
9. Click **Generate a new client secret**, then copy the secret. **It is shown once.** If you
   navigate away without copying it, generate another one — you cannot read the first again.

**Then finish in Firebase.**

10. Back in the Firebase tab, paste the **Client ID** and **Client secret** into the GitHub
    row, make sure the **Enable** toggle is on, and click **Save**.

**To check it worked:** open `https://adcode.bluethenics.com/dashboard` in a private window
and click **Continue with GitHub**. A GitHub window should open asking to authorise ADCode.
After you approve it you land on the dashboard, signed in.

If instead you see *"You already have an account with that email, created with a different
sign-in method"*, that is not a fault — it means that email already signed up with Google or
a password, and Firebase refuses to merge the two silently. Use the method you signed up
with.

No scopes are requested, so the consent screen only asks for your public profile and email.
Nothing ADCode does needs access to anybody's repositories.

- [ ] The GitHub button signs you in on the live site

### 8 · Copy the Firebase web values and write the env file

1. Click the **gear icon → Project settings**, and stay on the **General** tab.
2. Scroll to **Your apps**. If there is no web app, click the **`</>`** icon to create one —
   name it `adcode-web` and do **not** tick Firebase Hosting.
3. You are shown a `firebaseConfig` block. You need two values from it: `apiKey` and `appId`.
   Also note `projectId` — it should be `adcode-idle`.

Now create the file the website is built with:

```powershell
copy apps\web\.env.example apps\web\.env.production
```

Open `apps/web/.env.production` and fill in the two blanks:

```
NEXT_PUBLIC_FIREBASE_API_KEY=<the apiKey you just copied>
NEXT_PUBLIC_FIREBASE_APP_ID=<the appId you just copied>
```

If your project is **not** called `adcode-idle`, also change
`NEXT_PUBLIC_FIREBASE_PROJECT_ID` and `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` to match.

Everything in that file is public by design — a Firebase web key identifies a project, it
does not authorise anything. The file is gitignored anyway.

- [ ] `apps/web/.env.production` exists with both blanks filled

### 9 · Set the editor's key

The desktop app needs the same `apiKey` at build time:

```powershell
$env:ADCODE_FIREBASE_API_KEY = "<the apiKey>"
npm start
```

You should now see a **person icon** in the title bar and a row on the welcome screen reading
*"Sign in to keep your earnings — recommended"*. Sign-in will not complete until the site is
deployed, which is next.

- [ ] Ran with the key and saw the account button

### 9b · Google and GitHub sign-in *in the editor* (optional)

**Anonymous sign-in needs nothing more than the key above, and anonymous is the one that
earns.** Skip this until people ask for it.

The editor cannot use the website's sign-in. A popup in a browser and a desktop application
are different OAuth cases, so the editor runs its own flows, and they need their own client
ids. Without them those two buttons say *"Google sign-in isn't configured in this build"* —
which is the truth, not a fault.

**Google.** https://console.cloud.google.com → the `adcode-idle` project → **APIs & Services
→ Credentials → Create credentials → OAuth client ID** → application type **Desktop app**.
You get a client id and a client secret.

**GitHub.** https://github.com/settings/developers → **New OAuth App**. Any homepage URL.
Then open the app and **enable Device Flow** — the editor uses the device flow, because a
desktop app cannot keep a redirect URL to itself.

```powershell
$env:ADCODE_FIREBASE_API_KEY  = "<the apiKey>"
$env:ADCODE_GOOGLE_CLIENT_ID  = "<the desktop client id>"
$env:ADCODE_GOOGLE_CLIENT_SECRET = "<the desktop client secret>"
$env:ADCODE_GITHUB_CLIENT_ID  = "<the GitHub client id>"
npm start
```

These are read when the app is **built**, so a packaged installer carries whatever was set
when you ran `npm run package`.

- [ ] Skipped, or both buttons work in the editor

---

## Phase 4 — Cloudflare (hosting)

One Worker serves the website and the API. Free plan, no card.

> **Everything in this phase runs from the `apps/web` folder**, because that is where the
> Cloudflare tooling is installed. Do this once and stay there until step 13 says otherwise:
>
> ```
> cd apps/web
> ```

### 10 · Create the account and log in

1. Go to **https://dash.cloudflare.com/sign-up** and create an account. Verify the email it
   sends you.
2. Back in this repo, run:

```
npx wrangler login
```

(You are in `apps/web`. If you get "command not found", you are in the wrong folder.)

Your browser opens and asks you to authorise Wrangler. Click **Allow**. The terminal should
print `Successfully logged in.`

> If the browser does not open, the terminal prints a URL — paste it into a browser yourself.

- [ ] `Successfully logged in.`

### 11 · Set the secrets

These are the values the running Worker needs and that must never be in a file. Run each
command, and paste the value when it asks. Nothing is echoed to the screen.

```
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put FIREBASE_PROJECT_ID
```

| Secret | Paste |
|---|---|
| `SUPABASE_URL` | the Project URL from step 6, e.g. `https://abcdefghijkl.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the long `service_role` / secret key from step 6 |
| `FIREBASE_PROJECT_ID` | `adcode-idle` |

The first command may say the Worker does not exist yet and offer to create it — say **yes**.

You can list what is set (names only, never values) with:

```
npx wrangler secret list
```

- [ ] All three secrets set

### 12 · Deploy

```
npm run deploy
```

This builds the site, bundles the API into it, and uploads the Worker. The first run takes a
few minutes.

(From the repo root instead, the same thing is `npm run web:deploy`.)

At the end it prints a URL like `https://adcode.<your-subdomain>.workers.dev`. Open it. You
should see the ADCode home page.

Then check the API is answering on the same host — open this in a browser:

```
https://adcode.<your-subdomain>.workers.dev/v1/health
```

You should see exactly:

```json
{"ok":true}
```

**This one line proves the whole chain works**: the Worker is running, it can reach Supabase,
and the `serving_config` row is there. If you get `{"ok":false}` the Worker is up but the
database is not reachable — re-check the two Supabase secrets in step 11. If you get an
error page instead, run `npx wrangler tail` in a terminal and reload the page to see the
real error.

- [ ] Home page loads, `/v1/health` returns `{"ok":true}`

### 13 · Put it on your domain

**Read this before starting.** Attaching a Worker to your own hostname requires
`bluethenics.com` to use Cloudflare's nameservers. That means changing the nameservers at
your registrar — it moves DNS for the **whole domain**, not just the `adcode` subdomain.
Cloudflare's free plan covers it and it is the normal way to do this, but it is a bigger step
than adding one record, so do it deliberately.

Cloudflare copies your existing DNS records automatically when you add the domain, but
**check them before switching** — anything it misses stops working, including email.

If you would rather not move the domain yet, skip this step. Everything works on the
`.workers.dev` URL; come back when you are ready.

1. In the Cloudflare dashboard, click **Add a domain**, enter `bluethenics.com`, choose the
   **Free** plan, and click **Continue**.
2. Cloudflare scans your current DNS and shows what it found. **Compare it against your
   registrar's DNS page** and add anything missing — especially `MX` records, or email to
   that domain will stop arriving.
3. Cloudflare gives you two nameservers, like `xyz.ns.cloudflare.com`. Go to whoever you
   bought `bluethenics.com` from, find the nameserver setting, and replace what is there with
   Cloudflare's two.
4. Wait. This usually takes under an hour but can take a day. Cloudflare emails you when the
   domain is active.
5. Once it is active: **Workers & Pages → adcode → Settings → Domains & Routes → Add →
   Custom domain**. Enter `adcode.bluethenics.com` and click **Add domain**.

Cloudflare creates the DNS record and issues the certificate itself. After a minute or two,
open `https://adcode.bluethenics.com/v1/health` — you should see `{"ok":true}` again.

6. Finally, turn on the keepalive. In your GitHub repo: **Actions** tab → if prompted, enable
   workflows → find **keepalive** → **Run workflow** to test it once. It should go green.

> **Why the keepalive matters.** A Supabase project on the free plan pauses after seven days
> with no database activity, and a paused database means every ad request fails until someone
> clicks Resume in a dashboard. `.github/workflows/keepalive.yml` pings `/v1/health` once a
> day, which is enough to stop that ever happening. A red run in that workflow is also your
> earliest warning that the database has gone away.

- [ ] `https://adcode.bluethenics.com/v1/health` returns `{"ok":true}`, keepalive ran green

### 14 · Sign in as the administrator

**Nothing to configure — this is already done.** `bluethenics01@gmail.com` was written into
the `admins` table when the database was created, so it is an administrator from the first
sign-in.

1. Open the site and sign in with **`bluethenics01@gmail.com`**, using **Google**.
2. Open `/admin`. It should load, with an **Admins** tab.

Appoint everybody else from that tab — an email address, and they are an administrator the
first time they sign in. Nobody needs a console or a command again.

> **Why Google, and not Email/Password.** An administrator is an email address in a table,
> and the API only honours it when the token says the *provider verified* that address.
> Google does. A self-registered Email/Password account with the same address does not, and
> is deliberately refused — otherwise anyone who knows an administrator's address could sign
> up as them and take the site. If `/admin` says you are not an admin, that check is why:
> sign in with Google.

An older version of this file had you set a Firebase custom claim from the Google Cloud
Shell. That is obsolete. Admin is a database row now, because a claim can only be *written*
with a service-account key, and putting a second key with authority over every account into
the Worker to save one database read is a bad trade. If you already set that claim, it is
simply ignored; there is nothing to undo.

- [ ] `/admin` loads for your account

---

## Phase 5 — Money in (optional until you have advertisers)

### 15 · Dodo Payments

1. Create a Dodo account and a product for advertiser funding; note the product ID.
2. Add a webhook endpoint pointing at **`https://adcode.bluethenics.com/v1/webhooks/dodo`**.
3. Copy the signing secret.
4. Set the secrets:

```
cd apps/web
npx wrangler secret put DODO_API_KEY
npx wrangler secret put DODO_PRODUCT_ID
npx wrangler secret put DODO_WEBHOOK_SECRET
```

Leave `DODO_MODE` unset while testing — the code defaults to test mode, so a missing variable
cannot take real money. Set it to `live` only when you mean it.

5. **Test in test mode first.** `services/api/adapters/dodoPayments.ts` was written from the
   published API reference and **has never run against a real account** — treat its request
   shape as a first draft. The webhook half (signature verification, idempotent crediting) has
   28 tests and is the half that would cost you money if it were wrong.

- [ ] Test-mode payment completed end to end, balance appeared in the portal

---

## Phase 6 — Distribution

### 16 · Ship a release

Unchanged by any of the above:

```
npm run package
```

Then create a GitHub release and attach the installers from `release/`. `npm run
release-note` drafts the note.

**Code signing is the one thing here that costs money** — a Windows certificate is a few
hundred dollars a year. Without it, Windows shows a SmartScreen warning on first run. It is
optional and it is fine to ship unsigned while you have no users.

- [ ] A release exists and the installer runs on a clean machine

---

## Phase 7 — Before real users and real money

### 17 · Run the Supabase adapter tests once

`services/api/adapters/supabaseStore.ts` is covered above the port by 2103 tests, and its
row translation is tested directly — but the queries themselves have only ever run against
the schema, not against your project.

The cheapest real check is the one you already did: `/v1/health` returning `{"ok":true}` means
`getConfig()` executed against Postgres and came back with a valid row.

For the rest, use the app: sign in on the site, create an advertiser in `/portal`, and watch
the row appear in the Supabase table editor. If it does, the write path works.

- [ ] Created an advertiser through the site and saw the row in Supabase

### 18 · Have a lawyer read the terms

`apps/web/src/app/terms/page.tsx`. Non-negotiable before you take advertiser money or owe
users a payout.

- [ ] Reviewed

### 19 · Decide about payouts

**Users can earn but cannot withdraw.** The ledger has `withdrawal_requested`,
`withdrawal_paid` and `withdrawal_failed` with `provider_ref` and `currency` columns, and the
balance fold is unit-tested against all three — but **no endpoint raises them**. Cash-out is
additive when you build it, not a migration over live money, which is why those entry kinds
exist now.

Building it needs payout-provider access, KYC and tax handling.

- [ ] Decided when payouts happen, and told users honestly in the meantime

---

## Reference — every environment variable

**The Cloudflare Worker** — set with `npx wrangler secret put <NAME>`, run from `apps/web`

| Secret | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | **yes** | Which Supabase project to talk to |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | The only credential that can read or write the database |
| `FIREBASE_PROJECT_ID` | **yes** | Which project's ID tokens to accept. A token from any other project is refused. |
| `DODO_API_KEY` | for billing | Checkout links |
| `DODO_PRODUCT_ID` | for billing | Product funding bills against |
| `DODO_WEBHOOK_SECRET` | for billing | Webhook signature verification |
| `DODO_MODE` | no | `live` for real money. Anything else, including unset, is test mode. |
| `ADCODE_CORS_ORIGINS` | no | Extra allowed origins, comma-separated |
| `ADCODE_AGENT_TOKEN` | no | Lets a tool draft release notes through the API |

**The website at build time** — `apps/web/.env.production`, copied from `.env.example`. All
public.

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SITE_ORIGIN` | yes | Canonical URLs, sitemap, installer command |
| `NEXT_PUBLIC_API_ORIGIN` | no | Defaults to the site origin, which is correct |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | yes | Sign-in |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | yes | Sign-in |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | yes | Sign-in |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | yes | Sign-in |
| `NEXT_PUBLIC_GITHUB_REPO` | yes | Where installers and updates come from |

**The desktop app** — baked in at build time.

| Variable | Required | Purpose |
|---|---|---|
| `ADCODE_FIREBASE_API_KEY` | yes | Anonymous sign-in and email/password linking |
| `ADCODE_GOOGLE_CLIENT_ID` | no | Google sign-in in the editor. Without it that button says so. |
| `ADCODE_GOOGLE_CLIENT_SECRET` | no | With the above |
| `ADCODE_GITHUB_CLIENT_ID` | no | GitHub sign-in in the editor. Without it that button says so. |
| `ADCODE_AD_SERVER` | no | Defaults to `https://adcode.bluethenics.com` |

---

## When something is wrong

| What you see | What it means |
|---|---|
| `/v1/health` → `{"ok":false}` | The Worker runs; Supabase is unreachable. Re-check `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (step 11). |
| `/v1/health` → an error page | The Worker itself is failing. Run `npx wrangler tail` from `apps/web` and reload. |
| Everything returns `401` | `FIREBASE_PROJECT_ID` is wrong or unset, so no token verifies. |
| Google sign-in: "unauthorised domain" | Step 7's Authorized domains entry is missing. |
| The editor earns nothing | Anonymous sign-in is not enabled in Firebase (step 7). |
| The site is stale after a deploy | A hard reload. Cloudflare serves the assets it was given; the Worker itself updates immediately. |
| `serving_config row 1 is missing` | Step 5's SQL did not finish. Run it again — it is safe to re-run. |
| Deploy: `module-not-found` on `@adcode/api/...` | A `package-lock.json` has appeared in `apps/web`. Delete it. See the warning at the top. |
| Deploy: `ENOENT ... pages-manifest.json` | Same cause, same fix. Next wrote the standalone output to a path OpenNext was not looking at. |
| Build: every page times out after 60s | `NEXT_PUBLIC_API_ORIGIN` is set to an empty value somewhere. Leave the key out entirely rather than setting it blank. |
| `Secret edit failed ... isn't currently deployed` | The Worker exists but has no version yet. Deploy once, then set secrets. |
| You changed a `NEXT_PUBLIC_` value, redeployed, and the old one is still in the page | Turbopack caches compiled chunks and does not key that cache on env values, so the old literal is re-emitted. Delete `apps/web/.next` and `apps/web/.open-next`, then build again. |
| Sign-in: "Couldn't sign in. Try again." | Almost always the host is missing from Firebase → Authentication → Settings → **Authorized domains**. Add the `workers.dev` hostname as well as the custom domain. |
| The dashboard says "Couldn't reach the server" | Open the Network tab and read the URL it called. If it names a host that is not the one you are on, the bundle was built with a different `NEXT_PUBLIC_SITE_ORIGIN` - see the cache row above. |
