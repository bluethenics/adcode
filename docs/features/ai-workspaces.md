# AI workspaces and efficient coding

ADCode keeps normal human editing at the center of the product while giving AI assistants
safe places to work. The built-in assistant can prepare changes in isolation, several
confirmed agents can cooperate on one task, and a user can inspect or roll back everything
that reaches the open project.

## Safe edits by default

The first AI file operation for a project creates a private task workspace. A clean Git
repository uses a detached worktree at the current commit; a dirty or non-Git folder uses a
shadow copy. Neither method changes the user's branch or index.

The task strip in chat shows state, changed files, and reserved tokens. Choose **Review** to
accept individual files or hunks, **Trace** for the local operational timeline,
**Discard** to remove a proposal, or **Roll back** after apply. Applying is all-or-nothing:
if a human or another tool changed any selected file since the task started, ADCode stops
before the first write.

Unsaved editor recovery drafts block AI file tools. Save those buffers first so the model
cannot work from an older on-disk version. Ordinary question-only chat remains available.

## Review and Trusted modes

**Review every change** is the default. It provides hunk-by-hunk control before a proposal
reaches the project.

**Trusted auto-apply** is an opt-in setting. Enabling it requires confirmation. Trusted does
not give a model direct filesystem authority: the turn still runs in a sandbox, ADCode still
checks for overlapping changes, and a durable rollback checkpoint is written before the
exact proposal is applied. Switch back to Review at any time; new tasks use the selected
policy. A rollback stops instead of overwriting later human edits.

## Team mode

ADCode can locally suggest Team mode when a task appears to contain independent work. The
suggestion explains why, proposes roles, and estimates time and tokens. A suggestion never
starts a model request. Choose **Not now** to continue with one agent, or use **Team** beside
the composer to request it yourself.

Choose **Set up Team**, inspect the roles, and then choose **Start Team**. Only that final
confirmation may create agent workspaces or contact providers. The current implementation:

- gives every role its own isolated child workspace from one immutable project base;
- runs at most two roles concurrently;
- routes each role to a connected, tool-capable model within the confirmed policy;
- reserves from one hard parent token budget before concurrent requests;
- passes compact findings and changed-path handoffs instead of full agent transcripts;
- treats file claims as coordination warnings, never as locks on human editing;
- merges deterministic, non-overlapping proposals into one ordinary review task;
- stops on overlapping changes and shows conflicts instead of silently choosing a winner;
- exposes per-agent operational trace lanes, usage, progress, review, and cancellation.

The combined proposal reaches the project only through the same checkpointed apply and
rollback boundary as a single-agent task. Price information is an estimate when a provider
publishes comparable pricing, never an invoice.

## Scheduled messages

Write a prompt in chat and choose **Schedule**. Select a supported target and a local time.
Schedules are durable one-time local records, but delivery happens only while ADCode is
open, scheduled messages are enabled, the same project is open, and the target adapter is
available.

Built-in chat is supported. A compatible adapter can register the same explicit scheduled-
prompt capability. A detected terminal assistant requires **Allow next schedule** while its
prompt is visibly idle; that permission is single-use and any later terminal activity
removes it. ADCode never types into an unknown terminal process.

If the app, project, setting, or adapter is unavailable at the delivery time, the item is
marked missed. It does not create a startup backlog or run by itself later. Choose **Run
now** to deliver a missed item deliberately.

## Safe terminal continuation

**Continue terminal AI after limits** is off by default. When enabled, ADCode watches only
output already visible in its built-in terminal. A recognized assistant must report a clear
usage or rate limit and an explicit retry delay before ADCode schedules the literal message
`continue`.

Unknown reset times, ambiguous output, changed terminal state, closing ADCode, or disabling
the setting cancels the continuation. Repeated limits may continue only up to the selected
cap (1, 3, or 5; default 3). This is not a general terminal macro and it never runs while
ADCode is closed.

## Inline AI suggestions

AI ghost text is enabled by default and is separate from Monaco, language-server, keyword,
and path suggestions. ADCode requests a short completion after an idle pause without
blocking typing. Press **Tab** to accept, keep typing to ignore it, or press **Alt+\\** to
request **Suggest Code with AI** yourself.

The request contains only bounded text around the cursor (up to 6,000 prefix characters
and 2,000 suffix characters), language information, and a small output allowance. It does
not include the file path. A buffer change or newer request cancels stale work. Suggestions
are skipped for common credential files such as `.env*`, private keys, credential/secret
files, `.npmrc`, and `.netrc`.

## Interactive file location

The editor path trail now shows workspace, folders, file, and code symbols in the existing
workbench. Select a segment to search nearby locations: folders show children and siblings,
the file segment shows sibling and recent files plus Quick Open, and symbol segments list
the current file's structure.

Use Left and Right Arrow to move between levels, Down Arrow or Enter to open a level, type
to filter, and Enter to select. The file menu also exposes **Copy full path**, **Reveal**,
**Rename**, **Structure**, **Compare**, and **History**. Hovering reveals the absolute path;
the compact bar does not permanently spend editor space on it.

## Budgets, storage, and traces

The task token budget is a hard pre-request reservation: 25k, 100k (default), or 250k.
ADCode pauses before a request would cross it. Team reservations are atomic at the parent
level so parallel agents cannot each spend the same remaining allowance.

Sandbox storage defaults to 5 GB, with 1/5/10 GB choices. Finished sandboxes default to
seven-day retention and rollback checkpoints to 30 days. Cleanup never removes active work
or the only usable rollback checkpoint. If there is no safe room, ADCode refuses a new task
with an explanation.

Trace means an operational event log: task states, agents, routes, files, reservations,
checks, proposals, merges, applies, refusals, errors, and rollback. It deliberately does not
expose or claim to expose a provider's private chain of thought. Common credential shapes
are redacted, traces remain local, and provider cost is omitted when trustworthy pricing is
unavailable.

## Recovery and privacy

On restart, active tasks and teams become paused. ADCode never silently restarts a provider,
terminal action, schedule, or command after a crash. Corrupt records and incomplete final
trace lines are isolated so one bad entry does not hide other tasks.

Tasks and teams live below Electron's local ADCode user-data folder. Absolute workspace,
sandbox, and checkpoint roots stay in the main process and are not returned to renderer
task views. Traces and sandboxes are not uploaded. Source text intentionally sent to a
selected provider remains subject to that provider's normal request path and privacy policy.

## Current boundaries

AI workspace edits are text-only. Team mode currently uses built-in provider agents and a
conservative fixed concurrency limit; compatible scheduling adapters do not automatically
gain file or command authority. Commands and network permissions remain off in the
workspace task model. Scheduling and automatic continuation require the desktop app to stay
open.
