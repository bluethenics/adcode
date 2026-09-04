# Task 8 report: Help, Shortcuts, Motion, and Accessibility Polish

## RED evidence

- Added focused contracts for pointer/keyboard/reduced-motion disclosure, generated dialog labels, task-focused initial focus, contrast and transparency preferences, boxed Help/Shortcuts material, named close controls, Settings row-help top-layer behavior, Help-to-Settings lifecycle routing, narrow Source Control setup accessibility, and the required runtime close-control audit.
- The initial focused run failed 9 assertions across the new shell, dialog accessibility, Settings lifecycle, and Source Control contracts before the production changes were applied.
- Follow-up focused RED runs caught the missing task initial-focus wiring, application-level reduced-motion setting, and the Structure close-control hit target before each implementation was added.

## GREEN implementation

- The shared popup shell now generates `aria-labelledby` title IDs, accepts an explicit task `initialFocus`, and uses interruptible Web Animations for pointer disclosure and dismissal. Pointer opening is source-relative and uses opacity/scale/translate without layout animation; keyboard opening settles immediately; reduced motion is opacity-only at 100 ms. Replacing a coordinated primary popup closes the previous layer immediately so only one primary dialog remains active.
- Shared popup styling now honors reduced transparency and increased contrast. Shell animations are cancelable and dismissal starts from the current computed presentation before calling `dialog.close()`.
- Settings, Features, Source Control, Chat, and Connect route focus to their task input. Settings reveals a pending Help target before and after its asynchronous render lifecycle.
- Help Guide and Keyboard Shortcuts keep their native dialog lifecycles while using complete 16 px boxed materials, viewport-safe insets, named visible close controls, and focus restoration. Help Guide setting actions now identify the exact Settings row.
- Settings row help uses a manual browser popover so it is in the top layer above Settings; Escape and outside interaction dismiss that dependent layer first and return focus to its anchor.
- Source Control drawer state is now repository-aware. At narrow desktop widths, inactive/setup guidance stays expanded, non-inert, and reachable instead of being parked in a hidden changes drawer.
- `scripts/smoke.mjs` now performs the binding 680 px runtime close audit for Structure, Earnings, Source Control, All Features, Settings, Assistant, Connect a model, ADCode Guide, and Keyboard Shortcuts. It checks naming, geometry, viewport containment, practical hit size, keyboard focusability, intended-layer dismissal, and focus restoration. Earnings is included as an explicit regression case. The Help jump, Settings help layering/Escape, and narrow Source Control setup facts are also covered while retaining Task 7's bounded chat, responsive, and seeded-history checks.

## Ownership expansion

- `apps/desktop/src/renderer/panels/structurePopup.ts` was changed only to give Structure a task-specific accessible close name.
- `apps/desktop/src/renderer/styles/popups.css` was changed because the existing Structure and Keyboard Shortcuts close/material rules live there; the brief's `styles/dialogs.css` does not own those selectors. No unrelated styling was reformatted.
- Added `apps/desktop/test/dialogAccessibilityMarkup.test.ts` as the narrowly scoped dialog audit contract permitted by the controller addendum.

## Verification

- `npm test -- popupShellMarkup menuKeyboard keybindings settingsViewLifecycle sourceControlWorkspaceMarkup dialogAccessibilityMarkup`: PASS, 7 files and 84 tests.
- `node --check scripts/smoke.mjs`: PASS.
- `git diff --check`: PASS.
- `npx tsc --noEmit -p apps/desktop/tsconfig.json`: the Task 8 Source Control launcher narrowing error was corrected; the command remains non-green because of pre-existing repository errors involving `ImportMeta.dirname`, Node/browser timer types, `HTMLButtonElement.ariaControls`, and existing test event casts.
- `npm run desktop:build`: main build PASS (858 modules, 13.29 s) and preload build PASS (2 modules, 344 ms). The renderer transformed all 1,477 modules with only the existing Vite externalization warnings, but the wrapper did not return a completion result within the bounded attempt, so renderer build status is inconclusive.
- Full Electron smoke was intentionally not run; the controller owns the authoritative smoke execution.
