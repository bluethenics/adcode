# Pop-up Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace cramped utility side panels with a coherent hierarchy of macOS-style pop-ups, give Source Control and AI Chat full workspace dialogs, and render the remaining workbench panels as complete rounded boxes.

**Architecture:** A workbench-owned pop-up layer coordinator controls disclosure, nesting, focus, Escape, launcher state, and responsive size. Existing feature modules continue to own their data and actions, but mount their content into shared shells instead of positioning or dismissing themselves. Source Control and Chat receive internal multi-region layouts while Explorer, Search, Problems, and Terminal retain their existing state models inside newly boxed structural surfaces.

**Tech Stack:** TypeScript 5.9, Electron, DOM APIs, native `<dialog>`, CSS Grid/container queries, Web Animations API, Vitest 4, Electron CDP smoke tests

**Spec:** `docs/superpowers/specs/2026-09-01-popup-workbench-design.md`

## Global Constraints

- The shipped package version remains exactly `1.0.0`.
- Only one primary pop-up may be open; one dependent pop-up may layer above it.
- Structure and Earnings are anchored non-modal pop-ups with no scrim.
- Source Control and AI Chat are near-full-screen workspace dialogs.
- All Features is large; Settings and Connect Model are medium-to-large dialogs.
- Explorer, Search, Problems, and Terminal retain their current behavior and become complete rounded boxes.
- Pointer motion is 220ms with `cubic-bezier(.32,.72,0,1)`; keyboard disclosure has no spatial travel.
- Reduced motion uses a 100ms opacity cross-fade; reduced transparency removes blur and uses opaque elevated surfaces.
- Escape closes one layer at a time and focus returns to the owning launcher or parent dialog.
- No Git, AI provider, credential, billing, session, updater, backend, or IPC contract changes.
- Preserve unrelated dirty web, documentation, advertising, and help-source changes.
- Do not deploy the dirty web working tree; downloads update through the existing GitHub release channel.

---

## File Structure

### New files

- `apps/desktop/src/renderer/workbench/popupLayer.ts`: pure primary/dependent disclosure state.
- `apps/desktop/src/renderer/workbench/popupShell.ts`: DOM shell, focus lifecycle, dialog modality, anchoring, and motion.
- `apps/desktop/src/renderer/styles/popupShell.css`: shared material, size, responsive, and accessibility styling.
- `apps/desktop/test/popupLayer.test.ts`: pure state transitions.
- `apps/desktop/test/popupShellMarkup.test.ts`: shell accessibility and lifecycle contract.
- `apps/desktop/test/sourceControlWorkspaceMarkup.test.ts`: Source Control region contract.
- `apps/desktop/test/chatWorkspaceMarkup.test.ts`: Chat region contract.

### Existing files with changed responsibilities

- `apps/desktop/src/renderer/main.ts`: creates the coordinator/shells and routes activity/menu commands.
- `apps/desktop/src/renderer/index.html`: keeps only Explorer and Search in the structural sidebar and adds stable overlay hosts.
- `apps/desktop/src/renderer/workbench/workbenchLayout.ts`: narrows sidebar state to structural views.
- `apps/desktop/src/renderer/panels/sourceControl.ts`: divides existing Git UI into changes, commit, and history regions.
- `apps/desktop/src/renderer/ai/chatWidget.ts`: removes free-drag placement and exposes history, conversation, and inspector regions.
- `apps/desktop/src/renderer/ai/connectView.ts`: mounts provider/model content in a dependent-capable shell.
- `apps/desktop/src/renderer/features/featureLibrary.ts`: mounts a category rail and results workspace in a large shell.
- `apps/desktop/src/renderer/settings/settingsView.ts`: becomes shell content and relinquishes overlay dismissal.
- `apps/desktop/src/renderer/panels/structurePopup.ts`: becomes anchored content and relinquishes global disclosure.
- `apps/desktop/src/renderer/panels/earningsPopover.ts`: becomes anchored content and relinquishes global disclosure.
- `apps/desktop/src/renderer/dialogs/shortcutsDialog.ts`: adopts shared material and size tokens without changing keybinding behavior.
- `apps/desktop/src/renderer/help/helpGuide.ts`: adopts shared material and size tokens without changing guide behavior.
- `apps/desktop/src/renderer/styles/workbench.css`: boxed sidebar and main geometry.
- `apps/desktop/src/renderer/styles/panels.css`: Source Control workspace and boxed bottom panel.
- `apps/desktop/src/renderer/styles/ai.css`: Chat, Connect, and responsive inspector layout.
- `apps/desktop/src/renderer/styles/features.css`: two-pane feature library.
- `apps/desktop/src/renderer/styles/settings.css`: dialog-contained settings layout.
- `apps/desktop/src/renderer/styles/popups.css`: anchored Structure/Earnings content only.
- `apps/desktop/test/workbenchLayout.test.ts`: structural sidebar state only.
- `apps/desktop/test/featureLibraryMarkup.test.ts`: new large-dialog contract.
- `scripts/smoke.mjs`: full interaction, layout, focus, and responsive coverage.

---

### Task 1: Pop-up Layer State

**Files:**
- Create: `apps/desktop/src/renderer/workbench/popupLayer.ts`
- Create: `apps/desktop/test/popupLayer.test.ts`

**Interfaces:**
- Consumes: no application state.
- Produces: `PopupId`, `PopupLayerState`, `PopupLayerEvent`, `initialPopupLayer()`, and `reducePopupLayer()`.

- [ ] **Step 1: Write the failing state tests**

