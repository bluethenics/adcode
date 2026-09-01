# Pop-up Workbench Design

**Date:** 2026-09-01

**Status:** Approved in conversation; awaiting written-spec review

**Release:** ADCode 1.0.0 asset refresh

## Purpose

ADCode's activity tools should feel immediately available without permanently taking space
from the editor. The current shared-sidebar treatment made Structure, Earnings, Features,
and Settings predictable, but it also made rich tools feel cramped and caused every icon to
replace the user's current context. This revision restores the pop-up interaction the user
prefers, gives complex work full-size workspaces, and makes the panels that remain read as
complete rounded boxes rather than unfinished regions with only a right border.

The emotional target is calm, direct, and familiar: macOS-like material depth, clear spatial
hierarchy, and short physical motion with no decorative animation.

## Scope

### Main workspace pop-ups

- Source Control
- AI Chat

These are near-full-screen modal workspaces because their tasks involve multiple related
regions, long content, and sustained focus.

### Large and medium pop-ups

- All Features: large searchable library.
- Connect Model: focused dialog layered above AI Chat or opened independently.
- Settings: medium-to-large settings dialog.
- Help Guide and Keyboard Shortcuts: migrate visually to the shared rounded dialog shell.

### Anchored activity pop-ups

- Structure
- Earnings

These stay close to their activity-bar launchers and preserve the current editor/sidebar
context. Only one anchored activity pop-up may be open at a time.

### Boxed workbench surfaces

- Explorer
- Search
- Problems
- Terminal

These remain structural workbench panels. They gain complete borders, inset spacing,
rounded corners, and restrained shadows so each reads as a contained surface.

Preview, onboarding, account, collaboration, result/confirm prompts, and ordinary menus do
not change behavior. They may consume shared visual tokens where that is mechanically safe,
but this work will not restructure them.

## Interaction Hierarchy

There are three explicit layers:

1. **Workbench surfaces**: editor, boxed sidebar, and boxed bottom panel.
2. **Primary pop-up**: one main, large, medium, or anchored pop-up.
3. **Dependent pop-up**: a focused child such as Connect Model or a help explanation.

Opening a primary pop-up closes any other primary pop-up. Opening Connect Model from AI Chat
keeps Chat mounted underneath and returns focus to Chat when Connect closes. Escape closes
only the topmost layer. Backdrop clicks close non-destructive pop-ups but never confirm an
action. Close buttons are always visible in the top-right of the surface.

Each launcher exposes `aria-haspopup="dialog"` and mirrors the open state through
`aria-expanded` and, where appropriate, `aria-pressed`. When a pop-up closes, focus returns
to its launcher. A command or menu launch without a visible trigger returns focus to the
editor, except Connect launched from Chat, which returns to Chat.

## Shared Pop-up Shell

A new workbench-owned shell centralizes behavior that is currently repeated across feature
modules:

- top-layer or fixed overlay mounting;
- modality and scrim behavior;
- initial focus and focus restoration;
- Escape and backdrop dismissal;
- launcher state synchronization;
- responsive size classes;
- open/close motion and reduced-motion equivalents;
- nested-dialog ownership.

Content modules continue to own their data, actions, loading states, and internal keyboard
navigation. They do not position themselves or register global dismissal listeners.

The shell supports four sizes:

- `anchored`: 360-440px wide, height limited by the workbench viewport;
- `medium`: min(760px, viewport minus 32px);
- `large`: min(1120px, viewport minus 40px);
- `workspace`: viewport minus 24-32px on every usable edge, capped at 1480px wide.

The title bar and status bar remain visible behind workspace dialogs so the app still feels
like ADCode rather than a second window. The scrim reduces background contrast without
making the editor disappear.

## Surface Layouts

### Source Control

Source Control becomes a workspace dialog with a stable three-region layout:

- **Left rail (280-340px):** branch identity, ahead/behind state, Pull/Push/Fetch, conflict
  check, changed files grouped into staged and unstaged lists, and stage actions.
