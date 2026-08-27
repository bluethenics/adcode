# Safe Single-Agent Workspaces Implementation Plan

> **For ADCode contributors:** Execute this plan task-by-task with tests first. The umbrella design remains authoritative for security and UX invariants.

**Goal:** Make the built-in assistant perform file edits in a durable isolated workspace, let users review and apply those edits safely, and provide conflict-aware rollback without changing ADCode's existing human editing workflow or visual language.

**Architecture:** Pure task, permission, budget, and state-transition rules live in `@adcode/ai`. Electron main owns sandbox creation, persistence, filesystem access, Git worktrees, checkpoints, apply, discard, and rollback. The preload exposes a small validated command API. The existing floating assistant gains a compact task status/review surface and continues to use the current theme tokens, hunk diff, keyboard behavior, and motion rules.

**Tech stack:** TypeScript, Node filesystem/process APIs, Electron IPC/contextBridge, Vitest, existing vanilla DOM renderer and CSS tokens.

---

## Invariants

- The renderer and model output are untrusted.
- An agent can read and write only its task sandbox.
- A model-authored file reaches the human workspace only through the main-process apply path.
- Every apply has a durable pre-apply checkpoint.
- Apply stops when the human version no longer matches the task baseline.
- Rollback stops for files changed by the human after apply.
- Clean Git repositories may use detached worktrees; dirty and non-Git projects use shadow copies without changing the user's index, branch, or worktree.
- Operational traces describe actions and outcomes, never hidden chain-of-thought.
- Existing editor, chat, inline hunk review, themes, density modes, and normal file operations remain available.

## Task 1: Add the pure task domain

**Files:**

- Create: `packages/ai/src/workspaces.ts`
- Modify: `packages/ai/src/index.ts`
- Create: `packages/ai/test/workspaces.test.ts`

**Steps:**

1. Write failing tests for task creation, legal state transitions, conservative default permissions, token/cost hard limits, trace event redaction, and path-relative change records.
2. Add provider-neutral types for task identity, lifecycle, sandbox kind, permission profile, budget ledger, file changes, checkpoints, and operational traces.
3. Add pure constructors and transition functions. Reject invalid transitions and usage that would exceed a hard limit before a request begins.
4. Export the module through `@adcode/ai`.
5. Run `npx vitest run packages/ai/test/workspaces.test.ts` and commit.

## Task 2: Build durable task persistence

**Files:**

- Create: `apps/desktop/src/main/aiWorkspaceStore.ts`
- Create: `apps/desktop/test/aiWorkspaceStore.test.ts`

**Steps:**

1. Write failing tests for atomic writes, per-workspace listing, corrupt-record isolation, restart recovery to `paused`, and refusal of unsafe task IDs.
2. Store task records below `<userData>/ai-workspaces/tasks/<task-id>/task.json` using write-then-rename.
3. Keep trace events append-only in `trace.jsonl`; rebuild summaries from valid lines and ignore a truncated final line.
4. Hash workspace identity rather than embedding absolute paths in directory names.
5. Run the focused tests and commit.

## Task 3: Create isolated sandboxes

**Files:**

- Create: `apps/desktop/src/main/aiSandbox.ts`
- Create: `apps/desktop/test/aiSandbox.test.ts`

**Steps:**

1. Write failing tests with temporary repositories for a clean Git worktree, dirty Git shadow fallback, non-Git shadow copy, ignored heavyweight directory handling, containment checks, and cleanup.
2. Detect a clean repository using argv-based Git commands with no shell interpolation.
3. Create a detached worktree below `<userData>/ai-workspaces/sandboxes/<task-id>` when safe.
4. Otherwise create a shadow workspace, copying project files while excluding VCS metadata, ADCode's own sandbox directories, and transient build output. Reuse dependency directories with platform-safe links only when creation succeeds; otherwise leave them absent and record that dependency installation may be needed.
5. Resolve every agent-supplied relative path and prove it remains inside the sandbox before I/O.
6. Clean up through the sandbox registry, never from an arbitrary computed renderer path.
7. Run focused tests and commit.

## Task 4: Add checkpointed review, apply, discard, and rollback

**Files:**

- Create: `apps/desktop/src/main/aiWorkspaceService.ts`
- Create: `apps/desktop/test/aiWorkspaceService.test.ts`

**Steps:**