```ts
import { describe, expect, it } from "vitest";
import {
  initialPopupLayer,
  reducePopupLayer,
} from "../src/renderer/workbench/popupLayer.ts";

describe("pop-up layer", () => {
  it("replaces one primary pop-up with another", () => {
    const sourceControl = reducePopupLayer(initialPopupLayer(), {
      type: "open-primary",
      id: "source-control",
    });
    const chat = reducePopupLayer(sourceControl, { type: "open-primary", id: "chat" });
    expect(chat).toEqual({ primary: "chat", dependent: null });
  });

  it("keeps one dependent above its owning primary", () => {
    const chat = reducePopupLayer(initialPopupLayer(), { type: "open-primary", id: "chat" });
    const connect = reducePopupLayer(chat, {
      type: "open-dependent",
      id: "connect",
      owner: "chat",
    });
    expect(connect).toEqual({ primary: "chat", dependent: "connect" });
  });

  it("closes the dependent before the primary", () => {
    const layered = { primary: "chat" as const, dependent: "connect" as const };
    const once = reducePopupLayer(layered, { type: "escape" });
    expect(once).toEqual({ primary: "chat", dependent: null });
    expect(reducePopupLayer(once, { type: "escape" })).toEqual({
      primary: null,
      dependent: null,
    });
  });

  it("toggles an anchored primary from its launcher", () => {
    const open = reducePopupLayer(initialPopupLayer(), {
      type: "toggle-primary",
      id: "earnings",
    });
    expect(open.primary).toBe("earnings");
    expect(reducePopupLayer(open, { type: "toggle-primary", id: "earnings" }).primary)
      .toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing module failure**

Run: `npm test -- popupLayer`

Expected: FAIL because `workbench/popupLayer.ts` does not exist.

- [ ] **Step 3: Implement the pure reducer**

```ts
export type PopupId =
  | "source-control"
  | "chat"
  | "features"
  | "settings"
  | "structure"
  | "earnings"
  | "connect";

export interface PopupLayerState {
  readonly primary: PopupId | null;
  readonly dependent: PopupId | null;
}

export type PopupLayerEvent =
  | { readonly type: "open-primary"; readonly id: PopupId }
  | { readonly type: "toggle-primary"; readonly id: PopupId }
  | { readonly type: "open-dependent"; readonly id: PopupId; readonly owner: PopupId }
  | { readonly type: "close"; readonly id: PopupId }
  | { readonly type: "escape" };

export const initialPopupLayer = (): PopupLayerState => ({ primary: null, dependent: null });

export function reducePopupLayer(
  state: PopupLayerState,
  event: PopupLayerEvent,
): PopupLayerState {
  switch (event.type) {
    case "open-primary":
      return { primary: event.id, dependent: null };
    case "toggle-primary":
      return state.primary === event.id && state.dependent === null
        ? initialPopupLayer()
        : { primary: event.id, dependent: null };
    case "open-dependent":
      return state.primary === event.owner ? { ...state, dependent: event.id } : state;
    case "close":
      if (state.dependent === event.id) return { ...state, dependent: null };
      if (state.primary === event.id) return initialPopupLayer();
      return state;
    case "escape":
      if (state.dependent !== null) return { ...state, dependent: null };
      return initialPopupLayer();
  }
}
```

- [ ] **Step 4: Run the state tests**

Run: `npm test -- popupLayer`

Expected: 4 tests pass.

- [ ] **Step 5: Commit the state model**

```bash
git add apps/desktop/src/renderer/workbench/popupLayer.ts apps/desktop/test/popupLayer.test.ts
git commit -m "feat(workbench): model layered pop-ups"
```

---

### Task 2: Shared Pop-up Shell

**Files:**
- Create: `apps/desktop/src/renderer/workbench/popupShell.ts`
- Create: `apps/desktop/src/renderer/styles/popupShell.css`
- Create: `apps/desktop/test/popupShellMarkup.test.ts`
- Modify: `apps/desktop/src/renderer/main.ts`

**Interfaces:**
- Consumes: `PopupId` from Task 1 and existing `LayoutInput` from `workbench/motion.ts`.
- Produces: `PopupSize`, `PopupShellOptions`, `PopupShell`, and `createPopupShell()`.

- [ ] **Step 1: Write the failing source-contract tests**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/renderer/workbench/popupShell.ts", import.meta.url),
  "utf8",
);

describe("shared pop-up shell", () => {
  it("uses native dialogs for modal surfaces", () => {
    expect(source).toContain('document.createElement("dialog")');
    expect(source).toContain("dialog.showModal()");
  });

  it("owns Escape, backdrop dismissal, and focus restoration", () => {
    expect(source).toContain('addEventListener("cancel"');
    expect(source).toContain("surface.contains(event.target as Node)");
    expect(source).toContain("restoreTarget?.focus()");
  });

  it("announces launcher disclosure", () => {
    expect(source).toContain('setAttribute("aria-expanded"');
    expect(source).toContain('setAttribute("aria-pressed"');
  });
});
```

- [ ] **Step 2: Run the shell test and confirm failure**

Run: `npm test -- popupShellMarkup`

Expected: FAIL because `popupShell.ts` does not exist.

- [ ] **Step 3: Implement the shell interface and lifecycle**

