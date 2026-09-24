# ADCode Vibe / Code upgrade

The current working tree, including prior uncommitted improvements, is the baseline.
Modes change presentation, never workspace ownership. Monaco models, the chat widget,
IPC subscriptions, terminal processes and preview remain mounted. Existing commands
and settings remain the source of truth.

## Capability preservation map

| Existing capability | Upgraded location / treatment | Verification |
| --- | --- | --- |
| Explorer, CRUD, drag/drop, file icons, recent folders | Code sidebar; Files and Search commands reveal Code from Vibe | Desktop smoke + file tests |
| Monaco, tabs, editor groups, breadcrumbs, selections, dirty buffers | Code center; retained while Vibe is visible | Editor smoke + mode identity checks |
| Search, symbols, references, command centre, palette | Existing sidebar / command centre / menus | Search + command coverage tests |
| Formatting, completion, LSP, diagnostics, spellcheck, structure, local history | Same editor services and commands | Existing editor, structure, LSP tests |
| Assistant, saved sessions, attachments, models, skills, MCP, voice | One widget in Vibe center or optional Code dock; History opens inside chat | AI smoke + chat tests + mode draft check |
| Isolated tasks, per-hunk review, rollback, operational trace | Context Tasks + existing live review; persisted task details | AI workspace tests + context smoke |
| Agent library, Teams, schedules, terminal agents | Task actions and existing inspector / command registry | AI team, automation, terminal tests |
| Real terminals, profiles, splits, scrollback, process lifetime | Same bottom panel across modes | Real terminal smoke + identity check |
| Problems, Output, Debug Console, Ports | Same bottom panel and shortcuts | Desktop smoke + panel tests |
| Git staging, commit, push/pull, remotes, branches, conflicts, history | Existing Source Control; context Changes links to it | Git tests + SCM smoke |
| Live preview, device sizes, inspector, floating placement, Run | Same preview instance alongside either mode | Preview smoke + device tests |
| Debugger and breakpoints | Existing Run & Debug commands / panels | Debug tests + desktop smoke |
| Collaboration, shared memory, remote cursors | Existing Share and terminal integrations | Collaboration + smoke tests |
| Earnings, ledger, sponsorship frequency, account, withdrawals | Existing earnings surface through More tools and account controls | Ads / ledger tests + earnings smoke |
| Settings, themes, density, reduced motion, shortcuts | Existing sheets; warm light default for new installs | Theme + settings + keybinding tests |
| Dialogs, help, notifications, updates, feedback, feature library | Preserved launchers, with contextual mode help | Popup + accessibility smoke |
| Resizing, splitters, sidebar overlay, panel maximize | Mode-aware layout over existing controls | Responsive desktop checks |

No separate deployment service was found in the desktop shell. Existing GitHub,
preview, terminal and command workflows remain available; no simulated Deploy action
is introduced. Earnings continue to use the actual ledger; no income is fabricated.

Verification entries above identify required checks, not claims of passing results.
Final results are recorded after running them.

## Product layout

Following the requested simplification, Vibe focuses on the conversation without a
workspace navigation list or file explorer. Code opens with its file sidebar and editor;
assistant panels and conversation history do not occupy space by default. History opens
inside the shared chat. The toolbar keeps the mode switch, project, search, Preview,
optional Vibe Context and one More tools menu. Secondary commands remain available there
and through existing menus, shortcuts and editor context actions. Project context reads
real Git, task and AI state. Switching modes closes secondary context and the Code
assistant without resetting the conversation, files, terminal or preview.

The mode switch reparents one assistant widget. Opening a file reveals Code; selecting
Ask AI adds the current unsaved buffer or selection to the existing draft. New project
commands are registered in the same command registry. Earnings links open the existing
ledger and account workflow.

## Original upgrade verification (before layout simplification)

- Full regression suite: **247 test files, 3,183 tests passed**.
- TypeScript checks passed for the root, desktop and web projects. Desktop production
  build passed. Dependency firewall reported zero errors (68 existing warnings).
