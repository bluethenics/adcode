# Every feature answers: discoverability, empty states, and the docs that follow

**Date:** 2026-08-30
**Status:** approved, ready for planning

## The complaint

> "there is a feature called merge conflicts but everything leads to a toggle in the
> settings and I don't even know how to use this feature like accepting and rejecting.
> If there is nothing it should say there is nothing here."

Merge-conflict resolution works. `packages/git/src/conflicts.ts` finds conflict blocks and
applies a resolution; `apps/desktop/src/renderer/editor/gitOverlay.ts` draws Keep yours /
Keep theirs / Keep both above each one. It is reachable only by already having a conflicted
file open. There is no button, no menu item, and no way to ask "do I have conflicts?" - so
the only trace of the feature a user ever finds is a switch in Settings.

That is not one broken feature. It is the default behaviour of the catalogue.

## Root cause

`packages/help/src/features.ts` builds each feature's actions from a hand-written
`METADATA` table holding **18 entries**. For every other entry it auto-generates one
action:

```ts
actions.push({ kind: "setting", settingId, label: `Open ${setting.label} setting` });
```

`featureActionPresentation` then picks the first enabled action as primary. For 68 of 86
features that is a Settings deep-link. The feature library, universal search, the in-app
guide and the website's `/docs` all read from this one table, so the dead end is uniform
across every surface.

A second table, `FEATURE_COMMANDS.children`, already maps 11 features to real commands
(`adcode.git.stageCommitUi` to `git.commit`, `git.push`, `git.checkout` and eight more).
Nothing reads it except a coverage test. The routes exist and are thrown away.

## Measured state

- 86 help entries.
- 18 have a command route in `METADATA`.
- 11 more have commands in `FEATURE_COMMANDS.children` that never become actions.
- **57 have no command anywhere.**

Three features are wired to code that no renderer line calls:

| API | Implemented in | Called from renderer |
| --- | --- | --- |
| `history.versions` | `src/main/localHistory.ts`, preload line 237 | never |
| `updates.status` | `src/main/autoUpdate.ts`, preload line 276 | never |
| `updates.onChanged` | same | never |

`openLocalVersion()` at `apps/desktop/src/renderer/main.ts:2451` is complete, correct, and
unreachable. `sourceControl.ts:73` declares `openLocalVersion` in its deps and never uses
it. Local file history is a finished feature with no door.

## Principles

1. **A feature that does something gets a way to do it.** A command, and a home in the
   menu bar or a panel.
2. **A check that finds nothing says so.** Silence is indistinguishable from breakage.
3. **A toggle acts where you found it.** Choosing a passive feature in the library flips
   it and reports the new state, rather than navigating you to Settings to flip it there.
4. **One source of truth.** Help entries feed the settings popover, the guide, the desktop
   catalogue, `/docs`, `llms.txt` and `complete-feature-guide.md`. Text is edited once.

## Sub-project A - desktop

### A1. The mechanism

In `packages/help/src/features.ts`:

- Fold `FEATURE_COMMANDS.children` into the generated actions, so a feature's real commands
  become real actions.
- Introduce a third action kind, `toggle`, carrying a `settingId`. For a boolean setting
  with no command route, the primary action becomes "Turn on" / "Turn off", applied in
  place. The settings deep-link stays available as a secondary action.

`featureActionPresentation` in `featureLibraryModel.ts` ranks command over toggle over
setting. `runFeatureAction` in `main.ts` gains a `toggle` branch that writes the setting and
reports the result in the status line.

### A2. New commands

Each runs a check that already exists, and each states the empty result.

| Command | Title | Menu | Empty answer |
| --- | --- | --- | --- |
| `git.conflicts` | Git: Check Merge Conflicts | Git | No merge conflicts - nothing to resolve. |
| `git.blame` | Git: Blame This Line | Git | This line is not committed yet - nothing to blame. |
| `git.timeline` | Git: File Timeline | Git | No commits touch this file yet. |
| `file.localHistory` | Local History for This File | File | No local versions of this file yet. |
| `session.recover` | Recover Unsaved Files | File | Nothing to recover - every file is saved. |
| `updates.check` | Check for Updates | Help | You are on the latest version. |
| `edit.organizeImports` | Organize Imports | Edit | Imports are already tidy. |
| `edit.todos` | List TODOs and FIXMEs | Edit | No TODO or FIXME comments here. |
| `edit.spelling` | Check Spelling in Comments | Edit | No misspellings in comments. |
| `structure.unusedCss` | Find Unused CSS Rules | View | Every rule matches something. |
| `structure.missingClasses` | Find Classes Nothing Defines | View | Every class is defined. |

Engines, all existing and tested:

- `findConflicts`, `hasConflictMarkers` - `packages/git/src/conflicts.ts`
- `misspellingsIn` - `packages/spell/src/index.ts`
- `todoMarksIn` - `packages/structure/src/todos.ts`
- `unusedSelectors`, `missingClasses` - `packages/structure/src/styleLinks.ts`
- `organizeImports` - `packages/format/src/imports.ts`

This task writes no analysis logic. It writes commands, menu rows, buttons, and messages.

