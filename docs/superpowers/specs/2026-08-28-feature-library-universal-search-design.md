# Feature Library and Universal Search Design

**Date:** 2026-08-28  
**Status:** Approved for implementation
**Product:** ADCode desktop IDE and shared help documentation

## Summary

ADCode will make every shipped user-facing feature discoverable and usable through one
searchable feature catalogue. A new activity-bar icon directly below Earnings opens a
themed feature library. The title-bar command centre becomes universal search rather than a
file-only default. Existing menu groups gain missing direct actions, while **View > All
Features** and **Help > Feature Guide** provide complete menu-bar routes.

Every feature has a visible `?` explanation with three answers: what it does, why somebody
would use it, and how to use it. The feature library, universal search, Settings, in-app
Guide, website docs, and written manual use the same `@adcode/help` content instead of
maintaining competing lists.

The work preserves every current interaction and shortcut. `Ctrl+P` remains file Quick
Open, `Ctrl+Shift+P` remains the Command Palette, and the existing Explorer, Search,
Structure, Source Control, Problems, Earnings, and Settings activity controls remain.

## Goals

1. Let a person discover every shipped ADCode feature without already knowing its name.
2. Give every feature a working route, not merely a description.
3. Make the main title-bar search find everything a person can open or invoke, not only
   files.
4. Keep specialized file, command, symbol, and workspace-content searches available.
5. Make the menu bar a complete route to the feature library and all major direct actions.
6. Explain every feature consistently in the launcher, Guide, Settings, and website docs.
7. Match ADCode's current iOS-inspired themes, materials, motion, density, keyboard, and
   accessibility behavior.
8. Prevent catalogue, command, setting, menu, and documentation coverage from drifting.

## Non-goals

- Replacing the Command Palette, Quick Open, workspace content search, or symbol search.
- Adding unavailable marketplace extensions or documenting planned features as shipped.
- Duplicating feature implementations inside the launcher or search overlay.
- Searching file contents from the title bar; the existing Search panel remains the
  intentional regex and replace surface.
- Adding cloud indexing, telemetry, favorites, recommendations, or usage-based ranking.
- Exposing AI provider reasoning or bypassing existing safety/confirmation boundaries.

## Definition of a shipped feature

A shipped feature is a user-recognizable capability represented by at least one of:

- an available setting in `SETTINGS_SCHEMA`;
- a public renderer command that opens, invokes, or controls a user-facing capability;
- an existing help entry for a workbench surface, account/earnings action, or editor
  gesture that has no setting;
- a complex surface whose individual actions live inside it, such as Team mode, scheduled
  AI prompts, safe workspace review, Live Preview, Source Control, or the debugger.

Internal IPC operations, lifecycle plumbing, telemetry adapters, and implementation-only
helpers are not separate features. Fine-grained commands such as Step Over and Stage All
remain searchable actions within their parent feature; they do not need duplicate feature
cards.

Only implemented behavior appears as available. A feature with a missing prerequisite may
remain visible with a specific explanation and a route to satisfy it. Planned or
unimplemented behavior must not be presented as usable.

## Shared catalogue contract

`@adcode/help` remains the content authority. `HelpEntry` continues to own `title`, `plain`,
`why`, `how`, group, settings, shortcut, and related entries. It gains explicit access
metadata only where access cannot be inferred from `settingIds`.

```ts
export interface FeatureCommandAction {
  readonly kind: "command";
  readonly command: string;
  readonly label: string;
}

export interface FeatureSettingAction {
  readonly kind: "setting";
  readonly settingId: string;
  readonly label: string;
}

export type FeatureAction = FeatureCommandAction | FeatureSettingAction;

export interface FeatureRecord {
  readonly entry: HelpEntry;
  readonly actions: readonly FeatureAction[];
  readonly keywords: readonly string[];
}
```

Settings routes are derived from `entry.settingIds`, with the first setting as the primary
route unless the entry declares a more useful command action. Workbench and gesture entries
declare commands explicitly. Complex feature entries may declare several actions, with the
first available action becoming **Open** and the others shown inside the detail view.

The public catalogue functions are pure:

```ts
featureRecords(): readonly FeatureRecord[];
featureFor(id: string): FeatureRecord | undefined;
searchFeatures(query: string): readonly FeatureRecord[];
```

Search matches title, plain/why/how explanations, keywords, setting labels, command labels,
and group title. Results preserve catalogue order for an empty query and use the existing
fuzzy matcher for a non-empty query.