- Additional interface checks after reference-layout changes: **45 tests passed**,
  including real Chromium MCP/skill controls.
- Built Electron editor checks passed: focused typing and saving in split editors,
  shared buffers and undo, dirty-model behavior, split resizing, terminal splits,
  theme changes and narrow windows. Monaco's experimental EditContext input path was
  disabled after this test exposed typing going to the wrong split editor.
- Built Electron mode checks passed: navigation, shared live widget/editor/terminal
  identities, unsent drafts, unsaved buffers, selection-to-AI draft, terminal maximize,
  context tabs, file navigation, preview identity, contextual help, three themes and
  window widths of 1440, 1100, 820 and 640 pixels.
- Built Electron AI checks passed using a local test inference endpoint with the real
  renderer, IPC and provider pipeline: model connection and persistence, saved agents,
  dependent Team handoff and tool traces, streaming during mode switches, saved task
  review, and two real sandbox proposals through Apply all into project files.
- Built Electron popup checks passed: Earnings, Structure, Source Control, settings,
  feature library, nested results, popup switching and resize behavior.
- First-use onboarding checks passed: both mode choices, skipping onboarding,
  persisted completion and independently dismissible mode hints.
- Design-system checks passed: switches, radios, sliders, keyboard tabs, dialogs,
  dismissal/restoration, focus indicators, dark controls and narrow layouts, with
  no console errors or horizontal overflow.
- Focused editor intelligence checks passed: enabling the optional inline lens displays
  actual TypeScript diagnostics; keyboard Peek Definition displays the real declaration
  and identifies its source. The default preference remains respected.
- Direct checks of the labeled navigation and context Source Control link passed, as
  did a real pointer drag of the sidebar splitter.
- Final rebuilt-app checks passed again after the context resize fix: Vibe/Code,
  separate context and assistant widths, context drag and reset, AI review/apply,
  active streams across modes, editor intelligence and onboarding. Context starts
  compact and can be widened; its saved width does not overwrite the Code assistant.
- Full built-app smoke suite passed with **zero failed checks and zero suspicious runtime
  log lines**. It covers file CRUD, tabs, search and commands, diagnostics, definition
  navigation, templates, tag closing, structure, Git, real terminals, preview, keyboard
  controls, layout resizing, settings/themes, saved chat and dialog focus/layering.
  The harness now targets the current editor geometry, explicitly enables optional
  features it tests, and respects compact chat's single-secondary-panel behavior.

The existing logic suites cover debugging, diagnostics/LSP, collaboration, tasks and
automation, Git operations, account/ledger, settings and keybindings. These checks do
not constitute live paid-provider, payout, deployment or remote-collaborator testing.
Screenshots are generated under `artifacts/editor-workspace/`.

## Minimal layout verification (23 September 2026)

- Desktop production build and root, desktop and web TypeScript checks passed.
- Mode runtime checks passed: Vibe has no explorer or duplicate workspace navigation;
  Code starts without assistant chrome; Files and Search reveal Code; history opens
  inside chat. Unsent drafts, unsaved buffers, terminal and preview retain identity.
- Real pointer splitter resizing, terminal maximize, context tabs, Source Control
  navigation, keyboard tools-menu navigation and Escape focus restoration passed.
  Both modes remain usable at 1440, 1100, 820 and 640 pixels across retained themes.
- AI runtime checks passed through the actual renderer and IPC using a local test
  model: on-demand menu access, saved history, expanded-chat focus restoration,
  saved agents, Team traces, MCP controls, live streaming across modes and persistent
  task review. Apply all writes two actual proposed files; proposals leave originals
  unchanged until reviewed.
- Focused checks passed in two runs: 64 chat/layout/keybinding tests, then 51
  menu/popup/chat/documentation tests (some overlap). Generated documentation is current.

The tools menu no longer dismisses when the chat input scrolls. Closing expanded AI
returns focus to the visible tools launcher. No project services were replaced.
