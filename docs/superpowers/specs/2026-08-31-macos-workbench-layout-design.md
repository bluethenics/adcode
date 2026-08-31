# macOS Workbench Layout Design

**Date:** 2026-08-31
**Status:** Approved
**Scope:** Electron desktop renderer workbench, side tools, bottom panel, and terminal layout

## Purpose

ADCode should make moving between files, tools, and execution feel calm and predictable. The current desktop renderer already has the right major regions—activity rail, sidebar, editor, bottom panel, terminal tabs, and splitters—but several activity icons open unrelated floating surfaces, the sidebar cannot adapt cleanly to a narrow window, and the terminal cannot take over the workbench when it needs sustained attention.

This change gives those regions a consistent VS Code-style interaction model expressed with restrained macOS materials, typography, and motion. It does not rewrite editor, terminal, diagnostics, earnings, structure, feature-library, or settings business logic.

## Product Principles

- Keep the editor and terminal mounted whenever their state or scrollback must survive a view change.
- Put non-blocking tools in a docked region, not in a modal layer that hides the work.
- Keep window controls, the activity rail, and status information available while the terminal is maximized.
- Make the pointer path fluid and spatial while keeping high-frequency keyboard commands immediate.
- Preserve user agency: every expanded region has an obvious close or restore action, an accessible shortcut path, and reliable focus restoration.
- Use system materials only for chrome. Code, terminal output, and dense reading surfaces remain solid.

## Layout

The desktop workbench has three stable layers:

```text
┌──────────────────── Unified translucent title bar ────────────────────┐
│ Activity │ Docked sidebar │ Editor / preview                         │
│   rail   │                ├──────────────────────────────────────────┤
│          │                │ Terminal / Problems / Output             │
└───────────────────────────┴──────────────────────────────────────────┘
```

The activity rail remains visible at every supported window size. Explorer, Search, Structure, Source Control, Earnings, Features, and Settings use one sidebar selection model and expose their current state through the activity button. Problems continues to reveal the bottom-panel Problems tab, matching its existing output-oriented behavior. All activity buttons use the same pressed, focus, tooltip, and expanded-state language even though Problems targets the bottom panel. Ordinary side tools do not dim or block the editor.

On a wide window, the selected side view occupies the resizable docked sidebar. Pressing the already-selected activity button collapses the sidebar. Pressing a different activity button swaps content without first closing the region.

On a narrow window, the sidebar becomes an overlay drawer above the workbench content. Clicking outside, pressing Escape, or pressing the selected activity button dismisses it. The activity rail stays exposed, so no gesture is required to recover navigation. The wide and narrow modes use the same active-view state and content instances.

The user-selected sidebar width is preserved and re-clamped when the window changes size. Responsive overlay mode temporarily overrides dock geometry but does not destroy the stored wide-layout width.

## Docked Side Views

Existing business logic becomes content that can be mounted in the shared sidebar frame:

- **Explorer:** project title, root actions, and file tree.
- **Search:** query controls and file results.
- **Structure:** “This file” and “This project” tabs. Relations stack below their names when the available width cannot support two columns.
- **Source Control:** repository state, changes, commit input, and history.
- **Earnings:** compact account and balance summaries, preset information, and direct settings actions. The client continues to display only values supplied by the server.
- **Features:** search-first capability list with a single category control and explicit actions.
- **Settings:** the current settings groups and controls.

The shared sidebar frame provides a plain-language title, a short contextual subtitle where it improves orientation, a close button, and view-specific actions beside the content they affect. Views keep their own internal tab and list semantics. Converting a floating view to docked content must not duplicate data fetching or create a second independent state store.

## Terminal and Bottom Panel

The bottom panel continues to own Terminal, Problems, Output, Debug Console, and Ports bodies so mounted state, terminal scrollback, and live subscriptions survive tab switches. The Problems activity button opens that existing tab rather than creating a second diagnostic view or data source.

The panel header gains a maximize/restore control beside Close. Maximizing the panel hides the editor region and its splitter, then lets the panel fill the available workbench height. It does not enter operating-system full screen and does not hide the title bar, activity rail, sidebar, or status bar. Sidebar collapse and terminal maximize are independent, allowing either a terminal-only work area or a terminal-plus-sidebar work area.

Maximized state survives bottom-panel tab changes and closing/reopening the panel during the current renderer session. It resets on a new app launch so the editor never appears to have disappeared because of stale state. The last ordinary panel height is retained and restored after unmaximizing.

Terminal splits remain side by side while each pane can satisfy a useful minimum width. Below that threshold, panes stack vertically. Terminal session tabs use a compact rail on wide panels and a horizontally scrollable strip when the rail would take too much of the available terminal width.

Monaco and xterm are explicitly laid out after sidebar, panel, breakpoint, and maximize state changes. Geometry-dependent fitting happens after the new layout is committed, never from a guessed timeout.

## Visual Language

The visual system extends the current semantic tokens rather than creating a parallel theme.

### Palette