```ts
import type { PopupId } from "./popupLayer.ts";
import type { LayoutInput } from "./motion.ts";

export type PopupSize = "anchored" | "medium" | "large" | "workspace";

export interface PopupShellOptions {
  readonly id: PopupId;
  readonly title: string;
  readonly size: PopupSize;
  readonly modal: boolean;
  readonly host: HTMLElement;
  readonly content: HTMLElement;
  readonly closeOnBackdrop?: boolean;
  readonly onRequestClose: () => void;
}

export interface PopupOpenOptions {
  readonly trigger?: HTMLElement;
  readonly anchor?: HTMLElement;
  readonly input?: LayoutInput;
  readonly initialFocus?: HTMLElement;
}

export interface PopupShell {
  readonly element: HTMLDialogElement;
  readonly surface: HTMLElement;
  open(options?: PopupOpenOptions): void;
  close(options?: { readonly restoreFocus?: boolean }): void;
  isOpen(): boolean;
  focus(): void;
}

export function createPopupShell(options: PopupShellOptions): PopupShell {
  const dialog = document.createElement("dialog");
  dialog.className = "popup-shell";
  dialog.dataset["popupId"] = options.id;
  dialog.dataset["popupSize"] = options.size;
  dialog.setAttribute("aria-label", options.title);

  const surface = document.createElement("section");
  surface.className = "popup-shell-surface";
  surface.tabIndex = -1;
  surface.append(options.content);
  dialog.append(surface);
  options.host.append(dialog);

  let restoreTarget: HTMLElement | null = null;

  const announce = (open: boolean): void => {
    restoreTarget?.setAttribute("aria-expanded", String(open));
    restoreTarget?.setAttribute("aria-pressed", String(open));
  };

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    options.onRequestClose();
  });
  dialog.addEventListener("click", (event) => {
    if (options.closeOnBackdrop !== false && !surface.contains(event.target as Node)) {
      options.onRequestClose();
    }
  });

  return {
    element: dialog,
    surface,
    open(openOptions = {}) {
      restoreTarget = openOptions.trigger ?? null;
      if (openOptions.anchor !== undefined) positionAnchored(dialog, openOptions.anchor);
      if (options.modal) dialog.showModal();
      else dialog.show();
      dialog.dataset["input"] = openOptions.input ?? "keyboard";
      announce(true);
      (openOptions.initialFocus ?? surface).focus({ preventScroll: true });
    },
    close(closeOptions = {}) {
      if (!dialog.open) return;
      dialog.close();
      announce(false);
      if (closeOptions.restoreFocus !== false) restoreTarget?.focus();
    },
    isOpen: () => dialog.open,
    focus: () => surface.focus({ preventScroll: true }),
  };
}

function positionAnchored(dialog: HTMLDialogElement, anchor: HTMLElement): void {
  const box = anchor.getBoundingClientRect();
  dialog.style.setProperty("--popup-anchor-x", `${String(box.right + 10)}px`);
  dialog.style.setProperty("--popup-anchor-y", `${String(box.top)}px`);
}
```

- [ ] **Step 4: Add shared material and responsive CSS**

```css
.popup-shell {
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  overflow: visible;
}

.popup-shell::backdrop {
  background: color-mix(in srgb, var(--bg-workbench) 42%, transparent);
  backdrop-filter: blur(3px);
}

.popup-shell-surface {
  position: fixed;
  overflow: hidden;
  border: 1px solid var(--border-strong);
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg-elevated) 92%, transparent);
  box-shadow: 0 24px 70px rgb(0 0 0 / 0.28), 0 2px 8px rgb(0 0 0 / 0.16);
  backdrop-filter: blur(28px) saturate(155%);
}

.popup-shell[data-popup-size="workspace"] .popup-shell-surface {
  inset: max(16px, 3vh) max(20px, 2.5vw);
  max-width: 1480px;
  margin-inline: auto;
}

.popup-shell[data-popup-size="large"] .popup-shell-surface {
  width: min(1120px, calc(100vw - 40px));
  height: min(780px, calc(100vh - 56px));
  inset: 50% auto auto 50%;
  transform: translate(-50%, -50%);
}

.popup-shell[data-popup-size="medium"] .popup-shell-surface {
  width: min(760px, calc(100vw - 32px));
  height: min(680px, calc(100vh - 48px));
  inset: 50% auto auto 50%;
  transform: translate(-50%, -50%);
}

.popup-shell[data-popup-size="anchored"] .popup-shell-surface {
  width: min(420px, calc(100vw - 72px));
  max-height: calc(100vh - 32px);
  left: var(--popup-anchor-x);
  top: clamp(12px, var(--popup-anchor-y), calc(100vh - 120px));
}

@media (prefers-reduced-motion: reduce) {
  .popup-shell-surface { transition-duration: 100ms; }
}

@media (prefers-reduced-transparency: reduce) {
  .popup-shell-surface { background: var(--bg-elevated); backdrop-filter: none; }
}
```

- [ ] **Step 5: Import the stylesheet and run focused checks**

Add `import "./styles/popupShell.css";` beside the existing style imports in `main.ts`.

Run: `npm test -- popupLayer popupShellMarkup && npm run typecheck`

Expected: focused tests and all TypeScript projects pass.

- [ ] **Step 6: Commit the shared shell**

```bash
git add apps/desktop/src/renderer/workbench/popupShell.ts apps/desktop/src/renderer/styles/popupShell.css apps/desktop/test/popupShellMarkup.test.ts apps/desktop/src/renderer/main.ts
git commit -m "feat(workbench): add shared pop-up shell"
```

---

### Task 3: Structural Sidebar and Boxed Surfaces

**Files:**
- Modify: `apps/desktop/src/renderer/index.html`
- Modify: `apps/desktop/src/renderer/main.ts`
- Modify: `apps/desktop/src/renderer/workbench/workbenchLayout.ts`
- Modify: `apps/desktop/src/renderer/styles/workbench.css`
- Modify: `apps/desktop/src/renderer/styles/panels.css`
- Modify: `apps/desktop/test/workbenchLayout.test.ts`
- Modify: `apps/desktop/test/featureLibraryMarkup.test.ts`

**Interfaces:**
- Consumes: `PopupLayerState` and `PopupShell` from Tasks 1-2.
- Produces: structural sidebar views limited to `explorer | search` and stable overlay hosts.

