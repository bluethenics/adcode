# Desktop interface improvements

The desktop uses a clean, spacious layout with consistent control heights, panel padding, and quieter surfaces across the editor, terminals, assistant, settings, feature library, source control, and popups. Light, dark, midnight, and compact density remain supported.

The workspace is now flush with the window: the sidebar, editor groups, and terminals have no rounded outer frames or decorative side stripes. File tabs use a simple underline for selection. Settings, features, and assistant capabilities use separated rows instead of nested cards. Floating dialogs retain a restrained edge and shadow so their boundaries remain clear.

Transitions are short and subtle. Reduced-motion preferences disable the new effects. Editor dimensions and scrolling do not animate during resizing. Narrow assistant windows show one side panel at a time so history and the inspector cannot cover the conversation simultaneously.

## Responsiveness

- Streamed assistant text accumulates immediately and renders at most once per animation frame. Completion flushes pending text even when chat is closed. A real Electron test delivered 100 provider deltas in two DOM replacements with the full answer retained.
- Editor layout, terminal fitting, and workbench splitter updates coalesce into frames. A timer fallback handles occluded windows.
- Duplicate editor resize observation was removed. Model polling skips hidden windows and runs less often; settings changes update the selected model immediately.
- Large popup and chrome surfaces no longer blur the live editor beneath them.

These changes reduce unnecessary rendering work; they are not a universal frame-rate guarantee.

## Installed skills

Open **Assistant → Tools & skills → Skills** and select **System skills** to inspect skills discovered in known installation folders. Source badges distinguish project, Adcode, Claude, and Codex skills. See [assistant controls](assistant-controls.md) for locations, activation, and supported formats.

## Verification

The desktop and AI suite passed 1,236 tests, alongside TypeScript and dependency checks. Built Electron checks cover keyboard editing, shared undo, split resizing, terminal geometry, themes, narrow layouts, popup interactions, local provider setup, Team traces, streaming, and installed skill discovery. The smoke harness uses an isolated profile and a local fake model endpoint.

Screenshots and logs from verification are generated under `artifacts/`, including `artifacts/editor-workspace/`.