## Coverage guarantees

Build-breaking tests enforce:

- every available setting has one help owner and therefore one feature route;
- every help entry has at least one inferred or explicit usable action;
- declared setting IDs exist;
- declared command IDs are registered public commands;
- no action points at an unavailable/unknown target without an explicit prerequisite state;
- every public feature command is either a direct feature action, a child action of a
  catalogued parent feature, or explicitly classified as application plumbing;
- every feature is reachable from the feature library and universal search;
- `features.open` is present in the menu bar;
- website docs seed exactly matches the shared explanations.

The command classification lives beside the catalogue as data, not as a source-code grep in
production. Tests may compare it with the real command registry/menu model through exported
pure command descriptors.

## Activity-bar feature library

### Placement and icon

The new `All features` button is directly below `open-earnings` and above the bottom-pinned
Settings button. Like Earnings and Structure, it has no `data-view`: it opens a popover and
must not change which sidebar view is selected. It uses a drawn four-cell library glyph,
not a text/emoji glyph. It exposes `aria-haspopup="dialog"` and keeps `aria-expanded`
accurate.

### Popover layout

The popover is a fixed, activity-button-anchored glass sheet using existing semantic color,
radius, shadow, blur, type, density, and motion tokens. It is approximately 440 CSS pixels
wide, clamps to the viewport, and scrolls internally rather than deforming the workbench.

```text
┌─────────────────────────────────────────────┐
│ All features                         Done   │
│ [ Search what ADCode can do…              ]│
│ All  AI  Edit  Navigate  Git  Run  More    │
│                                             │
│ AI                                          │
│ ◇ Assistant                                 │
│   Ask about or safely change this project.  │
│   [Open]                                  [?]│
│                                             │
│ ◇ Scheduled AI messages                    │
│   Deliver a prompt later while ADCode runs. │
│   [Open] [Settings]                       [?]│
└─────────────────────────────────────────────┘
```

Categories come from existing help/settings groups and use short user-facing labels. The
`All` view is default. Search filters across all groups regardless of the selected category;
selecting a category clears the search so the state is never contradictory.

Each feature row includes its title, `plain` explanation, primary action, optional secondary
actions, and a visible `?` button. The `?` opens the existing help-popover pattern with
clearly labeled **What it does**, **Why use it**, and **How to use it** sections. It does not
replace the feature library or navigate away.

### Interaction

- Click, Enter, or Space opens the library from the activity button.
- Up/Down moves between feature results; Left/Right moves category chips when focused.
- Typing in the search filters immediately using local catalogue data.
- Enter runs the selected primary action; `?` is separately focusable.
- Escape closes the explanation first, then the library.
- Clicking outside closes the topmost transient surface.
- Closing restores focus to the opening control unless an action deliberately moves focus.
- Running a command delegates to the command registry. Opening a setting calls
  `settingsView.openAt(settingId)`. The feature component never reimplements behavior.

Unavailable prerequisites produce a disabled action plus a concrete route such as **Open a
folder**, **Connect a model**, or **Start a terminal**. A disabled button never silently does
nothing.

## Universal title-bar search

Clicking the existing command centre, focusing it and typing, or choosing the universal
search menu command opens a single universal overlay. The idle label remains `Search
<workspace>` and its accessible label changes to `Search all of ADCode`.

### Result sources

The universal search finds everything a person can open or invoke:

1. **Features** — shared catalogue records, including explanation text and settings.
2. **Commands** — all public command-registry actions.
3. **Files** — the same workspace file source and fuzzy semantics as Quick Open.
4. **Recent folders** — local recents, opening through the existing validated workspace
   command.
5. **Symbols** — workspace symbols through the existing symbol-search bridge.
6. **Help** — represented by the matching feature's `?` action rather than a duplicate row.

Every result has a stable ID, kind label, title, optional detail, and one run operation.
Feature results additionally expose the `?` explanation. Settings are returned as feature
results whose primary/secondary action opens the exact setting row, preventing duplicate
Feature and Setting rows for the same capability.

### Query and ranking behavior

An empty query shows a small balanced set: recent folders/files, common features, and common
commands. Non-empty queries fuzzy-match labels, descriptions, keywords, command IDs, paths,
and symbol names. Exact/prefix matches beat fuzzy matches; within equivalent scores,
features precede commands, then files, symbols, and recent folders. The overlay caps each
source and the total list so keyboard response stays bounded.

