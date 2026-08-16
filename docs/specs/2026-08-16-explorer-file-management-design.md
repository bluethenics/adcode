# Explorer file management design

**Date:** 2026-08-16
**Status:** approved for implementation
**Scope:** right-click actions on the file tree, inline naming, and the file-mutation IPC
surface beneath them. Plus the `window.prompt` replacement, because the input primitive
this needs is the one the branch switcher has been missing.

---

## 1. Why

The explorer can open files and nothing else. There is no create, no rename, no delete, and
no context menu anywhere in the codebase — so every structural change to a project has to
happen in another application and be discovered by the tree on its next listing. That is the
gap this closes.

Two findings from the shell fixes shape the design, and neither was visible from reading:

**`window.prompt` throws in Electron.** Probed against the running app:

```
typeof prompt   : function
prompt() result : THREW prompt() is not supported.
```

`sourceControl.ts` calls it to switch branches, inside a `void`-ed async function, so the
rejection is swallowed and the button has never done anything. Any naming UI here must bring
its own input, and once it exists the branch switcher gets fixed with it.

**A menu that cannot be clicked still passes an item-count assertion.** The menu bar shipped
dead to a real mouse because `element.click()` dispatches at a node rather than at a point.
The context menu is checked at coordinates from the start, for the same reason.

**Non-goals:** drag-and-drop reordering, multi-select, file watching (the tree still refreshes
on demand, not on external change), and symlink-aware operations.

---

## 2. Decisions taken during brainstorming

| # | Question | Decision |
|---|---|---|
| 1 | Delete semantics | `shell.trashItem` — the Recycle Bin, recoverable — with a confirmation naming the item |
| 2 | Naming UX | Inline in the tree, not a dialog. Enter confirms, Escape cancels, errors show under the box |
| 3 | Action set | Create/rename/delete, cut/copy/paste/duplicate, copy path, reveal, and a git group |
| 4 | Where names are validated | The main process. The renderer is hostile by assumption (§1) |
| 5 | Build order | Core mutations first, clipboard and git group second |

---

## 3. The menu

Right-clicking a row targets that row; right-clicking empty tree space targets the workspace
root. New items land inside the clicked folder, or beside the clicked file.

```
New File  /  New Folder
─────────────────────────
Cut  /  Copy  /  Paste  /  Duplicate      Paste disabled when the clipboard is empty
─────────────────────────
Copy Path  /  Copy Relative Path  /  Reveal in File Explorer
─────────────────────────
GIT                                        whole group hidden outside a repository
Stage or Unstage                           whichever applies to this file
Discard Changes                            confirmed; it destroys uncommitted work
Commit…  /  Push
─────────────────────────
Rename (F2)  /  Delete (Del)
```

`renderer/workbench/contextMenu.ts` reuses the `.menu-panel` and `.menu-item` classes the
menu bar already owns rather than restyling a second menu, and flips its anchor near a
viewport edge. Entries resolve to command ids wherever one exists, as `menuModel.ts` does, so
the palette and the menu cannot describe different capabilities.

**Push is repo-wide and has nothing to do with the clicked file.** It is included because it
was asked for, and noted here because the grouping is a little dishonest: Stage, Unstage,
Discard and Commit are the entries that genuinely act on the row.

---

## 4. Name validation — `main/fileNames.ts`

A new pure module, dependency-free and testable without launching Electron, in the shape of
`pathSafety.ts`. A name is one path segment and must satisfy all of:

- non-empty, and not `.` or `..`
- no `/` or `\` — a name that can traverse is not a name
- no NUL or other control characters, and none of `<>:"|?*`
- no trailing dot or space: Windows strips them silently, so the file created is not the file
  requested, and a later lookup by the requested name misses
- not a reserved Windows device — `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9` —
  compared case-insensitively and with any extension stripped, because `CON.txt` is also
  reserved
- at most 255 characters

The joined result is then confined by `isInsideWorkspace` exactly as every other path is.
Validation lives in main because the renderer is hostile by assumption (§1), and the AI layer
makes that concrete rather than theoretical: model output reaches these handlers.

---

## 5. IPC surface

| Channel | Behaviour |
|---|---|
| `fs:create-file` | Refuses if the target exists — never silently truncates |
| `fs:create-folder` | Recursive within the workspace |
| `fs:rename` | Refuses a collision rather than overwriting |
| `fs:trash` | `shell.trashItem`; recoverable |
| `fs:duplicate` | Auto-suffixes `name copy`, `name copy 2`, … |
| `fs:copy` | Recursive; collisions auto-suffix |
| `fs:move` | `rename`, falling back to copy-then-delete on `EXDEV` across volumes |
| `fs:reveal` | `shell.showItemInFolder` |

Each handler validates its own arguments, per the existing pattern at `ipc.ts:130-148`.
Every one returns a `{ ok, message }` outcome rather than throwing across the bridge, so the
renderer has something to report either way — the failure mode Phase 1 found in the git panel.

---

## 6. Tree refresh and open tabs

A mutation re-lists only the affected directory, so expansion state elsewhere survives.

Open tabs are reconciled: a renamed file's tab follows the new path, and a deleted file's tab
is marked stale rather than silently closed. A tab pointing at a path that no longer exists is
how unsaved work gets lost on the next save.

---

## 7. Testing

- Unit tests for `fileNames.ts`, adversarial by default: reserved devices with and without
  extensions, separators, traversal, trailing dots and spaces, control characters, length.
- `pathSafety` tests extended to cover create targets, which are paths that do not yet exist.
- Smoke gains a real round trip driven at coordinates: right-click, create, rename, delete,
  and a rejected bad name. It operates inside `.adcode-smoke-tmp/`, which it removes
  afterwards, so the suite never mutates a tracked file.

---

## 8. Build order

**(a)** context menu, inline naming, create/rename/delete/reveal/copy-path, `fileNames.ts`.
**(b)** cut/copy/paste/duplicate, the git group, and the branch switcher replacement.

Core first so it is working and verified before the clipboard model — the part with collision
handling, cross-volume moves and a mode flag — goes anywhere near it.
