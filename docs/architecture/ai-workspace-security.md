# AI workspace, Team, and automation security boundary

This document records the implemented authority boundary. Renderer controls request bounded
actions; Electron's main process owns persistence, project identity, paths, budgets,
sandboxes, merge validation, checkpoints, apply, rollback, schedules, and provider access.

## Authority and containment

The renderer receives redacted view models and uses typed, allowlisted IPC. It never receives
the human workspace root, sandbox root, checkpoint location, arbitrary filesystem handles,
provider credentials, or raw provider payloads. Main-process validators bound identifier,
text, path, list, graph, selection, and concurrency sizes before domain services run.

Agent paths must be portable non-empty relative paths. Absolute or drive paths, NUL bytes,
empty segments, `.` and `..` are rejected. Resolution proves lexical containment and checks
the nearest existing ancestor so a symlink or Windows junction cannot redirect creation
outside the registered sandbox. Task/checkpoint IDs are restricted before joining storage
paths, and cleanup verifies the resolved exact target below the registered task directory.

The built-in tool runner can list, search, read, and write only through a validated sandbox
context. Turning isolation off disables file tools; it does not restore direct AI writes.

## Discovery and dispatch boundary

The All Features library, Help guide, menu bar, and Universal Search share one typed feature
catalogue. A card cannot carry arbitrary JavaScript, IPC, paths, or shell text: its action
is either a registered renderer command or a known setting identifier. The renderer uses
the same safe dispatcher for feature cards and search results, and recent-project results
go through the validated indexed recent-workspace command rather than opening an arbitrary
path from display text.

Search providers are treated as independent read-only sources. Slow symbol and recent-file
providers are generation-scoped; stale generations are discarded, and a provider failure
does not suppress local command or feature results. Discovery grants no authority beyond
the command or setting the user explicitly selects.

## Snapshot, apply, and rollback

A clean repository root uses a detached Git worktree only when `HEAD` exists and tracked and
untracked status are empty. Other projects use a shadow copy excluding VCS data, worktrees,
dependencies, and generated output. Unsaved recovery drafts block file tools rather than
letting an agent use a stale disk snapshot.

Every accepted file is compared byte-for-byte with the human version captured at task start.
Before the first write, an atomic checkpoint stores the pre-task value, accepted value, and
accepted SHA-256 hash. Writes use temporary siblings plus rename. A partial multi-file
failure restores files already written. Rollback first verifies all current hashes still
match the accepted state; later edits cause an all-or-nothing refusal.

Trusted mode changes approval timing, not authority. It collects proposals in the sandbox
during the provider turn, then uses the same overlap check, checkpoint transaction, and
rollback rules. Enabling Trusted requires an explicit setting confirmation.

## Team coordination

A Team suggestion is deterministic renderer/main-process planning and starts no providers.
Configuration is persisted first; only the explicit confirmed start operation may allocate
children and schedule roles. Each role receives a separate sandbox from one immutable team
base. A failure to allocate never falls back to the human workspace.

Dependency-ready nodes are scheduled under a fixed concurrency cap and per-provider limits.
Before every provider request, the coordinator atomically reserves a conservative maximum
from the parent ledger and an agent allowance. Missing usage retains the conservative
estimate. Compact bounded handoffs carry findings, decisions, changed paths, checks,
blockers, and dead ends—not transcripts or hidden reasoning.

File claims are advisory. The actual merge compares every child proposal to the immutable
base, orders compatible changes deterministically, rejects invented outputs, and stops on
same-file overlap or delete/edit conflicts. It never chooses an agent's version implicitly.
A successful merge creates another safe workspace proposal; it still cannot write the human
project except through checkpointed review/apply.

## Automation and terminal input

Scheduled prompts are durable one-time local records. Delivery is gated by process lifetime,
the enabled setting, the currently open project, a registered adapter, and that adapter's
declared scheduled-prompt capability. Missed records remain inert until an explicit Run now
request.

The built-in chat adapter uses its normal send path. A terminal adapter needs a one-time
grant captured while a recognized assistant is visibly waiting; terminal activity revokes
the grant. Adapter IDs and capabilities are stable and validated. Registration does not
confer filesystem, command, network, or arbitrary IPC capabilities.

Automatic continuation is narrower still. It is opt-in, accepts only a recognized terminal
assistant and an unambiguous usage/rate-limit message with an explicit retry delay, records
the terminal generation, sends only the literal `continue`, and enforces retry and deadline
caps. Changed or ambiguous state cancels it. Closing ADCode destroys every timer; startup
recovery never sends pending input.

## Inline completion boundary

Inline completion uses a tool-free provider request with a 128-token maximum output. IPC
accepts bounded prefix/suffix text and language metadata only; no path is sent. Renderer
context is capped at 6,000 prefix and 2,000 suffix characters. A generation/version check
and abort signal prevent stale results from appearing after edits.

Both renderer and main process refuse common credential filenames, and empty or concurrent
chat states fail closed. The returned text is normalized and displayed as a Monaco inline
proposal; it has no file-write authority and requires normal editor acceptance.

## Persistence, traces, and cleanup

Task and Team JSON records use write-then-rename atomic replacement. Operational traces are
append-only JSON Lines and are observability, never authority. Trace failure cannot turn a
refused action into an allowed one. Common credential forms are redacted before persistence.

Restart recovery changes transient task, team, and node states to paused without starting a
provider, command, terminal action, or network request. Invalid task/team records and partial
trace lines are skipped independently.

Retention removes eligible terminal sandboxes oldest first. Active work is never removed,
and applied tasks retain the only checkpoint needed for rollback. Quota exhaustion refuses
new work before allocation rather than weakening containment.

## Non-goals and remaining boundary work

The feature does not expose model chain of thought, execute arbitrary scheduled terminal
text, run background work while the app is closed, or grant external adapters implicit
project authority. Workspace command/network permissions remain false. Binary patching,
remote trace synchronization, and exporting checkpoints require separate threat models
before implementation.