- [ ] **Step 1: Change the reducer test to accept only structural views**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

it("keeps only Explorer and Search in structural sidebar state", () => {
  const explorer = initialWorkbenchLayout(1200, "explorer");
  const search = reduceWorkbenchLayout(explorer, { type: "show-sidebar", view: "search" });
  expect(search.activeSidebarView).toBe("search");
  expect(search.sidebarOpen).toBe(true);
});

it("excludes popup tools from the structural sidebar type", () => {
  const source = readFileSync(
    resolve(process.cwd(), "apps/desktop/src/renderer/workbench/workbenchLayout.ts"),
    "utf8",
  );
  expect(source).toContain('export type SidebarViewId = "explorer" | "search";');
  expect(source).not.toContain('| "structure"');
  expect(source).not.toContain('| "source-control"');
});
```

Remove reducer assertions that treat Structure, Source Control, Earnings, Features, or
Settings as `SidebarViewId` values.

- [ ] **Step 2: Run the reducer test and confirm the old union is still present**

Run: `npm test -- workbenchLayout`

Expected: FAIL until the union and callers are narrowed.

- [ ] **Step 3: Narrow sidebar state and add overlay hosts**

Set:

```ts
export type SidebarViewId = "explorer" | "search";
```

In `index.html`, keep `filetree` and `view-search` inside `.sidebar-content`. Remove the
Structure, SCM, Earnings, Features, and Settings view hosts from the sidebar. Add after the
workbench:

```html
<div id="popup-primary-host"></div>
<div id="popup-dependent-host"></div>
```

Give non-sidebar activity buttons `aria-haspopup="dialog"`, `aria-expanded="false"`, and
`aria-pressed="false"`.

- [ ] **Step 4: Route structural and pop-up launchers separately**

Replace the generic all-activity sidebar loop with explicit routing:

```ts
const structuralViews = new Set(["explorer", "search"]);

for (const activity of document.querySelectorAll<HTMLButtonElement>(".activity")) {
  const sidebarView = activity.dataset["sidebarView"];
  if (sidebarView !== undefined && structuralViews.has(sidebarView)) {
    activity.addEventListener("click", () => toggleSidebarView(sidebarView, "pointer", activity));
  }
}
```

The pop-up activity handlers are added in Tasks 4-7 after their shells exist.

- [ ] **Step 5: Box structural surfaces**

```css
.sidebar {
  margin: 8px 4px 8px 8px;
  min-width: 0;
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  background: var(--bg-chrome);
  box-shadow: var(--shadow-surface);
  overflow: hidden;
}

.panel {
  margin: 0 8px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  box-shadow: var(--shadow-surface);
  overflow: hidden;
}

.main[data-panel-maximized="true"] > .panel {
  margin: 8px;
  border-radius: 14px;
}
```

Adjust grid sizing so the inset margins do not alter splitter math. Under 820px, preserve
the existing overlay drawer and keep a 10px viewport inset around the boxed sidebar.

- [ ] **Step 6: Run focused tests and build**

Run: `npm test -- workbenchLayout featureLibraryMarkup && npm run desktop:build`

Expected: focused tests pass and the renderer builds.

- [ ] **Step 7: Commit structural surfaces**

```bash
git add apps/desktop/src/renderer/index.html apps/desktop/src/renderer/main.ts apps/desktop/src/renderer/workbench/workbenchLayout.ts apps/desktop/src/renderer/styles/workbench.css apps/desktop/src/renderer/styles/panels.css apps/desktop/test/workbenchLayout.test.ts apps/desktop/test/featureLibraryMarkup.test.ts
git commit -m "feat(workbench): box structural panels"
```

---

### Task 4: Anchored Structure and Earnings Pop-ups

**Files:**
- Modify: `apps/desktop/src/renderer/main.ts`
- Modify: `apps/desktop/src/renderer/panels/structurePopup.ts`
- Modify: `apps/desktop/src/renderer/panels/earningsPopover.ts`
- Modify: `apps/desktop/src/renderer/styles/popups.css`
- Modify: `scripts/smoke.mjs`

**Interfaces:**
- Consumes: `createPopupShell({ size: "anchored", modal: false })`.
- Produces: content-only Structure/Earnings components and activity-anchored disclosure.

- [ ] **Step 1: Add failing smoke assertions for preserved sidebar geometry**

Add a focused workbench probe that records sidebar and editor rectangles, opens each anchored
pop-up, and returns:

```js
{
  structureOpen: document.querySelector('[data-popup-id="structure"]')?.open === true,
  earningsOpen: document.querySelector('[data-popup-id="earnings"]')?.open === true,
  sidebarStable: beforeSidebar.width === afterSidebar.width,
  editorStable: beforeEditor.width === afterEditor.width,
  rounded: parseFloat(getComputedStyle(surface).borderRadius) >= 12,
}
```

- [ ] **Step 2: Run the focused probe and confirm it fails**

Run: `$env:ADCODE_SMOKE_WORKBENCH_PROBE='1'; node scripts/smoke.mjs`

Expected: FAIL because the tools still mount in sidebar views.

- [ ] **Step 3: Make Structure and Earnings content-only**

For each component:

- keep its root `section`, header, local tabs/actions, render methods, and data subscriptions;
- remove `host`, `requestClose`, global Escape, outside-pointer, and fixed-position ownership;
- accept `onRequestClose: () => void` only for its visible close button;
- define `isOpen()` from a `visible` flag set by new `shown()` and `hidden()` lifecycle methods.

The resulting public shape is:

```ts
export interface AnchoredTool {
  readonly element: HTMLElement;
  shown(): void;
  hidden(): void;
  isOpen(): boolean;
}
```

Retain Structure's `open(tab)`, `toggle(tab)`, and `setOutlineEnabled()` and Earnings'
`update(snapshot)` in their concrete interfaces.

- [ ] **Step 4: Create and route anchored shells in `main.ts`**

```ts
const structureShell = createPopupShell({
  id: "structure",
  title: "Structure",
  size: "anchored",
  modal: false,
  host: el("popup-primary-host"),
  content: structurePopup.element,
  onRequestClose: () => closePrimaryPopup("structure"),
});