Local features and commands render immediately. File and symbol providers are asynchronous,
cancellable, and generation-checked. Queries shorter than two trimmed characters do not
start workspace symbol search. A later query aborts or invalidates earlier work, and stale
results may never replace newer ones. Provider failure leaves other sources usable and shows
one quiet, source-specific explanation instead of closing the overlay.

Results are grouped with visible labels and type badges. Filename/path detail distinguishes
files; kind and path distinguish symbols; category distinguishes features. The UI never
uses color alone to communicate result type.

### Specialized searches remain

- `Ctrl+P` opens file Quick Open exactly as today.
- `Ctrl+Shift+P` opens the Command Palette exactly as today.
- `Ctrl+T` opens workspace Symbol Search exactly as today.
- `Ctrl+Shift+F` opens workspace content Search exactly as today.
- A leading `>` in universal search filters to commands for existing muscle memory.

The universal overlay may reuse pure ranking and row primitives, but it does not remove or
redirect these specialized shortcuts.

## Menu-bar access

The existing cross-platform `buildMenuBar` remains the menu authority. It gains:

- **View > All Features…** → `features.open`;
- **Help > Feature Guide** → the existing `help.guide` command;
- missing direct view actions for Output, Debug Console, Ports, and preview device sizing;
- direct AI actions where the underlying surface exposes a safe command: Assistant,
  Connect a Model, Suggest Code with AI, Set Up Team, and Schedule a Message;
- exact settings routes for complex configuration only when a menu label can describe the
  result honestly.

Every remaining feature is accessible through **View > All Features…**, so adding dozens of
duplicated menu rows is unnecessary. Menu commands and launcher actions resolve through the
same registry. macOS native menus and Windows/Linux drawn menus receive the same model.

## Command and complex-surface adapters

Simple actions reuse existing command IDs. Complex chat controls expose small intent-level
methods instead of DOM clicks:

```ts
interface ChatWidget {
  open(): void;
  openTeamSetup(): void;
  openScheduleComposer(): void;
}
```

These methods bring the chat widget forward and open the same confirmed Team/schedule flows
the visible buttons use. They do not bypass Team confirmation, terminal one-time grants,
Trusted-mode confirmation, budgets, provider connection checks, or app-open-only schedule
rules.

Feature actions that configure behavior use `settingsView.openAt`. Review, trace, rollback,
and conflict actions remain state-dependent inside the task/Team surfaces; their parent
feature cards open the Assistant and explain where those controls appear.

## In-app Help and explanations

The ADCode Guide remains the full offline manual and gains a primary **Open** action on every
feature card. Setting-backed entries also retain **Open its setting**. Related links remain.
The action is generated from the same `FeatureRecord` used by the launcher.

Every feature row in the launcher and feature result in universal search includes the same
visible `?` control. Settings continues to use the shared help popover. The three explanation
headings and copy remain identical across those surfaces.

The Help menu labels the existing guide **Feature Guide** so its purpose matches the new
library. Search continues across titles, what/why/how copy, shortcuts, and now access
keywords.

## Website and repository documentation

The generated website documentation continues to use `scripts/docs-seed.mjs`, now including
feature keywords and access guidance where useful. The generator remains deterministic and
its drift test remains release-blocking.

Create `docs/features/complete-feature-guide.md` as the detailed human manual. It includes:

- how to open and navigate All Features;
- how universal search differs from Quick Open, Command Palette, Symbol Search, and content
  Search;
- every feature category with what it contains;
- direct menu and keyboard routes;
- prerequisites and safe failure behavior;
- AI workspace, Team, Trusted, schedules, continuation, trace, privacy, and rollback links;
- examples for common goals such as opening a project, finding code, running/debugging,
  previewing, using Git, collaborating, configuring AI, and getting help.

Update README, the build prompt, feature/security docs where navigation is described, and
the release-readiness evidence after verification. Documentation must describe only controls
that exist in the candidate.

## Visual design

The chosen direction is ADCode's existing quiet monochrome glass workbench. The signature
element is the feature row's paired **Open / ?** affordance: action and understanding are
always adjacent. No new palette, typeface, emoji, illustration system, or saturated accent
is introduced.

Use semantic theme tokens for every color and material. The only motion is the existing
sheet-scale/opacity entrance and row opacity/transform; reduced-motion removes movement.
Compact density reduces row padding without shrinking hit targets below the workbench's
existing control floor. Midnight, dark, light, and system themes must remain legible.