- **Center workspace (flexible):** commit message and primary Commit action at the top;
  selected change or commit information below. Existing file/revision opening remains in the
  editor and does not duplicate a diff renderer inside the dialog.
- **Right inspector (300-380px):** repository history and active-file timeline, with the
  existing restore and commit-file actions.

The most common path reads left-to-right: choose changes, describe the commit, review
history. Repository-empty, clean, detached, no-remote, conflict, and action-error states keep
their current honest messages.

### AI Chat

AI Chat becomes a workspace dialog rather than a draggable card:

- **Left rail (260-320px):** searchable conversation history, New conversation, rename,
  delete, and clear actions.
- **Center conversation:** model identity, transcript, streaming state, memory disclosure,
  and a sticky bottom composer with Send, Team, and Schedule.
- **Right inspector (320-400px, collapsible):** isolated task status, Team roles and progress,
  automation schedules, review/trace/conflict actions, and usage notices.

The transcript is the dominant region. History and inspector can be collapsed independently
and remember their state for the session. The former free-drag position is retired because a
near-full-screen surface has no useful draggable placement.

### All Features

All Features becomes a large two-pane library:

- a compact category rail with counts and the current filter;
- a main results region with search, plain-language descriptions, availability state, and
  obvious Open/Settings actions.

Groups become scannable sections rather than a single narrow column. Opening a feature
closes the library before routing to the requested destination.

### Connect Model

Connect Model uses a medium dialog, or a dependent dialog above Chat:

- provider list and search on the left;
- provider status, address/key controls, validation result, model list, and capability marks
  on the right.

The primary action remains “Check and save.” Keys remain in the OS password store and are
never rendered back into the field. Connection errors stay inline beside the action.

### Settings

Settings returns to a medium-to-large dialog. Search and the group index stay visible while
the settings body scrolls. Help explanations use the dependent layer and return focus to the
question-mark button.

### Structure and Earnings

Structure and Earnings become anchored, non-modal pop-ups beside their activity icons.
They have full rounded cards, clear headers, visible close buttons, and no scrim. They close
on Escape, launcher reactivation, or a pointer press outside. They never resize or replace
Explorer/Search.

## Boxed Workbench Surfaces

Explorer and Search sit inside an inset sidebar card with a complete 1px material border,
12px corner radius, and a quiet shadow. The activity rail remains visually separate.

Problems and Terminal use the same surface language inside the bottom panel: complete border,
12px corner radius, and a small inset from the main workbench edges. Terminal maximize keeps
the title bar, activity rail, and status bar visible; the maximized terminal remains a box,
not a borderless sheet.

The borders use semantic material tokens rather than a hard-coded gray, increasing contrast
under `prefers-contrast: more` and becoming opaque under reduced transparency.

## Motion and Material

Pointer-opened pop-ups materialize from their source with opacity `0 -> 1`, scale
`0.97 -> 1`, and a small source-relative translation. Workspace and independent dialogs use
a centered scale without directional travel. Duration is 220ms with the existing macOS-like
`cubic-bezier(.32,.72,0,1)` curve. Close reverses from the current presented state and remains
interruptible.

Keyboard-opened dialogs appear without spatial travel. Reduced motion uses a 100ms opacity
cross-fade. Reduced transparency replaces glass backgrounds with opaque elevated surfaces and
removes backdrop blur. No layout dimension, blur radius, or shadow animates per frame; motion
uses compositor-friendly transform and opacity.

## Responsive Behavior

At widths below 980px, Source Control and AI Chat collapse from three columns to two. Their
right inspectors become explicit toggleable drawers inside the dialog. Below 720px, history
or changes becomes a toggleable left drawer and the center workspace takes the full width.

Medium and large dialogs keep a minimum 12px viewport inset on narrow windows, use smaller
corner radii, and ensure headers and primary actions remain visible. Anchored pop-ups become
bottom sheets below 620px because the activity rail no longer provides enough horizontal
space. Bottom sheets keep a visible close button and do not depend on a swipe gesture.