const earningsShell = createPopupShell({
  id: "earnings",
  title: "Earnings",
  size: "anchored",
  modal: false,
  host: el("popup-primary-host"),
  content: earningsPopover.element,
  onRequestClose: () => closePrimaryPopup("earnings"),
});
```

Activity clicks call `togglePrimaryPopup(id, shell, activity, "pointer")`. Shell open receives
`anchor: activity`. Opening either leaves structural sidebar state untouched.

- [ ] **Step 5: Style anchored content and narrow bottom-sheet behavior**

Remove zero-radius/fill-sidebar overrides. Set card content to fill the shell surface and
use scrollable bodies. Below 620px:

```css
.popup-shell[data-popup-size="anchored"] .popup-shell-surface {
  left: 12px;
  right: 12px;
  top: auto;
  bottom: 12px;
  width: auto;
  max-height: min(72vh, 620px);
  border-radius: 16px;
}
```

- [ ] **Step 6: Rebuild and rerun the focused probe**

Run: `npm run desktop:build`

Run: `$env:ADCODE_SMOKE_WORKBENCH_PROBE='1'; node scripts/smoke.mjs`

Expected: anchored pop-ups open, sidebar/editor rectangles remain unchanged, and surfaces
report at least 12px radius.

- [ ] **Step 7: Commit anchored tools**

```bash
git add apps/desktop/src/renderer/main.ts apps/desktop/src/renderer/panels/structurePopup.ts apps/desktop/src/renderer/panels/earningsPopover.ts apps/desktop/src/renderer/styles/popups.css scripts/smoke.mjs
git commit -m "feat(workbench): restore anchored utility pop-ups"
```

---

### Task 5: Source Control Workspace Dialog

**Files:**
- Modify: `apps/desktop/src/renderer/panels/sourceControl.ts`
- Modify: `apps/desktop/src/renderer/main.ts`
- Modify: `apps/desktop/src/renderer/styles/panels.css`
- Create: `apps/desktop/test/sourceControlWorkspaceMarkup.test.ts`
- Modify: `scripts/smoke.mjs`

**Interfaces:**
- Consumes: workspace `PopupShell` and existing `SourceControlPanel` commands.
- Produces: `element` containing `.scm-changes-region`, `.scm-commit-region`, and `.scm-history-region`.

- [ ] **Step 1: Write the failing Source Control region test**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/renderer/panels/sourceControl.ts", import.meta.url),
  "utf8",
);

describe("Source Control workspace", () => {
  it("separates changes, commit, and history into stable regions", () => {
    expect(source).toContain('changesRegion.className = "scm-changes-region"');
    expect(source).toContain('commitRegion.className = "scm-commit-region"');
    expect(source).toContain('historyRegion.className = "scm-history-region"');
    expect(source).toContain("element.append(changesRegion, commitRegion, historyRegion)");
  });
});
```

- [ ] **Step 2: Run the markup test and confirm failure**

Run: `npm test -- sourceControlWorkspaceMarkup`

Expected: FAIL because the existing panel is flat.

- [ ] **Step 3: Group existing nodes without changing Git actions**

Create three region elements and move existing nodes:

```ts
const changesRegion = document.createElement("section");
changesRegion.className = "scm-changes-region";
changesRegion.setAttribute("aria-label", "Changes");
changesRegion.append(header, actions, conflicts, list, empty);

const commitRegion = document.createElement("section");
commitRegion.className = "scm-commit-region";
commitRegion.setAttribute("aria-label", "Commit");
commitRegion.append(commitBox);

const historyRegion = document.createElement("section");
historyRegion.className = "scm-history-region";
historyRegion.setAttribute("aria-label", "History and timeline");
historyRegion.append(timeline, history.element);

element.append(changesRegion, commitRegion, historyRegion);
```

Do not change `refresh`, staging, commit, history, restore, conflict, or remote methods.

- [ ] **Step 4: Mount Source Control in a workspace shell**

Create `sourceControlShell` with `id: "source-control"`, `size: "workspace"`, and
`modal: true`. The Source Control activity button and every `withScm()` command open this
shell before refreshing or focusing the commit message.

- [ ] **Step 5: Add three-column and responsive CSS**

```css
.scm-panel {
  display: grid;
  grid-template-columns: minmax(280px, 0.85fr) minmax(320px, 1.25fr) minmax(300px, 1fr);
  height: 100%;
  min-height: 0;
}

.scm-changes-region,
.scm-commit-region,
.scm-history-region {
  min-width: 0;
  min-height: 0;
  padding: 16px;
  overflow: auto;
}

.scm-commit-region,
.scm-history-region { border-left: 1px solid var(--border-subtle); }

@media (max-width: 980px) {
  .scm-panel { grid-template-columns: minmax(260px, 0.9fr) minmax(360px, 1.4fr); }
  .scm-history-region { position: absolute; inset: 0 0 0 auto; width: min(380px, 80%); }
}

@media (max-width: 720px) {
  .scm-panel { display: block; }
  .scm-changes-region { position: absolute; inset: 0 auto 0 0; width: min(340px, 86%); }
}
```

