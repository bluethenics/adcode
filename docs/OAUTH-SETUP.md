# Creating the Google and GitHub OAuth clients

Ten minutes, both together. Neither can be scripted — Google has no API for creating
OAuth 2.0 client IDs, GitHub has none for creating OAuth Apps, and both require accepting
terms under your own account. Both consoles are the only path.

When you're done you'll have two strings. Paste them into the marked block at the top of
`apps/desktop/src/main/oauth.ts` and rebuild.

**Both IDs are safe to commit.** An OAuth client ID for an installed app is a public
identifier, not a credential — Google's own guidance is that installed apps "cannot keep
secrets", which is exactly why PKCE and the device flow exist. A client *secret* must
never be committed, and neither flow needs one.

---

## Google

### 1. Consent screen (once per project)

**console.cloud.google.com** → make sure `adcode-idle` is the selected project →
**APIs & Services → OAuth consent screen**

| Field | Value |
|---|---|
| User type | **External** |
| App name | ADCode |
| User support email | yours |
| Developer contact | yours |

On the **Scopes** step add exactly three: `openid`, `.../auth/userinfo.email`,
`.../auth/userinfo.profile`. That is all the editor asks for, and asking for more is what
makes people abandon a consent screen.

Leave publishing status as **Testing** while you're the only user, and add your own
address under **Test users**. In Testing mode only listed test users can sign in — if
sign-in works for you and fails for everyone else, this is why. Publish when you're ready
for real users.

### 2. The client ID

**APIs & Services → Credentials → Create Credentials → OAuth client ID**

| Field | Value |
|---|---|
| Application type | **Desktop app** |
| Name | ADCode Desktop |

**Application type must be Desktop app.** It is the only type where Google permits a
loopback redirect (`http://127.0.0.1:<random port>`), which is what the editor uses. A
"Web application" client will reject the redirect and the sign-in will fail at the last
step with a `redirect_uri_mismatch` you cannot fix without starting over.

There is nothing to enter for redirect URIs — Desktop clients allow loopback on any port
implicitly, which is why the editor can bind to a free one each time.

Copy the **Client ID**. It looks like `1234567890-abc123def456.apps.googleusercontent.com`.

Google will also show a client secret. You do not need it. If you later hit a
`client_secret is missing` error, set `ADCODE_GOOGLE_CLIENT_SECRET` and it will be
included — the token exchange treats it as optional when PKCE is used.

### 3. Enable it in Firebase

**Firebase console → Authentication → Sign-in method → Google → Enable.**

Without this, Firebase refuses the credential even though Google issued it happily, and
the error surfaces as a generic link failure.

---

## GitHub

**github.com/settings/developers → OAuth Apps → New OAuth App**

| Field | Value |
|---|---|
| Application name | ADCode |
| Homepage URL | `https://adcode.bluethenics.com` |
| Authorization callback URL | `https://adcode.bluethenics.com` |

The callback URL is required by the form but unused: the editor uses the **device flow**,
where the browser goes to github.com and the app polls. Any valid URL you control
satisfies the field.

After creating the app, **enable the device flow** — there is a checkbox on the app's
settings page labelled *Enable Device Flow*. It is off by default, and with it off the
first call returns `device_flow_disabled` and sign-in never starts.

Copy the **Client ID**. It looks like `Ov23liAbCdEfGhIjKlMn`.

Do **not** generate a client secret. The device flow does not use one.

### Enable it in Firebase

**Firebase console → Authentication → Sign-in method → GitHub → Enable.**

This one *does* want a client ID and secret, because Firebase's own hosted GitHub flow
uses them. Generate a secret here and paste it into Firebase only — it lives in Firebase's
config, never in this repo. Firebase will show you a callback URL like
`https://adcode-idle.firebaseapp.com/__/auth/handler`; add it as a second callback URL on
the GitHub app.

---

## Paste them in

`apps/desktop/src/main/oauth.ts`, the marked block near the top:

```ts
const GOOGLE_CLIENT_ID = process.env["ADCODE_GOOGLE_CLIENT_ID"] ?? "1234567890-abc.apps.googleusercontent.com";
const GITHUB_CLIENT_ID = process.env["ADCODE_GITHUB_CLIENT_ID"] ?? "Ov23liAbCdEfGhIjKlMn";
```

Then `npm run desktop:build`, or `npm run package` for an installer.

## Checking it worked

The sign-in buttons **hide themselves** when no client ID is set, so the first sign that
it worked is that they appear at all: a bust icon in the title bar after the feedback
icon, and a row on the welcome screen.

They also need `ADCODE_FIREBASE_API_KEY` set, because linking is a Firebase operation.
With a client ID but no Firebase key the buttons stay hidden — if they don't appear after
pasting the IDs, check that first.

A successful Google sign-in opens your browser, returns to a page saying you can close the
tab, and the title bar icon becomes your profile photo. GitHub instead shows a short code
to type at `github.com/login/device`.

## If it fails

| What you see | Cause |
|---|---|
| Buttons never appear | No client ID, or no `ADCODE_FIREBASE_API_KEY` |
| `redirect_uri_mismatch` | The Google client is type "Web application", not "Desktop app" |
| Google sign-in refused for other people | Consent screen still in Testing with no test users added |
| `device_flow_disabled` | Device Flow checkbox is off on the GitHub app |
| "already in use, so linking it would strand this machine's earnings" | That Google or GitHub account is already attached to a different ADCode account. This is a refusal on purpose — linking would orphan this machine's balance. |