### A3. Buttons

- **Source Control panel.** A `Check Conflicts` button joins Pull / Push / Fetch in the
  actions row, built with the existing `actionButton` helper. Results render as a
  `scm-section` above the change list: one row per conflicted file, each opening the file
  scrolled to its first conflict. When there are none the section shows the standard
  `empty-hint`: "No merge conflicts."

  Repo-wide detection is free. `gitIpc.ts:53` already returns `isConflicted` on every
  status entry; no new git call is needed.

- **Editor tab context menu.** `Local History` and `File Timeline` rows, so both are
  reachable from the file they describe.

### A4. Where results go

Per the approved answer: a results panel plus a status line.

- Conflicts render in the Source Control panel.
- Code checks (`edit.todos`, `edit.spelling`, `structure.unusedCss`,
  `structure.missingClasses`) render in the Problems panel.
- Every check writes a status-bar line on completion, so a check that finds nothing is
  still visibly a check that ran.

### A5. Scope boundary

The code checks run over **open editors**, not the whole workspace. That matches how
`styleHints`, `todoHighlight` and `spellCheck` already run today. A workspace-wide sweep
needs a main-process file walk with cancellation and progress; it is a separate piece of
work and is explicitly out of scope here.

## Sub-project B - website

The same disease, on the marketing site.

### B1. Missing page metadata

`src/app/blog/page.tsx`, `src/app/blog/[slug]/page.tsx`, `src/app/changelog/page.tsx`,
`src/app/download/page.tsx` and `src/app/advertise/page.tsx` export **no metadata at all**.
Every blog post inherits the root layout's title, so all of them present to a crawler as
"ADCode - <tagline>" with one shared description and no canonical.

Each gains `generateMetadata` (or `export const metadata` where the route is static) with
title, description, canonical, OpenGraph and Twitter fields - matching the pattern already
used correctly in `src/app/docs/[slug]/page.tsx`.

### B2. Structured data written and never rendered

`src/lib/schema.ts` exports `blogPosting()` and `faqPage()`. Neither appears in any page.

- `blogPosting` renders on `/blog/[slug]`.
- `faqPage` renders on the homepage, over the `FAQ` constant already in that module.

### B3. Sitemap gaps

`src/app/sitemap.ts` lists the homepage, `/versions`, `/docs`, every doc page, `/privacy`
and `/terms`. It omits `/blog`, every blog post, `/changelog`, `/download` and `/advertise`.
Posts are reachable to crawlers only through `feed.xml`. All public routes are added.

### B4. AI visibility

`/llms.txt` and `/llms-full.txt` exist, are well built, and read from the same modules the
pages do. They need no structural change: they inherit A's new access routes when
`scripts/docs-seed.mjs` regenerates the seed. Extending the sitemap and fixing canonicals
also improves what an answer engine retrieves.

Out of scope: keyword research, content strategy, and writing new blog posts. This spec
covers defects, not editorial work.

## Ordering

A before B. `scripts/docs-seed.mjs` generates `apps/web/src/lib/docsSeed.ts` and
`docs/features/complete-feature-guide.md` from `packages/help`, so A's catalogue edits
rewrite the website's docs and the feature guide as a side effect. Running B first would
mean doing the docs twice.

## Documentation

All four surfaces update from one edit, by design:

1. **Help entries** (`packages/help/src/entries/*.ts`) - the `how` field of each affected
   entry currently describes a Settings row. It is rewritten to name the button, the menu
   path and the shortcut. Feeds every other surface.
2. **`docs/features/complete-feature-guide.md`** - regenerated by `scripts/docs-seed.mjs`.
3. **Website `/docs`** - regenerated into `apps/web/src/lib/docsSeed.ts` by the same script.
4. **`llms.txt` / `llms-full.txt`** - read the regenerated seed at build time.

`CHANGELOG.md` records the new commands and empty states under Unreleased.

## Testing

Test-driven, per repository practice.

- One test per new command asserting the empty-state message is produced when the check
  finds nothing. These are the tests the feature exists for.
- A catalogue test asserting **no feature's primary action is a settings deep-link when a
  command or toggle is available** - the regression that caused this work.
- A test asserting every command in `FEATURE_COMMANDS.children` resolves to a registered
  command id, extending the existing coverage test.
- `packages/help/test/docsSeed.test.ts` already fails when the generated seed drifts from
  the catalogue. It guards B against A at no extra cost.
- Menu tests already assert mnemonic uniqueness per menu; new rows must not collide.

## Risks

- **Mnemonic collisions.** Eleven new menu rows across File, Edit, View, Git and Help. The
  existing menu test catches duplicates within a menu; new labels are chosen against the
  rows already there.
- **Status-line noise.** Eleven commands that all report into one status line. Mitigated by
  results living in panels; the status line confirms, it does not carry the findings.
- **`toggle` as a third action kind** touches the shared `FeatureAction` union, which the
  desktop, the docs generator and the website's seed all read. `docs-seed.mjs` parses
  `features.ts` with regexes and must be updated in the same change, or it silently writes
  a seed with no toggle routes. The `docsSeed` test catches this.