Add explicit buttons to toggle responsive changes/history drawers and synchronize
`aria-expanded`.

- [ ] **Step 6: Extend smoke coverage**

Assert the workspace shell leaves title/status bars visible, the three regions exist, stage
and unstage still change rows, commit retains its message on failure, history opens, and
Escape restores focus to the Source Control launcher.

- [ ] **Step 7: Run focused and smoke tests**

Run: `npm test -- sourceControlWorkspaceMarkup`

Run: `npm run desktop:build && node scripts/smoke.mjs`

Expected: markup test and complete smoke run pass with zero suspicious log lines.

- [ ] **Step 8: Commit Source Control workspace**

```bash
git add apps/desktop/src/renderer/panels/sourceControl.ts apps/desktop/src/renderer/main.ts apps/desktop/src/renderer/styles/panels.css apps/desktop/test/sourceControlWorkspaceMarkup.test.ts scripts/smoke.mjs
git commit -m "feat(git): open Source Control as a workspace dialog"
```

---

### Task 6: All Features and Settings Dialogs

**Files:**
- Modify: `apps/desktop/src/renderer/features/featureLibrary.ts`
- Modify: `apps/desktop/src/renderer/settings/settingsView.ts`
- Modify: `apps/desktop/src/renderer/main.ts`
- Modify: `apps/desktop/src/renderer/styles/features.css`
- Modify: `apps/desktop/src/renderer/styles/settings.css`
- Modify: `apps/desktop/test/featureLibraryMarkup.test.ts`
- Modify: `scripts/smoke.mjs`

**Interfaces:**
- Consumes: large and medium `PopupShell` sizes.
- Produces: `.feature-library-categories`, `.feature-library-workspace`, and content-only Settings lifecycle.

- [ ] **Step 1: Rewrite failing feature-library contract tests**

```ts
it("renders categories beside a spacious results workspace", () => {
  expect(source).toContain('categoryRail.className = "feature-library-categories"');
  expect(source).toContain('workspace.className = "feature-library-workspace"');
  expect(source).toContain("body.append(categoryRail, workspace)");
});

it("does not position or dismiss its own overlay", () => {
  expect(source).not.toContain("positionPopover");
  expect(source).not.toContain('document.addEventListener("pointerdown"');
});
```

- [ ] **Step 2: Run the feature test and confirm failure**

Run: `npm test -- featureLibraryMarkup`

Expected: FAIL on the missing category/workspace regions.

- [ ] **Step 3: Refactor All Features into content-only two-pane markup**

Create category buttons from `featureLibraryCategories(records)` in a left rail. Keep search,
filter, notice, results, keyboard selection, Open, Settings, and Help behaviors in the main
workspace. Replace the module's close positioning with `onRequestClose: () => void` and
`shown()/hidden()` lifecycle methods.

- [ ] **Step 4: Refactor Settings into shell content**

Keep search, groups, values, help popover, write/reset, `openAt`, and highlight behavior.
Remove the sheet backdrop and document-level Escape handler. Expose:

```ts
export interface SettingsView {
  readonly element: HTMLElement;
  shown(): void;
  hidden(): void;
  openAt(settingId: string): void;
  isOpen(): boolean;
}
```

- [ ] **Step 5: Mount shells and preserve action routing**

Create `featuresShell` as `large` and `settingsShell` as `medium`. Feature Open/Settings
actions close Features before routing. `openSetting(id)` opens Settings, calls
`settingsView.openAt(id)`, and focuses the highlighted row.

- [ ] **Step 6: Implement spacious responsive layouts**

```css
.feature-library-body {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  min-height: 0;
}

.feature-library-categories {
  padding: 12px;
  overflow: auto;
  border-right: 1px solid var(--border-subtle);
}

.feature-library-workspace {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
}

@media (max-width: 720px) {
  .feature-library-body { grid-template-columns: 1fr; }
  .feature-library-categories { display: flex; overflow-x: auto; border-right: 0; }
}
```

Settings uses a sticky search/group header and one scrolling body inside the shell.

- [ ] **Step 7: Extend smoke checks and run them**

Assert categories and results are simultaneously visible, feature actions close before
routing, Settings search/highlight/help remain functional, Escape restores each launcher,
and the shells remain within narrow viewports.

Run: `npm test -- featureLibraryMarkup && npm run desktop:build && node scripts/smoke.mjs`

Expected: focused and complete smoke checks pass.

- [ ] **Step 8: Commit Features and Settings**

```bash
git add apps/desktop/src/renderer/features/featureLibrary.ts apps/desktop/src/renderer/settings/settingsView.ts apps/desktop/src/renderer/main.ts apps/desktop/src/renderer/styles/features.css apps/desktop/src/renderer/styles/settings.css apps/desktop/test/featureLibraryMarkup.test.ts scripts/smoke.mjs
git commit -m "feat(workbench): expand Features and Settings dialogs"
```

---

### Task 7: AI Chat Workspace and Dependent Connect Dialog

**Files:**
- Modify: `apps/desktop/src/renderer/ai/chatWidget.ts`
- Modify: `apps/desktop/src/renderer/ai/connectView.ts`
- Modify: `apps/desktop/src/renderer/main.ts`
- Modify: `apps/desktop/src/renderer/styles/ai.css`
- Create: `apps/desktop/test/chatWorkspaceMarkup.test.ts`
- Modify: `scripts/smoke.mjs`

**Interfaces:**
- Consumes: workspace primary and medium dependent shells.
- Produces: Chat history/conversation/inspector regions and content-only Connect lifecycle.

- [ ] **Step 1: Write failing Chat region tests**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/renderer/ai/chatWidget.ts", import.meta.url),
  "utf8",
);