Terminal tabs switch to a horizontal strip at the existing responsive breakpoint, with
their ARIA orientation updated to match.

## State and Persistence

- Existing workbench sidebar selection and width persistence remain intact.
- Source Control continues to reuse the existing mounted panel instance and Git data APIs.
- Chat sessions, task state, Team state, schedules, and model settings remain unchanged.
- Pop-up disclosure is session-only and is not restored on app launch.
- AI Chat history/inspector collapse preferences persist for the current renderer session.
- Terminal maximize preference retains its existing close/reopen behavior.

No backend, IPC, credential-storage, Git, AI-provider, billing, or updater contract changes.

## Accessibility

- Native `<dialog>` is preferred for modal primary and dependent pop-ups where it does not
  conflict with nested ownership; otherwise the shared shell implements equivalent focus
  trapping and inert background behavior.
- Every dialog has a programmatic title and description where needed.
- Tab order follows the visual reading order.
- Lists keep their existing arrow-key behavior; dialog-level shortcuts never steal keys
  from textareas, inputs, or content editors.
- Escape closes one layer at a time.
- Launcher state and responsive tab orientation are synchronized in the DOM.
- All controls meet the current focus-visible and minimum target rules.

## Error and Loading States

Data modules keep ownership of errors. The shell never replaces errors with generic toasts.
Loading should not move the dialog: regions use stable minimum sizes, inline progress copy,
and disabled repeat actions. A failure leaves the pop-up open with the attempted input intact.

## Testing

### Unit and markup coverage

- shell disclosure, layer ordering, Escape behavior, and focus restoration;
- Source Control layout landmarks and action ownership;
- Chat history/transcript/inspector regions and collapse state;
- Connect dependent-dialog behavior;
- launcher ARIA state and responsive orientation;
- reduced-motion and reduced-transparency contracts;
- session and terminal-maximize regression coverage.

### Electron smoke coverage

- each activity launcher opens the correct surface and a second activation closes it;
- Structure/Earnings do not replace or resize Explorer;
- Source Control and Chat occupy the workspace size while title/status chrome remains visible;
- Connect layers above Chat and returns focus correctly;
- feature actions route after the library closes;
- source-control stage/commit/history flows still work;
- chat send/history/connect flows still work;
- boxed surfaces have complete borders and non-zero radii;
- narrow viewport layouts keep every close and primary action reachable;
- zero suspicious renderer log lines.

The repository typecheck, dependency firewall, full unit suite, desktop production build, and
complete Electron smoke run remain release gates.

## Release and Deployment

After verification, commit and push the implementation to `main`, run the existing
multi-platform GitHub release workflow with `publish=true`, and replace the published 1.0.0
assets. Verify the workflow commit SHA, updater manifests, release asset timestamps and
digests, and the public Windows/Linux download endpoints.

Because the semantic version remains 1.0.0, new downloads receive this build but already
installed 1.0.0 clients do not auto-update to it. Windows remains unsigned and macOS remains
unavailable to users until signing/notarization gates are satisfied.

Unrelated dirty web, documentation, advertising, and help-source changes must not be included
in the implementation commit or production web deployment.

## Acceptance Criteria

1. Structure, Earnings, and Settings are pop-ups rather than shared sidebar views.
2. Source Control and AI Chat are near-full-screen workspace dialogs.
3. All Features and Connect Model use spacious, clearly divided pop-up layouts.
4. Explorer, Search, Problems, and Terminal read as complete rounded boxes.
5. Main and dependent pop-ups have deterministic layering, Escape, focus, and launcher states.
6. Existing Git, AI, session, terminal, settings, and earnings behavior remains functional.
7. Responsive and accessibility behavior matches this document.
8. All release gates pass and fresh public 1.0.0 downloads serve the new artifacts.
