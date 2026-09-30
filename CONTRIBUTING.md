# Contributing to ADCode

Thanks for looking. ADCode is an ad-supported, AI-native IDE: an Electron desktop app in
`apps/desktop`, a Next.js site in `apps/web`, the ad server in `services/api`, and the logic in
`packages/*`, which are plain TypeScript with no Electron and no DOM so that the rules that
matter can be tested without launching an editor.

By contributing you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE), the same licence as the project. There is no CLA to sign.

## Set up

You need Node 24 or newer and npm 11 or newer.

    npm install
    npm --prefix apps/web install     # only if you are working on the website
    npm start                         # build and launch the editor
    npm run dev                       # the editor with hot reload

A source build talks to ADCode's production ad server by default. To work with no backend at
all, run the mock server and point the editor at it:

    npm run mock-server                          # serves the ad contract on :8787
    ADCODE_AD_SERVER=http://127.0.0.1:8787 npm start

In PowerShell, set the variable first: `$env:ADCODE_AD_SERVER = "http://127.0.0.1:8787"`, then
`npm start`.

## Before you open a pull request

    npm run verify

That runs the type checker, the dependency firewall and every test. CI runs the same command
on your pull request.

A green suite is not the acceptance test; the app is. If you changed anything a person can see:

    npm run desktop:build
    node scripts/smoke.mjs

Run them one after the other, not at the same time, and read the printed check values rather
than the exit code. Several UI bugs have passed a fully green run because the tests asserted
the model and not what the window showed.

## Every feature must be findable and documented

A feature nobody can find does not exist. When you add or change a feature, these are part of
the change, not follow-up work:

1. A help entry in `packages/help/src/entries/<group>.ts` with `plain`, `why` and `how`,
   written for somebody who has never seen the feature.
2. A row in the feature catalogue, `packages/help/src/features.ts`.
3. A place in the Feature library. It is generated from 1 and 2; check that it renders.
4. The other help surfaces - the settings popover, the in-app guide and universal search -
   read the same two files. Confirm the feature appears in each.
5. A guide in `apps/web/src/lib/docsGuides.ts` with real numbered steps.

Then run `node scripts/docs-seed.mjs`. A test fails if you forget.

Two rules the tests enforce:

- A command belongs to exactly one feature.
- Every command a feature names must be registered in `apps/desktop/src/renderer/main.ts`,
  and every registered command must be classified.

## Two traps specific to this repository

- **There are no npm workspaces.** Local packages resolve by alias, and three alias lists must
  stay in step: `tsconfig.json` `paths`, `vitest.config.ts`, and
  `apps/desktop/electron.vite.config.ts`. A subpath such as `@adcode/ai/terminalTeam` must sit
  above the bare `@adcode/ai` key, because the resolver takes the first key that matches.
- **The renderer must not import the `@adcode/ai` barrel.** It pulls every provider SDK into a
  browser bundle. Import the subpath instead.

## What makes a pull request easy to merge

- It does one thing, and the description says what and why.
- It comes with a test that fails without the change.
- It does not add a dependency without saying why nothing already here would do.
- User-facing text is plain. Read a few help entries for the tone.

Nobody is obliged to merge a pull request, and a large one that arrives unannounced is the
hardest kind to accept. For anything bigger than a fix, open an issue first.

## Reporting a security problem

Not in a public issue. See [SECURITY.md](SECURITY.md).

## Names and logos

The code is open; the ADCode name and logo are not. See [TRADEMARKS.md](TRADEMARKS.md).
