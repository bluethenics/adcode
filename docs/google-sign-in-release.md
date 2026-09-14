# Google sign-in in desktop releases

`Google sign-in isn't configured in this build.` means the installed desktop build
is missing its Google client ID or client secret. Deploying the website does not
change an already installed desktop build.

The checked-in client ID is in `apps/desktop/src/main/oauth.ts`. Use the matching
Google **Desktop app** client credential, never a Web application client secret.
The desktop token exchange uses PKCE together with that credential.

For a local build, set `ADCODE_GOOGLE_CLIENT_SECRET` in the build environment or
the gitignored `apps/desktop/.env`. For GitHub releases, configure the repository
Actions secret with the same name. `.github/workflows/release.yml` passes that
secret to packaging and stops a release build when it is absent.

The credential is embedded in the installed app and is extractable. Do not commit
it, print it in build logs, or use it to protect server resources.

Build and publish a new version, then install it on a machine without development
environment variables. Finish Google sign-in in the system browser and confirm
the account appears inside ADCode. Also confirm the Google provider is enabled in
the corresponding Firebase project and the OAuth consent configuration allows
the intended users.

Reference: [Google's installed-app OAuth flow](https://developers.google.com/identity/protocols/oauth2/native-app).