1. Write failing integration tests for starting a task, sandbox writes, change listing, selected-file apply, no-op apply, conflict on human overlap, discard, restart recovery, rollback, and rollback conflict after later human editing.
2. Record the original content hash when a sandbox file is first changed.
3. Generate review changes from human baseline to sandbox content using the existing hunk engine.
4. Before apply, re-hash each human file. Stop the whole apply if any selected file differs from its baseline.
5. Persist checkpoint originals and a manifest before writing any selected human file.
6. Apply with temporary-file replacement where supported, update post-apply hashes, and record operational trace events.
7. Roll back only files whose current hash still matches the applied hash. Restore prior content or remove a task-created file. Preserve later human changes and report conflicts.
8. Discard a task by marking it discarded and releasing its sandbox; retain checkpoint metadata according to policy.
9. Run focused tests and commit.

## Task 5: Route the built-in assistant through the sandbox

**Files:**

- Modify: `apps/desktop/src/main/aiTools.ts`
- Modify: `apps/desktop/src/main/ai.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Create: `apps/desktop/test/aiWorkspaceTools.test.ts`

**Steps:**

1. Write failing tests proving `read_file`, `list_files`, and `write_file` target the task sandbox, an escaped path is refused, and model edits do not touch the human file.
2. Lazily create one review-mode single-agent task at the first mutating tool use in a conversation.
3. Give the tool runner the sandbox root, not the human workspace root. Make `write_file` persist into the sandbox and emit the existing proposed-edit view from the human baseline.
4. Keep memory access scoped to the human project and label it read-only in the task trace.
5. Reset/cancel must pause the task safely; it must not delete reviewed work.
6. Run focused tests plus existing AI package tests and commit.

## Task 6: Expose a validated workspace-task bridge

**Files:**

- Modify: `apps/desktop/src/shared/api.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Create: `apps/desktop/test/aiWorkspaceIpcContract.test.ts`

**Steps:**

1. Write contract tests for the channel list and the renderer-visible task/change/result shapes.
2. Add `list`, `current`, `changes`, `apply`, `discard`, and `rollback` calls plus a task-changed subscription.
3. Validate task IDs, selected paths, hunk IDs, and action payloads in main before service calls.
4. Return structured conflicts and recoverable error messages; never leak sandbox absolute paths to the renderer.
5. Run focused tests and commit.

## Task 7: Add the compact review-mode task UI

**Files:**

- Modify: `apps/desktop/src/renderer/ai/chatWidget.ts`
- Modify: `apps/desktop/src/renderer/styles/ai.css`
- Modify: `apps/desktop/src/renderer/index.html` only if an accessible static hook is required
- Create: `apps/desktop/test/aiWorkspaceView.test.ts`

**Steps:**

1. Extract pure view-model helpers and write tests for state labels, conflict copy, trace summaries, button availability, and usage formatting.
2. Add a compact task strip/card inside the existing floating assistant: sandbox status, files changed, token estimate/actuals, latest operational action, Review, Apply selected, Discard, and Roll back.
3. Reuse the existing hunk widgets. Applying selected hunks must call the checkpointed task service rather than direct filesystem writes.
4. Use existing CSS tokens and radii. Animate only opacity and transform; honor reduced motion, keyboard focus, screen-reader names, themes, and density.
5. Run focused tests and commit.

## Task 8: Add conservative settings and retention

**Files:**

- Modify: `packages/settings/src/index.ts`
- Modify: `packages/settings/test/settings.test.ts`
- Modify: `apps/desktop/src/main/aiWorkspaceService.ts`
- Modify: `apps/desktop/test/aiWorkspaceService.test.ts`

**Steps:**

1. Write failing schema tests for enabled state, review default, sandbox quota, sandbox retention, checkpoint retention, and default task token limit.
2. Add available AI settings with conservative defaults.
3. Enforce retention only for terminal tasks and never delete the last checkpoint needed by an applied task.
4. Refuse new sandbox creation cleanly when quota cannot be recovered.
5. Run focused tests and commit.

## Task 9: Milestone verification and documentation

**Files:**

- Create: `docs/features/ai-workspaces.md`
- Create: `docs/architecture/ai-workspace-security.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-27-ai-workspaces-automation-design.md` only to record verified implementation status

**Steps:**

1. Document user workflow, sandbox types, review/apply/discard/rollback, conflict behavior, storage, privacy, settings, and current Milestone 2 limits.
2. Document main/renderer authority, path containment, checkpoint format, crash recovery, and future Team-mode compatibility.
3. Run `npm run verify`, `npm run desktop:build`, and `npm run web:build`.
4. Run packaged editor smoke and add a safe single-agent workspace smoke path if the existing harness can drive the assistant without real provider credentials; otherwise use a deterministic fake-provider integration test and document the limitation.
5. Review the complete diff for security, correctness, accessibility, and accidental baseline changes.
6. Commit the verified milestone before starting Efficient Team mode.

