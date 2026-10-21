# GitHub sign-in on the web

Use this guide when **Continue with GitHub** opens a GitHub page saying that the
`redirect_uri` is not associated with the application, as reported in
[issue #5](https://github.com/bluethenics/adcode/issues/5). GitHub is rejecting the
callback requested for that OAuth client before sign-in can finish. A maintainer
with access to the Firebase project and the matching GitHub OAuth app must check
their configuration; a repository change alone cannot update those settings.

## Identify the callback and OAuth app

The website (`apps/web/src/lib/firebase.ts`) and browser editor
(`apps/desktop/src/web/firebaseAuth.ts`) both use Firebase's `signInWithPopup`
with `GithubAuthProvider`. Firebase supplies the callback; the site's homepage
and the editor's origin are not the OAuth callback.

1. Start GitHub sign-in from the affected deployment. In the popup's address bar
   or its browser Network panel, inspect the request to
   `https://github.com/login/oauth/authorize`. Record only `client_id` and the
   decoded `redirect_uri`. Do not share the full request URL, `state`, authorization
   codes, tokens, cookies, or a raw network export.
2. In that deployment's Firebase project, open **Authentication → Sign-in method
   → GitHub**. Match its client ID to the request, then find that same app in
   GitHub's **Settings → Developer settings → OAuth Apps**, under the account or
   organization that owns it. Do not identify the app by its display name alone.
3. Compare the requested callback with the built client's `authDomain` and
   Firebase's OAuth redirect URI. The expected form is
   `https://<authDomain>/__/auth/handler`. The checked-in example uses
   `adcode-idle.firebaseapp.com`, giving:

       https://adcode-idle.firebaseapp.com/__/auth/handler

   This is an example from repository configuration, not a verified production
   callback. Confirm the actual request before changing any settings.

The website reads `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` at build time. The browser
editor's `apps/desktop/vite.web.config.ts` uses `ADCODE_FIREBASE_AUTH_DOMAIN` when
set; otherwise it reads the public Firebase settings from `apps/web/.env.production`
and then `.env.local`, keeping the first nonempty value. Check the configuration
used to build the affected deployment rather than assuming a local file matches it.

## Correct the provider configuration

1. Privately record the existing GitHub callback URL and Firebase provider/client
   ID mapping so they can be restored. If credentials need correction, retain
   the previous credentials in the existing secure storage, never in this repository.
2. In the matching GitHub OAuth app, set **Authorization callback URL** to the
   verified Firebase handler URL, including HTTPS and `/__/auth/handler`, and save.
3. Confirm Firebase's GitHub provider is enabled and its client ID and client
   secret belong to that same OAuth app. Correct them in the Firebase provider
   settings if necessary. Never put a client secret in a `NEXT_PUBLIC_*` variable,
   browser code, an issue, or build logs.
4. Separately check **Firebase Authentication → Settings → Authorized domains**
   for the host where sign-in starts, such as `web.bluethenics.com` or
   `adcode.bluethenics.com`. That list permits the website to initiate Firebase
   sign-in; it does not register a GitHub callback URL.

Changing only the OAuth app or Firebase provider settings does not require a
client rebuild. Changing a compiled Firebase setting does: rebuild and redeploy
the affected client through the normal release process. Do not change `authDomain`
to the website's host just to match its address. A custom authentication domain
also needs Firebase's authentication helpers to be served there and the provider
callback configured accordingly; see
[Firebase's custom-domain guidance](https://firebase.google.com/docs/auth/web/github-auth#customizing-the-redirect-domain-for-github-sign-in).

The desktop account flow and **Connect GitHub** use device authorization in
`apps/desktop/src/main/oauth.ts` and `apps/desktop/src/host/githubConnect.ts`.
Leave those flows and their client IDs unchanged when correcting web sign-in.

## Verify and roll back

Use an existing test account on an approved deployment that exposes sign-in:

1. Start signed out and select **Continue with GitHub**. Confirm GitHub shows its
   expected sign-in or consent interface without the callback warning. An already
   authorized account may complete without another consent screen.
2. Finish sign-in and confirm the popup closes and ADCode shows the expected
   signed-in account. Check both the website and browser editor if they share the
   corrected provider, then sign out and repeat to verify returning-user sign-in.
3. Confirm **Continue with Google** still completes on the same affected surfaces.
4. Record the deployment, date, tested surfaces, and outcomes without credentials
   or transient OAuth parameters. If regressions appear, restore the recorded
   callback and any provider settings changed. If a client build changed, restore
   its prior deployment too, then repeat the sign-in checks.

**Acceptance pending:** the production browser editor was paused when investigated
on 2026-10-21. Complete its sign-in checks only when an approved test deployment
exposes authentication. The exact production OAuth app configuration and successful
end-to-end sign-in have not been verified by this contribution. Unit tests and
Firebase authorized-domain checks do not establish that GitHub OAuth works.

Reference: [Firebase's GitHub authentication setup](https://firebase.google.com/docs/auth/web/github-auth).