The popover clamps within an 8 CSS-pixel viewport margin, stays above workbench panels,
never covers the activity button that opened it, and never changes workbench grid sizing.

## Accessibility

- Feature library and universal search use dialog/combobox/listbox semantics appropriate to
  their interaction.
- Every icon-only control has an accessible name; every `?` says which feature it explains.
- Category state, selected result, expanded explanation, disabled reason, and result kind
  are programmatically exposed.
- Focus is trapped only inside modal sheets; anchored popovers close and restore focus.
- Visible focus uses current tokens and is not removed.
- Result kinds and enabled states are not communicated by color alone.
- All interactions work without pointer input and at 200% zoom.
- Reduced-motion preferences remove non-essential movement.

## Performance and failure handling

- Catalogue construction and local matching are pure and synchronous over bounded local
  data.
- Universal search debounces asynchronous providers, caps results, cancels stale work, and
  never waits for symbols before showing local results.
- A failed source displays an inline source status while successful sources remain usable.
- Unknown command or setting actions are refused with a visible message and retained focus;
  coverage tests should prevent this in a shipped build.
- No feature-library action receives arbitrary paths or privileged handles.
- Closing a project clears project-only results without clearing global features/settings.
- Closing an overlay cancels outstanding search work and removes event listeners.

## Testing strategy

Implementation follows red-green-refactor. Required automated coverage includes:

1. **Catalogue tests:** settings/help/action coverage, unique IDs, valid targets, complete
   explanations, keyword search, category order, parent/child command classification.
2. **Menu tests:** All Features and missing direct actions exist, every entry resolves,
   mnemonics remain unique, accelerators do not collide, macOS formatting remains valid.
3. **Universal-search tests:** literal expected ranking, kind grouping, deduplication,
   empty state, `>` filtering, provider caps, cancellation/generation safety, partial failure,
   and no symbol request below two characters.
4. **Feature-library view-model tests:** categories, filtering, action availability,
   disabled reasons, primary action choice, and explanation lookup.
5. **Renderer interaction tests:** button placement below Earnings, open/close, `aria-*`,
   keyboard selection, `?` behavior, focus restoration, action dispatch, setting deep link,
   outside click, theme tokens, and reduced motion.
6. **Help/docs tests:** every feature card has an access route, website seed is current, and
   the complete manual links only to real help IDs/routes.
7. **Smoke:** open All Features from the new activity icon and the View menu, search for a
   feature by descriptive words, open its `?`, invoke a safe action, use main search to find
   a feature/command/file/symbol, and verify no overlay blocks the editor afterward.

Final gates are `npm run verify`, desktop and web production builds, normal and packaged
desktop smoke, documentation drift checks, and a visual inspection in all themes plus
reduced motion.

## Rollout and rollback

This is local navigation over existing capabilities and requires no server migration.
Rollout ships with the launcher and universal search enabled because they do not grant new
authority. Existing specialized search shortcuts are the behavioral fallback.

Rollback removes the new activity button, universal overlay, and new menu commands together,
then restores command-centre click/type routing to Quick Open/Command Palette. The shared
help copy and underlying feature commands remain valid, so rollback cannot remove actual
editing, AI, Git, terminal, preview, collaboration, earnings, or settings behavior.

## Acceptance criteria

- The All Features icon is directly below Earnings and opens a themed, keyboard-accessible
  feature library without changing the sidebar selection.
- Every shipped feature appears with a working access route and a visible `?` explanation.
- Every explanation answers what, why, and how from the shared catalogue.
- Main title-bar search returns features, commands, files, recent folders, symbols, and help
  matches, with visible result kinds and no stale asynchronous results.
- `Ctrl+P`, `Ctrl+Shift+P`, `Ctrl+T`, and `Ctrl+Shift+F` retain their current specialized
  behavior.
- View and Help menus open the complete library/guide, and missing major actions are added
  to their relevant menus.
- Complex AI menu/launcher actions reuse the confirmed safe flows and never bypass approval
  or budget boundaries.
- All current themes, density modes, reduced motion, keyboard navigation, and accessibility
  expectations pass.
- In-app Help, generated website docs, README, build prompt, and detailed feature manual
  match the implemented candidate.
- Full verification, builds, and smoke journeys pass before the implementation is described
  as complete.
