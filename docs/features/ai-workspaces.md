# Safe AI workspaces

ADCode's built-in assistant prepares file edits in a private task workspace. It does not
write a model's proposal directly into the open project. You can inspect the changed files
and hunks, apply only what you accept, discard the task, or roll an applied task back.

This is the safe single-agent foundation. It does not yet include Team mode, trusted
automatic apply, scheduled prompts, external terminal/MCP/API agents, automatic
continuation, or the planned breadcrumb expansion.

## Using a task

1. Open a project and save any editor changes. ADCode blocks AI file tools while that
   project has an unsaved recovery draft, because a filesystem sandbox cannot safely
   represent a newer in-memory buffer.
2. Ask the built-in assistant to inspect or change files. Ordinary question-only chat still
   works without an open project.
3. ADCode creates an isolated task on the first model request for the project. The compact
   strip in the existing chat widget shows its state and reserved token use.
4. Choose **Review** to inspect proposed files and hunks. Applying an empty selection does
   nothing. A path or hunk that was not in the proposal is refused.
5. Apply reviewed changes, reject individual files, or choose **Discard**. Discard removes
   the task sandbox and never writes its remaining proposals to the project.
6. After a complete apply, choose **Roll back** to restore the task's pre-apply contents.
   Rollback is blocked if a person or another tool changed an applied file afterward, so
   later work is preserved.

Applying files one at a time still creates one whole-task rollback point. If any selected
file no longer matches the version the assistant started from, the entire apply is stopped
before the first write.

## What the task strip shows

- a state dot and text label;
- the changed-file count and names in its tooltip;
- reserved token usage against the task limit;
- **Review**, **Trace**, **Discard**, and **Roll back** when those actions are valid.

**Trace** is a local operational timeline: task state, file proposals, budget reservations,
checkpoints, applies, refusals, errors, and rollback. It does not expose or pretend to expose
a model's private chain of thought. Provider cost is omitted until ADCode has reliable
model-specific pricing instead of displaying a misleading zero.

## Isolation types

For a clean Git repository whose root is the open folder, ADCode creates a detached Git
worktree at the current commit. It does not create a branch or alter the user's index.

For a dirty repository, a non-Git folder, or a Git worktree failure, ADCode uses a shadow
copy. It excludes `.git`, `.worktrees`, `node_modules`, `.next`, `.turbo`, `coverage`,
`dist`, and `out`. Dependency folders are not linked into the copy. This milestone does not
run agent commands, so a sandbox is for file inspection and proposals rather than building
inside it.

## Conflicts, checkpoints, and recovery

Immediately before the first accepted write, ADCode durably records each original and
applied file version. A failed multi-file apply restores every file already written. A
failed rollback attempts to put already-restored files back into the applied state, leaving
the checkpoint available for recovery.

On restart, a task that was preparing, ready, running, applying, or rolling back is changed
to **Paused**. ADCode never silently resumes a model, command, or terminal action after a
crash. Corrupt task records and incomplete final trace lines are ignored independently so
one damaged record does not hide other tasks.

## Settings

The AI settings include:

- **Isolate AI edits** — on by default. Turning it off leaves chat available but disables
  built-in file tools; it does not restore direct-to-project AI writes.
- **Task token budget** — 25,000, 100,000 (default), or 250,000 tokens. ADCode reserves a
  conservative maximum before each provider request and pauses before crossing the limit.
- **Sandbox storage** — 1 GB, 5 GB (default), or 10 GB.
- **Keep task sandboxes** — 1, 7 (default), or 30 days after terminal tasks.
- **Keep rollback checkpoints** — 7, 30 (default), or 90 days where cleanup is safe.

Cleanup never deletes an active sandbox. An applied task keeps the checkpoint required for
rollback. If active work leaves no safe space under the quota, starting another task is
refused with an explanation.

## Storage and privacy

Tasks live under Electron's local ADCode user-data folder:

```text
ai-workspaces/
  sandboxes/<task-id>/
  tasks/<task-id>/task.json
  tasks/<task-id>/trace.jsonl
  tasks/<task-id>/checkpoints/<checkpoint-id>/manifest.json
```

Absolute workspace and sandbox locations remain in the main process and are not sent to
the renderer's task views. Trace details redact common credential shapes. Task state is
local; this feature does not upload traces or sandboxes. File contents sent to the selected
AI provider still follow that provider's normal request path and privacy policy.

## Current limits

Only the built-in single agent uses safe workspaces in this milestone. Command and network
permissions default to off, and there is no task command runner yet. Tasks use text files;
binary edits are outside this workflow. Scheduling and continuation will run only while
ADCode is open when those later milestones are implemented.
