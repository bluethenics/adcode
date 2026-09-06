# Working on ADCode

ADCode is an ad-supported, AI-native IDE. An Electron desktop app in `apps/desktop`, a
Next.js marketing and docs site in `apps/web`, and the logic in `packages/*` — which are
plain TypeScript with no Electron and no DOM, so the rules that matter are testable without
launching an editor.

## Every new feature must be findable and documented

This is not a style preference. A feature nobody can find is a feature that does not exist,
and ADCode has shipped several: complete main-process code, working IPC, no door into it
from anywhere in the UI. When you add or change a feature, all five of these are part of the
change — not follow-up work:

1. **A help entry** in `packages/help/src/entries/<group>.ts` — `plain`, `why`, and `how`,
   written for somebody who has never seen the feature.
2. **A row in the feature catalogue**, `packages/help/src/features.ts`. This single table
   decides how every surface offers a way in. A feature absent from it advertises "open its
   Settings row" as its only route, which for anything that is not a switch is no route.
3. **A place in the desktop app's Feature library** — the feature icon in the workbench.
   This comes free once 1 and 2 are done, because the library is generated from them, but
   check it renders rather than assuming.
4. **The other help surfaces**: the settings popover, the in-app guide, and universal
   search all read the same two files. Confirm the feature appears in each.
5. **A web doc a user can read**, at `apps/web/src/lib/docsGuides.ts` — real numbered steps,
   concrete benefits, and an honest answer to "why is this better than what I already use".
   Without an entry the page still renders, but from text derived off the help entry; for
   anything a person would open a manual for, write the guide.

Then run `node scripts/docs-seed.mjs`. It regenerates `apps/web/src/lib/docsSeed.ts` (which
`/docs`, `/llms.txt`, `/llms-full.txt` and the sitemap all read) and
`docs/features/complete-feature-guide.md`. `packages/help/test/docsSeed.test.ts` fails if you
forget. The generator parses TypeScript with regexes, so **a new kind of action has to be
taught to `docs-seed.mjs` in the same change**, or it silently writes a seed missing those
routes.

Two rules the tests enforce, worth knowing before you hit them:

- **A command belongs to exactly one feature.** Reusing `terminal.new` across three features
  fails `features.test.ts`. If a feature has no command of its own, give it keywords only —
  a boolean setting then falls through to a derived toggle, which is a real action.
- **Every command a feature names must be registered** in `apps/desktop/src/renderer/main.ts`
  (`featureCommandCoverage.test.ts`), and every registered command must be classified.

## Finding what is already hidden

Diff the preload API against the renderer: a `window.adcode.*` method no renderer file calls
is a finished feature with no door. That is how local file history and update status were
found — main-process code, IPC channels and preload bindings all complete, zero callers.

## Verifying

`npm run verify` — types, the dependency firewall, and every test.

A green suite is not the acceptance test. The app is:

```
npm run desktop:build && node scripts/smoke.mjs
```

Read the printed check values rather than the exit code. Several UI bugs have passed a full
green run — the tests asserted the model, not what the window showed.

## Two traps specific to this repo

- **No npm workspaces.** The repo lives on a FAT32 volume, which has no symlinks, and npm's
  workspace linking is symlink-based. Local packages resolve by alias instead, and the three
  alias lists must stay in step: `tsconfig.json` `paths`, `vitest.config.ts`, and
  `apps/desktop/electron.vite.config.ts`. A subpath like `@adcode/ai/terminalTeam` must sit
  **above** the bare `@adcode/ai` key — the resolver takes the first key that matches, and a
  prefix match on the shorter one rewrites the path to nonsense.
- **The renderer must not import `@adcode/ai`'s barrel.** It pulls every provider SDK into a
  browser bundle that cannot use them. Import the subpath, and if the renderer needs
  something from a neighbouring module, re-export it from the subpath rather than reaching
  for the barrel.
