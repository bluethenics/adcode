# Releasing ADCode

Everything from a tag to a download button that works.

## What already exists

The download path on the website is complete and needs no work:

- `apps/web/src/lib/downloads.ts` lists five targets, all pointing at `/dl/*`.
- `apps/web/src/app/dl/[platform]/route.ts` streams the asset from the GitHub release
  through the Worker, so the file arrives from `adcode.bluethenics.com` rather than from
  `github.com` — it works behind networks that block GitHub, and the browser records the
  download against this site.
- `apps/web/public/install.ps1` and `install.sh` install from the same place.
- `/versions` lists releases and links the downloads.

What did not exist until now is anything that **produces** the five files those routes ask
for. Only Windows had ever been built, because a `.dmg` needs macOS tooling and an AppImage
needs a Linux filesystem, and this project is developed on Windows.

## The five names, and why they matter

| Route | Asset | Built by | Shipping? |
|---|---|---|---|
| `/dl/windows` | `ADCode-Setup-x64.exe` | `windows-latest` | yes |
| `/dl/linux` | `ADCode-x86_64.AppImage` | `ubuntu-latest` | yes |
| `/dl/linux-deb` | `ADCode-amd64.deb` | `ubuntu-latest` | yes |
| `/dl/macos` | `ADCode-arm64.dmg` | `macos-latest` | no - coming soon |
| `/dl/macos-intel` | `ADCode-x64.dmg` | `macos-latest` (`--x64`) | no - coming soon |

`available` in `apps/web/src/lib/downloads.ts` is the single switch. False means the card
reads "Coming soon" and is not a link, `/dl/<id>` answers 503 rather than 404 - the URL is
right and will work later - and the release check does not require the installer, so a
release is not blocked on a platform nobody is being offered. The macOS runner still builds
on every run, marked `optional`, because it is free and it is the only way to find out
whether a .dmg builds at all from a project developed on Windows.

`electron-builder.yml` produces these through `artifactName` templates whose `${arch}`
token resolves differently per target — `x64` for the `.exe`, `x86_64` for the AppImage,
`amd64` for the `.deb`. Nothing enforced that the two files agreed, and a mismatch is the
quiet kind of failure: the build succeeds, the release publishes, every download returns
404, and the first person to notice is a user.

`scripts/check-release-assets.mjs` reads the expected names out of `downloads.ts` — the
file the site itself reads — and fails the workflow if the built output cannot answer it.
It runs twice: once per platform after packaging, and once over every shipping platform
together before a release is drafted. Platforms marked `available: false` are skipped.

## Cutting a release

1. Update `CHANGELOG.md`.
2. Bump the version: `npm version <major|minor|patch>` at the repository root. This is the
   version `SoftwareApplication` schema and `/versions` will report.
3. Push the tag. `.github/workflows/release.yml` runs on any `v*` tag.
4. Three runners build in parallel, the asset-name check runs, and a **draft** release is
   created with all five installers plus the `latest*.yml` update manifests.
5. Open the draft on GitHub, check it, and press Publish.

To exercise the workflow without cutting anything, run it from the Actions tab with
**publish** left off: it builds all three platforms and keeps the installers as workflow
artifacts for 14 days without creating a release.

### Why the release is always a draft

`/dl/*` streams from `releases/latest/download/...`, and GitHub does not treat a draft as
latest. So nothing is downloadable until a person publishes it deliberately. Pushing a tag
cannot ship binaries to users by itself — which matters most while those binaries are
unsigned.

## Signing, and why the terminal install ships without it

The workflow signs when the secrets are present and builds unsigned when they are not,
saying which in the run summary. What unsigned costs differs sharply by platform, and the
difference is why ADCode ships Windows and Linux today and not macOS.

- **Linux.** No signing requirement at all. AppImage and `.deb` work exactly as built.
- **Windows.** A *browser* download of an unsigned installer earns the "Windows protected
  your PC" dialog, which hides the Run button behind *More info*, and most people stop
  there. But that dialog fires on the **Mark of the Web** — a zone tag Windows attaches to
  files a browser downloaded. `Invoke-WebRequest` does not set it, and `nsis.perMachine` is
  `false` so the install needs no elevation either. **The terminal install therefore
  produces no warning and no prompt**, which is why it leads on the homepage and the
  download page. A certificate (OV or EV, roughly $200–400/year) is still worth buying for
  the browser download path, but it is not what stands between you and shipping.
- **macOS.** Not a warning, a refusal. An un-notarised app is rejected by Gatekeeper rather
  than merely flagged, and no terminal trick makes an unsigned app acceptable on Apple
  silicon. **macOS genuinely needs the Apple Developer Program ($99/year)** and is marked
  coming soon until it has it.

### Secrets the workflow reads

| Secret | For | Without it |
|---|---|---|
| `CSC_LINK` | base64 of the `.p12`, Windows and macOS | Builds unsigned |
| `CSC_KEY_PASSWORD` | that certificate's password | — |
| `APPLE_ID` | notarisation | macOS ships un-notarised |
| `APPLE_APP_SPECIFIC_PASSWORD` | notarisation | — |
| `APPLE_TEAM_ID` | notarisation | — |

`CSC_IDENTITY_AUTO_DISCOVERY` is set to `false` automatically when no certificate is
configured; without that, macOS packaging fails searching an empty keychain rather than
producing an unsigned build.

## The auto-updater

`latest.yml`, `latest-mac.yml` and `latest-linux.yml` are collected and attached alongside
the installers. They are what `electron-updater` reads. A release published without them
installs correctly and then never updates again, which is not something you find out about
until the release after it.

`electron-builder.yml` publishes to `bluethenics/adcode`, and that must stay in step with
`install.ps1`, `install.sh` and the site origin. Installers built against the wrong
repository check an update feed nobody publishes to.

## Before the first public release

Open gates, from `docs/RELEASE-READINESS-2026-08-30-PM.md`:

1. **Signing.** macOS is a hard blocker and stays "coming soon" until the Apple membership
   exists. Windows and Linux ship without it, terminal install first.
2. **Refunds and disputes have never run against live Dodo.** Dodo is in live mode and the
   repaired branches have only been exercised by unit tests.
3. **Six moderate advisories** in the `firebase-admin` dependency chain.
4. **Terms unreviewed.** `docs/legal/LEGAL-REVIEW.md` says what to read first.
5. **The smoke suite is flaky** on pointer-driven checks and cannot currently be cited as a
   release gate.

None of these block *building* a release. All of them block publishing one.
