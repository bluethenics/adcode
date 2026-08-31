# macOS Workbench Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a responsive VS Code-style workbench with docked side tools, a maximizable terminal panel, and restrained macOS visual and motion behavior.

**Architecture:** A pure workbench-layout state module defines sidebar and panel transitions. The renderer applies that state through semantic data attributes, while existing feature modules continue to own their content and data. Floating Structure, Earnings, Features, and Settings frames become embeddable sidebar views; the bottom panel remains mounted and gains maximize/restore behavior.

**Tech Stack:** TypeScript 5.9, Electron 43, DOM APIs, CSS Grid, Web Animations API, Monaco Editor, xterm 6, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-31-macos-workbench-layout-design.md`

## Global Constraints

- Do not add a UI or motion dependency.
- Keep Monaco, xterm, terminal PTYs, diagnostic bodies, and live subscriptions mounted across view changes.
- Use only `transform` and `opacity` for deliberate motion; layout changes themselves are immediate.
- Pointer-opened responsive drawers use 220ms `cubic-bezier(0.32, 0.72, 0, 1)` motion.
- Keyboard-triggered sidebar and panel toggles are immediate.
- Preserve `prefers-reduced-motion`, `prefers-reduced-transparency`, and increased-contrast behavior.
- Preserve existing uncommitted work in shared style files; edit around it and never replace whole files.
- Do not execute a task's commit step when it would stage a file that was already modified before this feature; leave that task uncommitted and report the preserved overlap at handoff.
- Problems remains an entry into the existing bottom-panel Problems tab.
- Terminal maximize does not enter operating-system full screen and does not hide the title bar, activity rail, sidebar, or status bar.

---

### Task 1: Pure workbench layout state

**Files:**
- Create: `apps/desktop/src/renderer/workbench/workbenchLayout.ts`
- Create: `apps/desktop/test/workbenchLayout.test.ts`

**Interfaces:**
- Produces: `SidebarViewId`, `SidebarMode`, `WorkbenchLayoutState`, `WorkbenchLayoutEvent`, `initialWorkbenchLayout()`, and `reduceWorkbenchLayout()`.
- Consumes: no DOM or renderer globals.

- [ ] **Step 1: Write the failing reducer tests**

```ts
import { describe, expect, it } from "vitest";
import {
  initialWorkbenchLayout,
  reduceWorkbenchLayout,
} from "../src/renderer/workbench/workbenchLayout.ts";