describe("AI Chat workspace", () => {
  it("renders history, conversation, and inspector regions", () => {
    expect(source).toContain('history.className = "chat-history"');
    expect(source).toContain('conversation.className = "chat-conversation"');
    expect(source).toContain('inspector.className = "chat-inspector"');
    expect(source).toContain("body.append(history, conversation, inspector)");
  });

  it("retires free-drag position persistence", () => {
    expect(source).not.toContain("positionKey");
    expect(source).not.toContain("savePosition");
    expect(source).not.toContain("chat-resize");
  });
});
```

- [ ] **Step 2: Run the Chat test and confirm failure**

Run: `npm test -- chatWorkspaceMarkup`

Expected: FAIL because Chat is still a draggable card.

- [ ] **Step 3: Recompose Chat without changing message/task behavior**

Remove `Position`, localStorage position helpers, pointer-drag listeners, and resize grip.
Create:

```ts
const conversation = document.createElement("main");
conversation.className = "chat-conversation";
conversation.append(memory, transcript, composer);

const inspector = document.createElement("aside");
inspector.className = "chat-inspector";
inspector.setAttribute("aria-label", "AI task inspector");
inspector.append(taskStrip, teamPanel, automationPanel);

const body = document.createElement("div");
body.className = "chat-body";
body.append(history, conversation, inspector);
```

Keep session history, streaming, memory, task, Team, automation, review, trace, conflict,
rollback, send, and error behavior unchanged.

- [ ] **Step 4: Add explicit history and inspector disclosure**

Header buttons toggle `data-history-open` and `data-inspector-open` on the Chat root and
mirror `aria-expanded`. Initialize both true above 980px, inspector false from 720-979px,
and both false below 720px. Store only these booleans in module memory for the renderer
session.

- [ ] **Step 5: Make Connect content-only and dependent-capable**

Remove its `.settings-sheet` backdrop, global Escape handler, and direct focus restoration.
Expose `element`, `shown()`, `hidden()`, and `isOpen()`. Preserve provider search, key
validation/storage, custom address, model selection, catalogue status, and inline errors.

Create `connectShell` in `popup-dependent-host` with `size: "medium"`. Opening from Chat
dispatches `open-dependent` with owner `chat`; closing returns focus to the Chat Connect
button. Independent `ai.connect` opens Connect as a primary medium shell with editor focus
restoration.

- [ ] **Step 6: Implement Chat and Connect layouts**

```css
.chat-card { width: 100%; height: 100%; }

.chat-body {
  display: grid;
  grid-template-columns: 280px minmax(360px, 1fr) 360px;
  height: calc(100% - var(--chat-header-height));
  min-height: 0;
}

.chat-history,
.chat-inspector { min-width: 0; min-height: 0; overflow: auto; }
.chat-history { border-right: 1px solid var(--border-subtle); }
.chat-inspector { border-left: 1px solid var(--border-subtle); }

.chat-conversation {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
}

@media (max-width: 980px) {
  .chat-body { grid-template-columns: 260px minmax(0, 1fr); }
  .chat-inspector { position: absolute; inset: 0 0 0 auto; width: min(400px, 82%); }
}

@media (max-width: 720px) {
  .chat-body { display: block; }
  .chat-history,
  .chat-inspector { position: absolute; inset-block: 0; width: min(340px, 88%); }
}
```

Connect uses a 240px provider rail and flexible detail region, collapsing to a horizontal
provider strip below 680px.

- [ ] **Step 7: Extend Chat/Connect smoke coverage**

Assert workspace sizing, visible title/status chrome, transcript dominance, history reopen,
inspector disclosure, composer reachability, send/history behavior, Connect stacking above
Chat, provider selection, layered Escape, and focus return.

- [ ] **Step 8: Run focused and complete checks**

Run: `npm test -- chatWorkspaceMarkup aiWorkspaceView aiTeamView aiAutomationView`

Run: `npm run desktop:build && node scripts/smoke.mjs`

Expected: focused tests and complete smoke pass with zero suspicious renderer log lines.

- [ ] **Step 9: Commit Chat and Connect**

```bash
git add apps/desktop/src/renderer/ai/chatWidget.ts apps/desktop/src/renderer/ai/connectView.ts apps/desktop/src/renderer/main.ts apps/desktop/src/renderer/styles/ai.css apps/desktop/test/chatWorkspaceMarkup.test.ts scripts/smoke.mjs
git commit -m "feat(ai): expand Chat and Connect dialogs"
```

---

### Task 8: Help, Shortcuts, Motion, and Accessibility Polish

**Files:**
- Modify: `apps/desktop/src/renderer/help/helpGuide.ts`
- Modify: `apps/desktop/src/renderer/dialogs/shortcutsDialog.ts`
- Modify: `apps/desktop/src/renderer/styles/dialogs.css`
- Modify: `apps/desktop/src/renderer/styles/popupShell.css`
- Modify: `apps/desktop/src/renderer/workbench/popupShell.ts`
- Modify: `apps/desktop/test/popupShellMarkup.test.ts`
- Modify: `scripts/smoke.mjs`

**Interfaces:**
- Consumes: shared shell material and disclosure input type.
- Produces: complete motion, contrast, focus, and narrow-viewport contract.

- [ ] **Step 1: Add failing shell contract assertions**

```ts
it("distinguishes pointer, keyboard, and reduced-motion disclosure", () => {
  expect(source).toContain('dialog.dataset["input"]');
  expect(source).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
  expect(source).toContain("duration: 220");
  expect(source).toContain("duration: 100");
});

