# AI workspace security boundary

This document describes the implemented safe single-agent boundary. It is the base that
future Team mode, trusted apply, scheduling, and external adapters must reuse; those later
capabilities are not part of this milestone.

## Authority model

The Electron main process owns task persistence, sandbox creation, path resolution, budget
reservation, apply, checkpoint, discard, rollback, cleanup, and restart recovery. The
renderer receives bounded view models and may request allowlisted actions through typed
IPC. It never receives the human workspace root, sandbox root, checkpoint path, or an
arbitrary filesystem primitive.

The built-in tool runner is given three capabilities: a validated sandbox context, sandbox
text reads, and sandbox text writes. Workspace list and search tools resolve against that
sandbox too. A proposal is diffed against the human file version recorded for the task,
but it reaches the human workspace only through the review/apply service.

```text
model tool call
    |
    v
validated tool runner --> isolated task workspace
                              |
renderer review request ------+--> main-process validation
                                      |
                                      v
                           overlap check + checkpoint
                                      |
                                      v
                              atomic human write
```

## Path containment

Agent and renderer paths must be portable, non-empty relative paths. Absolute paths, drive
paths, NUL bytes, empty segments, `.` segments, and `..` segments are rejected. Resolution
proves lexical containment and then resolves the nearest existing ancestor, preventing a
symlink or Windows junction inside a sandbox from redirecting creation outside it.

Task and checkpoint identifiers are restricted before being used in storage paths. Cleanup
derives its target from a validated identifier, verifies that it remains below the
registered sandbox directory, and removes only that exact task directory. A Git-worktree
cleanup first asks Git to unregister that exact worktree and then removes the validated
directory.

IPC validates bounded identifier/path lengths, duplicate selections, selection count, and
hunk identifiers. The main process then independently verifies that the task belongs to the
currently open workspace and that every selected path/hunk exists in the recorded proposal.

## Sandbox selection

`createAiSandbox` uses a detached Git worktree only when all of these are true:

- the open folder is the repository root;
- `HEAD` exists;
- tracked and untracked status is empty;
- `git worktree add --detach` succeeds.

Otherwise it makes a shadow copy while excluding VCS metadata, dependency directories, and
common generated output. This avoids importing a dirty index into Git machinery and works
for folders that do not use Git. Sandboxes are kept in ADCode user data rather than below
the project.

Unsaved renderer buffers are a separate boundary. Before creating or continuing a tool
workspace, ADCode checks local recovery drafts for the open project. It blocks file tools
until the buffers are saved, rather than allowing an agent to operate on a stale disk
snapshot.

## Apply transaction and rollback

For each selected file, the service re-reads the human path and compares it byte-for-byte
with the proposal's original value. Any mismatch changes the task to conflict and prevents
all selected writes.

Before writing, a checkpoint manifest is atomically persisted with:

- the task and checkpoint identifiers;
- the workspace root (main-process storage only);
- creation time;
- every portable path;
- the pre-task contents or `null` for a new file;
- the accepted contents and their SHA-256 hash.

Files are written through a temporary sibling followed by rename. If a multi-file apply
fails, previously written files are restored. Incremental reviews extend the same manifest,
preserving the first pre-task version while updating the accepted side.

Rollback first checks that every current file hash still equals the accepted hash. A
mismatch preserves all later changes and blocks the entire rollback. Successfully rolled
back new files are removed; existing files receive their pre-task contents.

The checkpoint contains file contents and is therefore sensitive local data. It never
crosses the renderer bridge. Future export or synchronization features must require an
explicit privacy design rather than treating it as ordinary telemetry.

## Persistence and crash behavior

Task JSON uses write-then-rename atomic replacement. Operational traces are append-only
JSON Lines and are observability, not authority: trace failure cannot turn a safe refusal
into an apply failure or vice versa. Common credential forms are redacted when trace events
are created.

Service access waits for restart recovery. Tasks left in transient active states become
paused before the renderer can act on them. Recovery changes metadata only and never starts
a provider, command, terminal process, or network operation. Invalid task records and
partial trace lines are skipped independently.

## Budgets and permissions

Task defaults allow reading the project and editing the sandbox. Commands and network
access are false. Review mode and a single agent are the only implemented mode/policy in
this milestone.

Before each provider request, the agent loop estimates the complete system/tool/message
context plus maximum output and reserves it against the task token limit. A request that
would cross the hard limit is not sent. Cost fields exist in the domain, but ADCode does
not claim cost enforcement while model-specific pricing is unavailable.

## Storage maintenance

Retention removes sandboxes only from terminal tasks. Quota recovery tries oldest eligible
terminal sandboxes and never removes active work. Applied tasks retain their only rollback
checkpoint. If cleanup cannot produce enough safe space, sandbox creation fails before a
new agent task can proceed.

## Required reuse by later milestones

Team mode must allocate one isolated sandbox per agent, coordinate file claims above this
service, and merge through the same validated checkpoint/apply boundary. Trusted mode may
bypass manual file selection only after its test and policy gates pass; it may not bypass
containment, overlap detection, or checkpointing. Schedulers and external adapters may
request work only through explicit adapter capabilities and may never type blindly into an
unknown terminal process.