describe("workbench layout", () => {
  it("collapses an already-selected sidebar view", () => {
    const state = initialWorkbenchLayout(1200, "explorer");
    expect(reduceWorkbenchLayout(state, { type: "toggle-sidebar", view: "explorer" }).sidebarOpen)
      .toBe(false);
  });

  it("switches views and opens the sidebar", () => {
    const closed = { ...initialWorkbenchLayout(1200, "explorer"), sidebarOpen: false };
    expect(reduceWorkbenchLayout(closed, { type: "show-sidebar", view: "structure" }))
      .toMatchObject({ sidebarOpen: true, activeSidebarView: "structure" });
  });

  it("uses an overlay below the responsive breakpoint without losing selection", () => {
    const state = reduceWorkbenchLayout(initialWorkbenchLayout(1200, "earnings"), {
      type: "viewport",
      width: 760,
    });
    expect(state).toMatchObject({
      sidebarMode: "overlay",
      sidebarOpen: false,
      dockedSidebarOpen: true,
      activeSidebarView: "earnings",
    });
    expect(reduceWorkbenchLayout(state, { type: "viewport", width: 1200 }).sidebarOpen).toBe(true);
  });

  it("keeps panel maximization across panel close and reopen state", () => {
    const maximized = reduceWorkbenchLayout(initialWorkbenchLayout(1200), {
      type: "toggle-panel-maximized",
    });
    expect(maximized.panelMaximized).toBe(true);
    expect(reduceWorkbenchLayout(maximized, { type: "viewport", width: 800 }).panelMaximized)
      .toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `npm test -- apps/desktop/test/workbenchLayout.test.ts`

Expected: FAIL because `workbenchLayout.ts` does not exist.

- [ ] **Step 3: Implement the pure state reducer**

```ts
export const SIDEBAR_OVERLAY_BREAKPOINT = 820;

export type SidebarViewId =
  | "explorer"
  | "search"
  | "structure"
  | "scm"
  | "earnings"
  | "features"
  | "settings";

export type SidebarMode = "docked" | "overlay";

export interface WorkbenchLayoutState {
  readonly activeSidebarView: SidebarViewId;
  readonly sidebarOpen: boolean;
  readonly dockedSidebarOpen: boolean;
  readonly sidebarMode: SidebarMode;
  readonly panelMaximized: boolean;
}

export type WorkbenchLayoutEvent =
  | { readonly type: "show-sidebar"; readonly view: SidebarViewId }
  | { readonly type: "toggle-sidebar"; readonly view: SidebarViewId }
  | { readonly type: "close-sidebar" }
  | { readonly type: "viewport"; readonly width: number }
  | { readonly type: "toggle-panel-maximized" }
  | { readonly type: "restore-panel" };

const modeFor = (width: number): SidebarMode =>
  width < SIDEBAR_OVERLAY_BREAKPOINT ? "overlay" : "docked";

export function initialWorkbenchLayout(
  width: number,
  activeSidebarView: SidebarViewId = "explorer",
): WorkbenchLayoutState {
  const sidebarMode = modeFor(width);
  return {
    activeSidebarView,
    sidebarOpen: sidebarMode === "docked",
    dockedSidebarOpen: true,
    sidebarMode,
    panelMaximized: false,
  };
}

export function reduceWorkbenchLayout(
  state: WorkbenchLayoutState,
  event: WorkbenchLayoutEvent,
): WorkbenchLayoutState {
  switch (event.type) {
    case "show-sidebar":
      return {
        ...state,
        activeSidebarView: event.view,
        sidebarOpen: true,
        dockedSidebarOpen: state.sidebarMode === "docked" ? true : state.dockedSidebarOpen,
      };
    case "toggle-sidebar":
      if (state.sidebarOpen && state.activeSidebarView === event.view) {
        return {
          ...state,
          sidebarOpen: false,
          dockedSidebarOpen: state.sidebarMode === "docked" ? false : state.dockedSidebarOpen,
        };
      }
      return {
        ...state,
        activeSidebarView: event.view,
        sidebarOpen: true,
        dockedSidebarOpen: state.sidebarMode === "docked" ? true : state.dockedSidebarOpen,
      };
    case "close-sidebar":
      return {
        ...state,
        sidebarOpen: false,
        dockedSidebarOpen: state.sidebarMode === "docked" ? false : state.dockedSidebarOpen,
      };
    case "viewport": {
      const sidebarMode = modeFor(event.width);
      if (sidebarMode === state.sidebarMode) return state;
      return {
        ...state,
        sidebarMode,
        sidebarOpen: sidebarMode === "docked" ? state.dockedSidebarOpen : false,
      };
    }
    case "toggle-panel-maximized":
      return { ...state, panelMaximized: !state.panelMaximized };
    case "restore-panel":
      return { ...state, panelMaximized: false };
  }
}
```

- [ ] **Step 4: Run the focused test**

Run: `npm test -- apps/desktop/test/workbenchLayout.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the state module**

```bash
git add apps/desktop/src/renderer/workbench/workbenchLayout.ts apps/desktop/test/workbenchLayout.test.ts
git commit -m "feat(workbench): model responsive layout state"
```

---

### Task 2: Shared sidebar shell and remembered selection

**Files:**
- Modify: `apps/desktop/src/renderer/index.html`
- Modify: `apps/desktop/src/renderer/main.ts`
- Modify: `apps/desktop/src/renderer/styles/workbench.css`
- Modify: `apps/desktop/src/renderer/styles/tokens.css`
- Modify: `apps/desktop/src/shared/api.ts`
- Modify: `apps/desktop/src/main/sessionStore.ts`
- Modify: `apps/desktop/test/sessionStore.test.ts`

**Interfaces:**
- Consumes: `SidebarViewId`, `initialWorkbenchLayout()`, and `reduceWorkbenchLayout()` from Task 1.
- Produces: one sidebar frame with `data-sidebar-view` content nodes, `showSidebarView(view, input)`, `toggleSidebarView(view, input)`, and optional `layout.sidebarView` session persistence.

- [ ] **Step 1: Add failing session compatibility tests**

Add these cases to the existing `describe("layout")` suite:

```ts
it("round-trips the last valid sidebar view", async () => {
  await store.save({
    root: null,
    openFiles: [],
    activeFile: null,
    layout: { sidebarWidth: 320, panelHeight: 400, sidebarView: "structure" },
  });

  expect((await store.load()).layout).toEqual({
    sidebarWidth: 320,
    panelHeight: 400,
    sidebarView: "structure",
  });
});

it("drops an unknown sidebar view but keeps valid sizes", async () => {
  await writeFile(
    join(dir, "session.json"),
    JSON.stringify({
      state: {
        root: null,
        openFiles: [],
        activeFile: null,
        layout: { sidebarWidth: 320, panelHeight: 400, sidebarView: "mystery" },
      },
    }),
    "utf8",
  );

  expect((await store.load()).layout).toEqual({ sidebarWidth: 320, panelHeight: 400 });
});
```

- [ ] **Step 2: Run the session test and verify failure**

Run: `npm test -- apps/desktop/test/sessionStore.test.ts`

Expected: FAIL because the current session layout drops `sidebarView`.

- [ ] **Step 3: Extend the backward-compatible session layout**

Add the same optional union to `SessionLayout` and `LayoutView`:

```ts
export type SidebarViewView =
  | "explorer"
  | "search"
  | "structure"
  | "scm"
  | "earnings"
  | "features"
  | "settings";

readonly sidebarView?: SidebarViewView;
```

Validate it with a fixed `Set<SidebarViewView>`, retain valid sizes when the optional view is unknown, and continue accepting sessions written before the field existed.

- [ ] **Step 4: Build the semantic sidebar frame**

In `index.html`, replace the single-purpose header with a shared heading and close control while preserving the Explorer root actions:

```html
<header class="sidebar-header">
  <span class="sidebar-focus-ribbon" aria-hidden="true"></span>
  <div class="sidebar-heading">
    <span class="sidebar-title" id="sidebar-title">Explorer</span>
    <span class="sidebar-subtitle" id="sidebar-subtitle">No folder opened</span>
  </div>
  <div class="sidebar-actions" id="sidebar-actions-explorer">…existing root actions…</div>
  <button class="icon-button sidebar-close" id="sidebar-close" title="Close side bar" aria-label="Close side bar">…close path…</button>
</header>
<div class="sidebar-content" id="sidebar-content">
  <nav class="filetree sidebar-view" id="filetree" data-sidebar-view="explorer" aria-label="Files">…</nav>
  <div class="sidebar-view" id="view-search" data-sidebar-view="search" hidden></div>
  <div class="sidebar-view" id="view-structure" data-sidebar-view="structure" hidden></div>
  <div class="sidebar-view" id="view-scm" data-sidebar-view="scm" hidden></div>
  <div class="sidebar-view" id="view-earnings" data-sidebar-view="earnings" hidden></div>
  <div class="sidebar-view" id="view-features" data-sidebar-view="features" hidden></div>
  <div class="sidebar-view" id="view-settings" data-sidebar-view="settings" hidden></div>
</div>
<button class="sidebar-scrim" id="sidebar-scrim" type="button" aria-label="Close side bar" tabindex="-1"></button>
```

Give every sidebar activity button a `data-sidebar-view` value and use `aria-pressed`; leave Problems mapped to the bottom panel.

- [ ] **Step 5: Wire state rendering and responsive dismissal in `main.ts`**

Maintain one `layoutState`, dispatch reducer events, and render:

```ts
function renderWorkbenchLayout(input: "pointer" | "keyboard" = "keyboard"): void {
  const workbench = el("workbench");
  const sidebar = el("sidebar");
  workbench.dataset["sidebarOpen"] = String(layoutState.sidebarOpen);
  workbench.dataset["sidebarMode"] = layoutState.sidebarMode;
  workbench.dataset["layoutInput"] = input;
  sidebar.inert = !layoutState.sidebarOpen;
  sidebar.setAttribute("aria-hidden", String(!layoutState.sidebarOpen));

  for (const view of document.querySelectorAll<HTMLElement>("[data-sidebar-view]")) {
    if (!view.classList.contains("activity")) {
      view.hidden = !layoutState.sidebarOpen || view.dataset["sidebarView"] !== layoutState.activeSidebarView;
    }
  }

  for (const activity of document.querySelectorAll<HTMLButtonElement>(".activity[data-sidebar-view]")) {
    const selected = layoutState.sidebarOpen && activity.dataset["sidebarView"] === layoutState.activeSidebarView;
    activity.setAttribute("aria-pressed", String(selected));
    activity.setAttribute("aria-expanded", String(selected));
  }

  editorHost.layout();
  terminal?.fit();
}
```

Use `showSidebarView()` for commands, `toggleSidebarView()` for pointer activity buttons, close on `sidebar-close`, overlay scrim, and overlay Escape, and update the state from `window.resize`. Restore `layout.sidebarView` before the first render and save it in `rememberSession()`.

- [ ] **Step 6: Add docked and overlay CSS without animating grid tracks**

Keep the desktop grid immediate. At widths below 820px, remove the sidebar and splitter tracks, absolutely position the sidebar after the 48px activity rail, and transition only `transform` and `opacity` for pointer input. Add solid reduced-transparency and stronger increased-contrast fallbacks. Use `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` and the existing `--ease-sheet` token rather than inventing another curve.

- [ ] **Step 7: Run session, layout, and type checks**

Run: `npm test -- apps/desktop/test/sessionStore.test.ts apps/desktop/test/layoutSizes.test.ts apps/desktop/test/workbenchLayout.test.ts`

Run: `npm run typecheck`

Expected: all commands PASS.

- [ ] **Step 8: Commit the sidebar shell**

```bash
git add apps/desktop/src/renderer/index.html apps/desktop/src/renderer/main.ts apps/desktop/src/renderer/styles/workbench.css apps/desktop/src/renderer/styles/tokens.css apps/desktop/src/shared/api.ts apps/desktop/src/main/sessionStore.ts apps/desktop/test/sessionStore.test.ts
git commit -m "feat(workbench): add responsive sidebar shell"
```

---

### Task 3: Convert side-icon popups into docked content

**Files:**
- Modify: `apps/desktop/src/renderer/panels/structurePopup.ts`
- Modify: `apps/desktop/src/renderer/panels/earningsPopover.ts`
- Modify: `apps/desktop/src/renderer/features/featureLibrary.ts`
- Modify: `apps/desktop/src/renderer/settings/settingsView.ts`
- Modify: `apps/desktop/src/renderer/main.ts`
- Modify: `apps/desktop/src/renderer/styles/popups.css`
- Modify: `apps/desktop/src/renderer/styles/panels.css`
- Modify: `apps/desktop/src/renderer/styles/features.css`
- Modify: `apps/desktop/src/renderer/styles/settings.css`
- Modify: `scripts/smoke.mjs`
- Test: `apps/desktop/test/featureLibraryModel.test.ts`

**Interfaces:**
- Consumes: sidebar content hosts and `showSidebarView()` from Task 2.
- Produces: passive, embeddable Structure, Earnings, Features, and Settings view roots whose `open()`/`close()` methods change content state without creating modal layers.

- [ ] **Step 1: Add failing smoke behavior for docked, non-modal side tools**

Add raw-CDP checks that operate the real activity buttons and observe the real rendered surfaces:

```js
for (const [buttonId, viewId] of [
  ['open-structure', 'view-structure'],
  ['open-earnings', 'view-earnings'],
  ['open-features', 'view-features'],
  ['open-settings', 'view-settings'],
]) {
  await evaluate(`document.getElementById('${buttonId}')?.click(); true`);
  await sleep(220);
  checks[`docked_${viewId}`] = await evaluate(
    `(() => {
       const workbench = document.getElementById('workbench');
       const view = document.getElementById('${viewId}');
       const modal = view?.querySelector('[aria-modal="true"], dialog[open]');
       return workbench?.dataset.sidebarOpen === 'true' && view?.hidden === false && modal === null;
     })()`,
  );
}
```

Run: `npm run smoke`

Expected: FAIL because the new sidebar view hosts and state attributes do not exist yet.

- [ ] **Step 2: Make Structure an embeddable two-tab view**

Keep the existing exported API to minimize call-site churn, but replace the native `<dialog>` frame with a `<section class="structure-view">` appended to `#view-structure`. `open(tab)` unhides it and refreshes the chosen tab; `close()` hides it; `toggle()` changes only its local visibility. Remove backdrop, modal focus-trap, and global Escape handling because the sidebar shell now owns dismissal. Keep ArrowLeft/ArrowRight tab behavior and both existing panel instances.

- [ ] **Step 3: Make Earnings an embeddable live summary**

Mount `.earnings-card` in `#view-earnings`, remove viewport placement and resize listeners, and keep `update(snapshot)` rendering even while hidden. The close control calls the sidebar close callback supplied by dependencies. Retain all server-value safeguards and account/settings actions.

- [ ] **Step 4: Make Features an embeddable searchable library**

Change the root role to `region`, remove anchored placement, and mount it in `#view-features`. Keep the category listbox, keyboard selection, help popover, and feature-action model unchanged. `open()` refreshes filters and focuses search; `close()` closes the local filter/help popovers before hiding.

- [ ] **Step 5: Make Settings sidebar-native**

Mount `.settings-sheet` in `#view-settings` as a labelled region without `aria-modal`. Remove the backdrop click path and delayed sheet hiding. Preserve async reads, grouped settings, reset, search, help popover, and `openAt()` behavior. Replace the fixed 720px sheet layout with a single-column sidebar layout; stack row controls below labels when the sidebar is under 320px.

- [ ] **Step 6: Route all openers through the shell**

Update activity clicks and commands so Structure, Earnings, Features, and Settings first select their sidebar view, then call the view’s refresh/focus method. Replace direct `settingsView.openAt(id)` calls with:

```ts
function openSetting(settingId: string): void {
  showSidebarView("settings", "keyboard");
  settingsView.openAt(settingId);
}
```

When a project-map row opens a file, close only an overlay sidebar; leave a docked sidebar visible.

- [ ] **Step 7: Restyle the views for the shared macOS sidebar**

Remove fixed positioning, floating shadows, modal backdrops, and outer glass from the four docked roots. Keep content surfaces opaque, headers compact, actions beside their targets, and inner list radii from existing tokens. Add narrow Structure relation stacking and wrapping Feature actions. Preserve reduced-transparency rules for any remaining help/filter popovers.

- [ ] **Step 8: Run feature tests, smoke behavior, and type checking**

Run: `npm test -- apps/desktop/test/featureLibraryModel.test.ts apps/desktop/test/workbenchLayout.test.ts`

Run: `npm run smoke`

Run: `npm run typecheck`

Expected: all commands PASS.

- [ ] **Step 9: Commit the docked views**

```bash
git add apps/desktop/src/renderer/panels/structurePopup.ts apps/desktop/src/renderer/panels/earningsPopover.ts apps/desktop/src/renderer/features/featureLibrary.ts apps/desktop/src/renderer/settings/settingsView.ts apps/desktop/src/renderer/main.ts apps/desktop/src/renderer/styles/popups.css apps/desktop/src/renderer/styles/panels.css apps/desktop/src/renderer/styles/features.css apps/desktop/src/renderer/styles/settings.css scripts/smoke.mjs
git commit -m "feat(workbench): dock activity tool views"
```

---

### Task 4: Maximize the bottom panel and adapt terminal geometry

**Files:**
- Modify: `apps/desktop/src/renderer/index.html`
- Modify: `apps/desktop/src/renderer/main.ts`
- Modify: `apps/desktop/src/renderer/motion.ts`
- Modify: `apps/desktop/src/renderer/workbench/icons.ts`
- Modify: `apps/desktop/src/renderer/styles/workbench.css`
- Modify: `apps/desktop/src/renderer/styles/panels.css`
- Modify: `apps/desktop/src/renderer/terminal/terminalPanel.ts`
- Modify: `apps/desktop/src/renderer/panels/bottomPanel.ts`
- Test: `apps/desktop/test/workbenchLayout.test.ts`
- Test: `apps/desktop/test/terminalTitles.test.ts`

**Interfaces:**
- Consumes: `panelMaximized` reducer state from Task 1 and the shared render cycle from Task 2.
- Produces: `togglePanelMaximized(input)`, a labelled maximize/restore button, `animateLayoutFlip()`, and responsive terminal split/tab presentation.

- [ ] **Step 1: Add reducer idempotence coverage**

```ts
it("restores a maximized panel idempotently", () => {
  const maximized = reduceWorkbenchLayout(initialWorkbenchLayout(1200), {
    type: "toggle-panel-maximized",
  });
  const restored = reduceWorkbenchLayout(maximized, { type: "restore-panel" });
  expect(restored.panelMaximized).toBe(false);
  expect(reduceWorkbenchLayout(restored, { type: "restore-panel" })).toEqual(restored);
});
```

Run: `npm test -- apps/desktop/test/workbenchLayout.test.ts`

Expected: PASS once the Task 1 reducer is in place; this locks the close/restore contract before DOM work.

- [ ] **Step 2: Add centered maximize and restore icons**

Add symmetric 16×16 `panelMaximize` and `panelRestore` paths to `ICON`. Add `#panel-maximize` immediately before `#panel-close`, with `aria-pressed="false"`, tooltip “Maximize panel”, and a drawn SVG path.

- [ ] **Step 3: Implement interruptible FLIP motion**

Extend `motion.ts` with:

```ts
const FLIP_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
let layoutAnimation: Animation | null = null;

export function animateLayoutFlip(
  element: HTMLElement,
  before: DOMRect,
  after: DOMRect,
  reduceMotion: boolean,
): void {
  layoutAnimation?.cancel();
  if (reduceMotion || before.width === 0 || before.height === 0 || after.width === 0 || after.height === 0) {
    element.animate([{ opacity: 0.82 }, { opacity: 1 }], { duration: 100, easing: "ease", fill: "both" });
    return;
  }

  const dx = before.left - after.left;
  const dy = before.top - after.top;
  const sx = before.width / after.width;
  const sy = before.height / after.height;
  layoutAnimation = element.animate(
    [
      { transformOrigin: "left top", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.88 },
      { transformOrigin: "left top", transform: "translate(0, 0) scale(1, 1)", opacity: 1 },
    ],
    { duration: 220, easing: FLIP_EASING },
  );
}
```

- [ ] **Step 4: Apply maximized geometry and restore semantics**

On pointer activation, capture the panel rectangle, dispatch `toggle-panel-maximized`, render the final layout, capture the new rectangle, then call `animateLayoutFlip()`. Keyboard commands skip spatial animation. Render `main.dataset.panelMaximized` only while the bottom panel is open, update button label/icon/`aria-pressed`, hide the editor splitter while maximized, and call both `editorHost.layout()` and `terminal.fit()` after animation setup.

- [ ] **Step 5: Add responsive terminal presentation**

Use a container query or panel-width media query to stack `.terminal-pane` children vertically when a useful side-by-side width cannot be maintained. Convert `.terminal-tabs` from a right rail into a horizontally scrollable strip in the same narrow condition. Preserve the agent strip across both tracks and keep every terminal body mounted.

- [ ] **Step 6: Verify focused behavior**

Run: `npm test -- apps/desktop/test/workbenchLayout.test.ts apps/desktop/test/terminalTitles.test.ts apps/desktop/test/layoutSizes.test.ts`

Run: `npm run typecheck`

Expected: all commands PASS.

- [ ] **Step 7: Commit terminal layout behavior**

```bash
git add apps/desktop/src/renderer/index.html apps/desktop/src/renderer/main.ts apps/desktop/src/renderer/motion.ts apps/desktop/src/renderer/workbench/icons.ts apps/desktop/src/renderer/styles/workbench.css apps/desktop/src/renderer/styles/panels.css apps/desktop/src/renderer/terminal/terminalPanel.ts apps/desktop/src/renderer/panels/bottomPanel.ts apps/desktop/test/workbenchLayout.test.ts
git commit -m "feat(terminal): add responsive panel maximize"
```

---

### Task 5: Apple-style polish, accessibility, and full verification

**Files:**
- Modify: `apps/desktop/src/renderer/styles/tokens.css`
- Modify: `apps/desktop/src/renderer/styles/workbench.css`
- Modify: `apps/desktop/src/renderer/styles/panels.css`
- Modify: `apps/desktop/src/renderer/styles/popups.css`
- Modify: `apps/desktop/src/renderer/styles/features.css`
- Modify: `apps/desktop/src/renderer/styles/settings.css`
- Modify: `apps/desktop/src/renderer/main.ts`
- Modify: `scripts/smoke.mjs`

**Interfaces:**
- Consumes: all preceding behavior and DOM state.
- Produces: final macOS material hierarchy, focus ribbon, pointer gating, reduced-motion/transparency/contrast variants, and smoke assertions.

- [ ] **Step 1: Add smoke assertions before final styling**

Extend the existing raw-CDP `checks` object and `evaluate()` flow with:

```js
await evaluate("document.getElementById('panel-maximize')?.click(); true");
await sleep(250);
checks.panelMaximizes = await evaluate(
  "document.querySelector('.main')?.dataset.panelMaximized === 'true' && document.getElementById('editor-area')?.hidden === true && document.getElementById('activitybar') !== null",
);

await evaluate("document.getElementById('panel-maximize')?.click(); true");
await sleep(250);
checks.panelRestores = await evaluate(
  "document.querySelector('.main')?.dataset.panelMaximized === 'false' && document.getElementById('editor-area')?.hidden === false",
);
```

- [ ] **Step 2: Run smoke and confirm the new assertions expose missing polish or behavior**

Run: `npm run smoke`

Expected before finishing: both new booleans are `true`; a `false` value is fixed before proceeding.

- [ ] **Step 3: Finish the visual hierarchy**

Add the focus ribbon, selected capsule, shared sidebar heading/subtitle, solid reading surfaces, quieter terminal background, grouped panel actions, precise focus rings, tabular terminal/session labels, and fine-pointer-only hover styles. Keep the existing semantic Apple palette and SF system stacks. Do not introduce gradients, decorative ambient animation, or stacked glass.

- [ ] **Step 4: Complete accessibility variants**

For reduced motion, replace drawer and FLIP movement with a 100ms fade. For reduced transparency, remove blur and use opaque chrome tokens. For increased contrast, strengthen borders and focus rings. Verify overlay Escape and scrim dismissal restore focus to the triggering activity button and that the docked sidebar does not close on Escape.

- [ ] **Step 5: Run the full verification matrix**

Run: `npm run typecheck`

Run: `npm run firewall`

Run: `npm test`

Run: `npm run smoke`

Run: `npm --prefix apps/desktop run build`

Expected: every command exits 0.

- [ ] **Step 6: Inspect the final diff and working tree**

Run: `git diff --check`

Run: `git status --short`

Confirm the diff contains only this feature plus the user’s pre-existing modifications, no generated build output, and no overwritten unrelated edits.

- [ ] **Step 7: Commit the verified polish**

```bash
git add apps/desktop/src/renderer/styles/tokens.css apps/desktop/src/renderer/styles/workbench.css apps/desktop/src/renderer/styles/panels.css apps/desktop/src/renderer/styles/popups.css apps/desktop/src/renderer/styles/features.css apps/desktop/src/renderer/styles/settings.css apps/desktop/src/renderer/main.ts scripts/smoke.mjs
git commit -m "feat(workbench): polish macOS panel interactions"
```
