# Ads delivery debugging runbook

A campaign shows **Live** in the portal — funded, approved creative, kill switch off —
yet editors get zero impressions and "N views" stays 0. Ad-side failures are silent by
design (§9), so nothing errors visibly. This file is the diagnostic ladder, in order.
It was written after a real incident (2026-09-26) that turned out to be **three**
stacked blockers, each invisible until the previous one was fixed.

## The ladder

### 1. Read the client's verdict (2 min)

Run the desktop with ad debug logging (each line separate, PowerShell):

```
$env:ADCODE_AD_DEBUG = "1"
$env:ADCODE_SETTLE_MS = "1500"
$env:ADCODE_AD_TICK_MS = "2000"
npm start
```

Focus the window ~2 minutes, then read the `[ads]` lines:

| Line | Meaning |
|---|---|
| `starting {"baseUrl":"...","assetHost":"..."}` | The hosts the client validates against. `assetHost` must equal the hostname creative logos are stored on. |
| `started {"config":true,"balance":true}` | Auth + reachability OK. `false`/`false` means the campaign is innocent — fix auth/network first. |
| `tick {"reason":null}` | Showing. If followed by `delivering toast`, delivery works. |
| `tick {"reason":"no-creative"}` | Inventory empty: every `serve` returns nothing usable (or nothing at all). Go to step 2. |
| `tick {"reason":"min-interval"}` right after a delivery | Correct pacing, not a bug. |
| `tick {"reason":"window-unfocused"}` | The window lost focus; refocus and re-read. |
| `asset fetch rejected` | Logo bytes unreachable (but the toast still shows). |

### 2. Watch the server while a tick fires (5 min)

```
cd apps/web
npx wrangler tail
```

Press earnings-refresh in the editor. Find the `POST .../v1/serve` lines:

| Tail status | Meaning |
|---|---|
| `Ok` | Serve answers. If the client still says `no-creative`, the body is empty or fails client validation — go to step 3. |
| `Canceled` (every serve, GETs fine) | **Latency**: the client gives up after 3,000ms (`FETCH_TIMEOUT_MS`). Serve makes ~8 sequential Supabase round trips; it must fit in ~6 parallel waves or fewer. See "Known root cause B". |
| `500` | The handler throws. Read the tail error detail. |
| `401` on serve only | Auth quirk on that endpoint (rare; config/balance share the same token). |

### 3. Time and inspect one serve directly (5 min)

Admin console on the site (`https://adcode.bluethenics.com`, brand domain — see
"Known root cause C"), one paste (token + call share a scope; a bare second paste
loses `t` with `ReferenceError: t is not defined`):

```js
const t = await new Promise((resolve) => {
  const open = indexedDB.open("firebaseLocalStorageDb");
  open.onsuccess = () => {
    const all = open.result
      .transaction("firebaseLocalStorage", "readonly")
      .objectStore("firebaseLocalStorage")
      .getAll();
    all.onsuccess = () =>
      resolve(
        (all.result || []).find((r) => String(r.fbase_key).startsWith("firebase:authUser:"))
          ?.value?.stsTokenManager?.accessToken ?? null,
      );
    all.onerror = () => resolve(null);
  };
  open.onerror = () => resolve(null);
});
const t0 = performance.now();
const r = await fetch("/v1/serve", {
  method: "POST",
  headers: { authorization: "Bearer " + t, "content-type": "application/json" },
  body: JSON.stringify({ tags: [], themeKind: "dark", count: 5 }),
});
const body = await r.json();
console.log("status:", r.status, "ms:", Math.round(performance.now() - t0));
console.log(JSON.stringify(body).slice(0, 500));
```

Read it as:

- **`ms` > ~3000** → latency blocker. The editor will always cancel. Fix server-side
  (parallelize the serve read chain; reserve folding spend into the candidates
  query as a migration-backed fallback).
- **Fast 200, `"creatives":[]`** → the auction excludes the campaign. Check, in order:
  `campaigns.status = 'active'`; `campaigns.cpm_micros >= serving_config.floor_cpm_micros`;
  `serving_config.kill_switch = false`; `target_tags` empty or overlapping the
  editor's tags; budget remaining covers one block; an `approved` creative whose
  `campaign_id` matches the campaign.
- **Fast 200 with creatives** → the server is fine; the block is client-side
  validation. Compare each logo's hostname against the `assetHost` from step 1.
  Exact-hostname equality — never `endsWith`/`includes`.

### 4. Repair wrong-host rows (5 min)

`POST /v1/admin/rehost-assets` canonicalizes logos to **the origin the request
reached** — so it must be run from the canonical host, or it repairs nothing
(`rehosted: 0`) or repairs toward the wrong host. Open
`https://adcode.bluethenics.com/admin/...` explicitly (not the `workers.dev` URL),
then one paste:

```js
const t2 = await new Promise((resolve) => {
  const open = indexedDB.open("firebaseLocalStorageDb");
  open.onsuccess = () => {
    const all = open.result
      .transaction("firebaseLocalStorage", "readonly")
      .objectStore("firebaseLocalStorage")
      .getAll();
    all.onsuccess = () =>
      resolve(
        (all.result || []).find((r) => String(r.fbase_key).startsWith("firebase:authUser:"))
          ?.value?.stsTokenManager?.accessToken ?? null,
      );
    all.onerror = () => resolve(null);
  };
  open.onerror = () => resolve(null);
});
await (
  await fetch("/v1/admin/rehost-assets", {
    method: "POST",
    headers: { authorization: "Bearer " + t2 },
  })
).json();
```

Expect `{scanned: N, rehosted: M≥1}`; a repeat run must say `rehosted: 0`
(idempotent). Verify with step 3: logos should read
`https://adcode.bluethenics.com/assets/...`. 401 means the token expired —
reload and re-paste.

### 5. Force one card past everything (5 min)

`/admin/tools` → **Send a test ad**. The target account is the id the **editor**
is signed in as (status-bar earnings button) — usually anonymous, so the account
*search* finds nothing; **paste the id**, search is optional. Or bypass the UI:

```js
// same token fetch as above, bound to t3, then:
await (
  await fetch("/v1/admin/test-serve", {
    method: "POST",
    headers: { authorization: "Bearer " + t3, "content-type": "application/json" },
    body: JSON.stringify({ uid: "<editor-uid>", creativeId: "<creative-id>" }),
  })
).json();
```

Expect `{"ok":true}`. Focus the editor, refresh earnings, watch for the toast.
Test cards skip targeting, budget, pacing, and the live check — but NOT the
serve timeout or client validation. So:

| Test arrives | Real ads don't | Verdict |
|---|---|---|
| yes | yes | Fixed. Confirm portal views move. |
| yes | no | Delivery healthy; the block is auction-side (step 3, fast-but-empty branch). |
| no | no | Break is in serve latency or client validation (steps 2–4). |

A test view is recorded but bills nobody and credits nobody — it proves delivery,
never revenue.

## "Fixed" looks like this

```
[ads] starting {"baseUrl":"https://adcode.bluethenics.com/v1","assetHost":"adcode.bluethenics.com"}
[ads] started {"config":true,"balance":true}
[ads] tick {"reason":null,...}
[ads] delivering toast {"creativeId":"...","hasLogo":true}
[ads] tick {"reason":"min-interval",...}
```

Plus: timed serve < 3000ms with canonical-host logos, rehost repeat at 0,
portal views off 0.

## Open follow-ups (as of 2026-09-26, not urgent)

- [ ] **`npm run package`.** Installers in `release/` predate the canonical-origin
  switch: `DEFAULT_API_ORIGIN` is baked in at build time, so anyone installing from
  the current artifacts still validates against `workers.dev` (which still serves,
  so nothing breaks — but their editor rejects site-host logos the same way the
  old client did). Repackage after `npm run desktop:build` and attach the new
  installers plus `latest.yml` to the release (SETUP R6 procedure).
- [ ] **Watch real (non-test) views accrue.** Test delivery is proven end to end;
  organic ticks were delivering at last check, but nobody has yet confirmed the
  portal's "N views" climbing on its own. Check the "Adcode · Sep 2026" campaign
  in `/portal` after a day of normal use.

## Known root causes (2026-09-26 incident)

Three stacked blockers, each hidden behind the previous:

- **A. Asset-host mismatch (client config).** Portal stores logos same-origin
  (`requestOrigin` → `adcode.bluethenics.com`); the desktop validated against
  `adcode.bluethenics01.workers.dev` (`DEFAULT_API_ORIGIN` in
  `apps/desktop/src/main/backend.ts`). Fix: point the default at the canonical
  origin (SETUP step 13b). Requires `npm run desktop:build && npm run package`
  — the origin is baked in at build time; old installers keep the old host.
- **B. Serve latency (~5s > 3s timeout).** Every serve `Canceled` in the tail
  while GETs were `Ok`. Fix: parallelize the serve read chain (`server.ts`
  auth+config, `serve.ts` queue-drain+candidates and spend+artwork,
  `auth.ts` user-ensure+admin-check) — measured 4999ms → 2269ms. No behavior
  change; `recordServe` is still awaited before responding (§9 money safety).
- **C. Wrong-host rows.** Two creatives stored logos on `workers.dev`
  (submitted via that host). Fix: rehost from the site host — the tool
  rewrites `/assets/<key>` URLs onto the request origin; bytes live in the
  shared store behind both hosts.

Blast-radius hardening shipped with the same incident (still strict, only the
radius changed): `parseServeResponse` skips invalid creatives and returns the
valid ones instead of failing the whole batch (all-bad still returns the first
error); host check stays exact-equality; unknown-field and `data:` rejection
kept. Regression tests: `packages/ads/test/validation.test.ts` ("one bad
creative does not kill the batch"), `services/api/test/assets.test.ts`
(wrong-host rewrite + external-URL restraint).