- **Canvas Mist:** `#F2F2F7`
- **Surface White:** `#FFFFFF`
- **Graphite:** `#1C1C1E`
- **System Blue:** `#007AFF`
- **Success Green:** `#34C759`
- **Hairline:** `#D1D1D6`

Dark and Midnight themes retain their existing identities. System blue becomes `#0A84FF` in dark mode, while Midnight continues to use its near-white accent and reserves green for money. Increased-contrast mode strengthens region boundaries without replacing the semantic palette.

### Type and Shape

SF Pro Text or the platform system UI stack remains the control face. SF Mono, JetBrains Mono, or the existing monospace fallback remains the terminal and code face. Small utility labels use slightly positive tracking and deliberate weight; body copy stays near neutral tracking. Headings use tighter leading and stronger weight rather than unnecessary size.

The existing 10px, 14px, and 20px continuous-curvature radius tokens remain the shape scale. Hit targets grow independently of glyph size. Icon buttons keep precisely centered drawn SVG paths and receive visible keyboard focus.

### Materials and Signature

The title bar, activity rail, docked-sidebar chrome, and responsive drawer may use a translucent material. Editor, terminal, lists, and reading surfaces remain opaque. Reduced-transparency mode removes blur and raises surface opacity.

The signature element is a subtle **focus ribbon**: the selected activity capsule and the leading edge of its docked sidebar share one restrained accent treatment. It makes ownership of the visible side view legible without adding decorative chrome elsewhere.

## Motion

Motion has three purposes in this workbench: spatial consistency, state indication, and preventing jarring layout changes.

- A pointer-opened responsive drawer uses opacity and horizontal transform for 220ms with `cubic-bezier(0.32, 0.72, 0, 1)`. It exits through the same activity-rail edge.
- High-frequency keyboard-triggered sidebar and panel toggles are immediate.
- Terminal maximize and restore use a FLIP-style transform from the panel’s current on-screen rectangle. The final layout is committed first, and the animation visually bridges the old and new geometry without animating width, height, or grid tracks.
- Small pressable controls respond on pointer-down in 100–160ms. Hover movement is not used; hover color transitions are gated to fine pointers.
- True modal dialogs materialize at center with backdrop opacity and `scale(0.96)` to `scale(1)` over 250ms.
- Rapid repeated pointer toggles retarget from the current visible state. Input is never disabled while a transition runs.

`prefers-reduced-motion` removes spatial movement and keeps short opacity/color feedback. Reduced-transparency and increased-contrast preferences remain independent. Large moving surfaces remain legible throughout their transition.

## State and Accessibility

A single renderer-side layout controller owns:

- active side view;
- sidebar open/closed state;
- docked versus overlay presentation;
- last docked sidebar width;
- panel maximized/restored state;
- the element that should regain focus after dismissal;
- synchronized activity-button `aria-pressed` and `aria-expanded` values.

The controller exposes state transitions and a change callback; it does not own view business logic. Desktop layout rendering consumes the controller state through semantic data attributes on the workbench. Commands and pointer controls call the same transition methods.

The sidebar is a labelled complementary region in docked mode and a non-modal labelled drawer in overlay mode. Escape closes only the overlay drawer or the currently open modal; it does not unexpectedly collapse a docked sidebar. Focus returns to the triggering activity button after an overlay dismissal and to the editor after closing the bottom panel.

True blocking dialogs retain native dialog semantics and focus containment. Side views do not use a modal role. Tooltips and visible labels use the same action names as their commands.

## Failure and Edge Handling

- Invalid restored sizes fall back to the existing defaults and are clamped to the current viewport.
- A breakpoint change during a drag ends in a valid overlay or docked state without losing the stored dock width.
- If a side view cannot refresh its data, it remains open and presents its existing actionable error or empty state; the shell does not close it.
- If WebGL or terminal fitting fails, the current xterm fallback behavior remains intact.
- Closing the last terminal affects the terminal session, not the existence of the bottom-panel controller or other panel tabs.
- Repeated maximize, restore, open, and close calls are idempotent.

## Verification

Pure unit tests cover layout-state transitions, invalid and narrow viewport sizes, repeated toggles, breakpoint changes, remembered width, and maximize/restore behavior. Existing layout-size tests remain authoritative for docked clamping.

DOM and smoke coverage verifies activity ARIA synchronization, overlay dismissal, focus restoration, panel maximize controls, editor visibility, terminal re-fitting, responsive split orientation, and reduced-motion behavior. Type checking, dependency-boundary checks, focused Vitest suites, and the desktop smoke test run before completion.

Visual review covers light, dark, Midnight, narrow overlay, docked sidebar, maximized terminal, multiple terminal splits, keyboard focus, reduced motion, reduced transparency, and increased contrast.

## Out of Scope

- Rewriting Monaco, xterm, or the terminal process lifecycle.
- Operating-system full-screen behavior.
- Drag-to-dismiss gestures for a desktop pointer workflow.
- Rearranging or user-configuring the order of activity icons.
- New earnings calculations, charts, or fabricated historical data.
- Replacing native blocking dialogs with a custom dialog library.