it("maintains one labelled dialog layer at a time", () => {
  expect(source).toContain('dialog.setAttribute("aria-labelledby"');
  expect(source).toContain("initialFocus");
});
```

- [ ] **Step 2: Run the contract tests and confirm missing behavior**

Run: `npm test -- popupShellMarkup`

Expected: FAIL until the shell adds label ids and explicit animations.

- [ ] **Step 3: Add interruptible shell animation**

On open, cancel existing surface animations and animate pointer disclosure from source-relative
translation plus scale 0.97 and opacity 0 to the presented state. Keyboard input sets the
final state immediately. On close, animate from the current computed matrix to scale 0.97
and opacity 0, then call `dialog.close()` after `finished`. Reduced motion uses only opacity
for 100ms. A second open/close cancels and retargets the current animation.

- [ ] **Step 4: Complete label, focus, contrast, and transparency behavior**

Give every shell a generated title id and `aria-labelledby`. Require each caller to pass
`initialFocus` for search/commit/composer tasks. Add:

```css
@media (prefers-contrast: more) {
  .popup-shell-surface {
    border: 2px solid CanvasText;
    background: Canvas;
    color: CanvasText;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .popup-shell::backdrop { backdrop-filter: none; }
  .popup-shell-surface { background: var(--bg-elevated); backdrop-filter: none; }
}
```

- [ ] **Step 5: Align Help Guide and Keyboard Shortcuts visually**

Keep their native dialog logic and content behavior. Replace bespoke card geometry with the
shared medium/large material tokens, 16px radius, complete border, consistent header/close,
and the same narrow inset. Do not route these through the primary coordinator because they
are menu-command dialogs with their own proven lifecycle.

- [ ] **Step 6: Run accessibility and full UI checks**

Run: `npm test -- popupShellMarkup menuKeyboard keybindings`

Run: `npm run desktop:build && node scripts/smoke.mjs`

Expected: focus, Escape, menus, shortcuts, and complete smoke pass.

- [ ] **Step 7: Commit final visual/accessibility polish**

```bash
git add apps/desktop/src/renderer/help/helpGuide.ts apps/desktop/src/renderer/dialogs/shortcutsDialog.ts apps/desktop/src/renderer/styles/dialogs.css apps/desktop/src/renderer/styles/popupShell.css apps/desktop/src/renderer/workbench/popupShell.ts apps/desktop/test/popupShellMarkup.test.ts scripts/smoke.mjs
git commit -m "feat(workbench): polish dialog motion and accessibility"
```

---

### Task 9: Release Verification and 1.0.0 Deployment

**Files:**
- Modify only if a check exposes a scoped defect: files already listed in Tasks 1-8.
- Do not stage: dirty `apps/web`, `packages/ads`, `packages/help`, root documentation, or root package-order changes.

**Interfaces:**
- Consumes: completed implementation and existing `.github/workflows/release.yml`.
- Produces: verified `main` commit and refreshed public v1.0.0 assets.

- [ ] **Step 1: Run repository verification**

Run: `npm run verify`

Expected: TypeScript passes, dependency firewall reports 0 errors, and all test files pass.

- [ ] **Step 2: Run production build and complete Electron smoke**

Run: `npm run desktop:build`

Run: `node scripts/smoke.mjs`

Expected: production build succeeds; every smoke assertion passes; suspicious log count is 0.

- [ ] **Step 3: Run workspace integrity checks**

Run: `git diff --check`

Run: `git status --short`

Expected: no whitespace errors; only the scoped implementation plus preserved unrelated
working-tree changes are present.

- [ ] **Step 4: Request independent code review and resolve findings**

Use `superpowers:requesting-code-review`. Review pop-up lifecycle, focus, nested Escape,
source-control behavior, AI task behavior, responsive reachability, accessibility, and smoke
coverage. Apply important findings, then repeat Steps 1-3.

- [ ] **Step 5: Commit the final scoped corrections**

```bash
git add apps/desktop scripts/smoke.mjs
git commit -m "fix(workbench): close pop-up review gaps"
```

If no correction is needed, do not create an empty commit.

- [ ] **Step 6: Push `main`**

Run: `git push origin main`

Expected: the verified implementation commit reaches `bluethenics/adcode` without staging
or committing unrelated dirty files.

- [ ] **Step 7: Dispatch the existing release workflow**

Use the cached GitHub credential without printing it and call:

```text
POST /repos/bluethenics/adcode/actions/workflows/release.yml/dispatches
{"ref":"main","inputs":{"publish":"true"}}
```

Expected: GitHub accepts the workflow dispatch.

- [ ] **Step 8: Monitor every release job**

Poll the workflow jobs until `version`, `build (windows)`, `build (linux)`, optional
`build (macos)`, and `release` complete. Required jobs must conclude `success`. Confirm the
workflow `head_sha` equals the pushed implementation commit.

- [ ] **Step 9: Verify live updater and download endpoints**

Verify:

```text
https://github.com/bluethenics/adcode/releases/tag/v1.0.0
https://github.com/bluethenics/adcode/releases/download/v1.0.0/latest.yml
https://adcode.bluethenics.com/dl/windows
https://adcode.bluethenics.com/dl/linux
https://adcode.bluethenics.com/dl/linux-deb
https://adcode.bluethenics.com/versions
https://adcode.bluethenics.com/v1/health
```

Expected: release is published, asset timestamps/digests are fresh, manifest says
`version: 1.0.0`, all download routes return 200 with the new content lengths, Versions
mentions 1.0.0, and health returns `{"ok":true}`.

- [ ] **Step 10: Update release notes and report the same-version limitation**

Prepend a dated summary of the pop-up workbench, Source Control, Chat, Connect, and boxed
surface changes to the existing v1.0.0 release body. Report plainly that fresh downloads
contain the build while installed 1.0.0 clients require a future 1.0.1 to auto-update.
