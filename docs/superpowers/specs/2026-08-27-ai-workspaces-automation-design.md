# AI Workspaces, Automation, and Human-Safe Collaboration

**Date:** 2026-08-27  
**Status:** Approved design  
**Product:** ADCode desktop IDE

## Summary

ADCode will remain a complete, conventional IDE for human developers while gaining a
provider-neutral AI workspace that makes agents faster, less expensive, observable, and
safe. AI work happens in isolated sandboxes, can be divided among several agents, and
reaches the user's workspace only through a tested merge and a durable rollback checkpoint.

The feature extends ADCode's current AI, memory, terminal, Git, settings, history, and
breadcrumb systems. It does not replace the workbench, create a separate visual language,
or remove any existing feature. Every new surface must use the current iOS-inspired design
system, themes, motion curves, keyboard conventions, and accessibility behavior.

ADCode may suggest a multi-agent team when parallel work is likely to help, but it never
starts extra agents without confirmation. Model routing may be automatic, manual, or
constrained by user policy. Trusted mode may apply passing file changes automatically, but
sensitive and externally consequential actions always require explicit approval.

Scheduled prompts and automatic continuation work only while ADCode is open. They support
the built-in agent and external agents that expose a reliable API, MCP connection, or known
terminal adapter. ADCode never types blindly into an unknown process.

## Context and baseline

The current workbench already has a floating chat widget, provider-neutral model support,
tool traces, inline diff review, terminal-agent detection, shared project memory, local file
history, Git operations, and navigable breadcrumbs. Those are the foundations of this
design.

Before implementation begins, the core `packages/` modules deleted in checkpoint
`11ca5214d` must be restored from that checkpoint's parent. Restoration is recovery of the
existing product, not a redesign. The restored baseline must pass the repository's existing
verification and smoke checks before new AI workspace behavior is added.

## Goals

1. Preserve normal human coding as the primary, always-available workflow.
2. Prevent AI changes from corrupting or unexpectedly overwriting the active workspace.
3. Reduce token use by retrieving focused context, sharing findings, and routing work to
   appropriately priced models.
4. Let several agents collaborate on one task without duplicating work or silently
   conflicting.
5. Make agent actions, costs, tests, permissions, and outcomes legible to users.
6. Support scheduled prompts and safe continuation across provider usage-limit pauses while
   ADCode remains open.
7. Let users review, trust, accept, reject, and roll back AI work at useful levels.
8. Make file location and switching faster through interactive breadcrumbs.
9. Preserve ADCode's current appearance, features, privacy posture, and editing performance.

## Non-goals

- Running scheduled work while ADCode is closed.
- Controlling arbitrary third-party extensions that expose no integration interface.
- Exposing or claiming to expose private model chain-of-thought.
- Giving trusted mode authority over secrets, destructive commands, deployments,
  publishing, payments, external messages, or network writes.
- Replacing the workbench with an AI-first interface.
- Locking files against human edits while an agent works.
- Adding a general extension host or `.vsix` compatibility.

## Product invariants

- Typing, saving, terminal input, startup, Git, debugging, and navigation must work when the
  AI layer is disabled, offline, rate-limited, crashed, or restoring state.
- No AI activity may run on the keystroke-to-paint critical path.
- Existing features and current visual behavior remain present unless a separately approved
  design explicitly changes them.
- The renderer is untrusted. Filesystem, process, Git, credential, sandbox, and permission
  enforcement stay in the Electron main process.
- Agent output is untrusted input and is validated at every privileged boundary.
- No extra agent starts without a human confirming the Team-mode suggestion or starting it
  manually.
- Every change applied to the human workspace has a durable pre-apply checkpoint.

## User experience

### Normal mode

The workbench looks and behaves as it does today. The user edits, runs, debugs, searches,
uses Git, and opens the current chat widget without seeing a permanent AI dashboard. New AI
surfaces appear only when invoked, when a task is active, or when ADCode has a useful
Team-mode suggestion.

### Team-mode suggestion

When a prompt appears to contain independent work, span several subsystems, require a
separate tester or reviewer, or exceed the configured context budget, ADCode shows a quiet,
dismissible suggestion card. The card states:

- why parallel work may help;
- the proposed roles and task split;
- likely files or subsystems;
- estimated sequential and parallel duration;
- estimated token and cost ranges.

Accepting opens a configuration sheet. The user may change roles, models, budgets,
permissions, concurrency, or acceptance criteria before starting. Dismissing does not
degrade the single-agent path.

The first suggestion is deterministic and local: repository structure, task wording,
dependency boundaries, required test phases, and current context size. A cheap model may be
consulted only when those signals are inconclusive and the user's routing policy permits it.

### Task board

The task board is a floating sheet, not a permanent panel. It shows the task graph,
dependencies, assigned agent, current phase, file claims, budget, tests, blockers, and merge
status. The default view is compact. Details expand on demand.

Agents coordinate file claims with one another. A claim never prevents a human from editing
that file. If the human changes a claimed file, the agent's task records the new base and
the merge stage handles it explicitly.

### Trace timeline

The trace is an operational event timeline with one lane per agent. It records:

- agent, provider, and model;
- task and dependency status;
- files read or changed;
- tools and commands;
- permission requests and decisions;
- tests and outcomes;
- token and cost usage;
- checkpoints, pauses, and continuations;
- errors and recovery actions.

Entries are collapsed to a one-line summary by default. They expose provider-supplied
reasoning summaries only when the provider intentionally supplies them; ADCode does not
present hidden chain-of-thought as a feature. Traces remain local and can be searched or
exported as a human-readable report and structured JSON.

### Budget display

The active task shows a compact token/cost indicator. Its popover separates estimates from
actual usage, explains routing decisions, and shows each agent's allowance and reserve.
Warnings occur before a soft limit. A hard limit pauses new model requests while preserving
the sandbox and task state.

### Trusted mode

Review mode is the default. Trusted mode is enabled per task or by an explicit scoped
preference. It may apply sandboxed file changes automatically only after the configured
tests pass and the merge base still matches.

Trusted mode pauses instead of applying when:

- tests fail or cannot run;
- the human changed an overlapping region;
- a file falls outside the allowed workspace scope;
- a budget or continuation limit is reached;
- an action requires elevated permission;
- an adapter's state is ambiguous.

Trusted file editing never implies trust for secrets, destructive commands, deployments,
publishing, payments, external messages, or network writes.

### Interactive breadcrumbs

The existing breadcrumb row becomes a complete location and switching control:

`workspace › directory › subdirectory › file › class › method`

- A directory crumb opens its children and sibling directories.
- The file crumb opens searchable sibling files, recent files, and quick open.
- A symbol crumb shows nearby and nested symbols.
- Arrow keys traverse levels and typing filters the open menu.
- Hover and Copy Path expose the full absolute path.
- Context actions include rename, reveal, copy path, split open, and compare.
- File-changing actions use the same validation, confirmation, and path-safety rules as the
  explorer.

## Visual design and accessibility

New UI uses the existing semantic tokens and current light, dark, Midnight, system-accent,
comfortable, and compact modes. It uses the same translucent material, hairline borders,
corner radii, typography, spacing, icon geometry, and elevation levels already present in
the workbench.

Team suggestions are quiet cards. Task configuration and scheduling use inset-grouped
sheets. Traces use disclosure rows. Budgets use a compact progress bar or ring with detail
in a popover. Checkpoints follow the existing history and Git visual language. Breadcrumb
menus reuse existing glass popovers and file icons.

Motion uses existing spring-like entry and short ease-in exit curves. Only transforms and
opacity animate. Reduced-motion mode removes movement while keeping all state changes
legible. AI surfaces must avoid the caret, completion list, diagnostics hover, and critical
editor controls.

Every action is keyboard reachable, has visible focus, supports screen readers, and uses
the existing minimum pointer target size. Status is never conveyed through color alone.

## Architecture

### Pure domain layer

Restore and extend `packages/ai` for provider-neutral messages, models, agent events,
adapters, usage reporting, and agent-loop behavior. Add focused pure modules for:

- task graphs and file claims;
- Team-mode suggestion scoring;
- budget reservation and accounting;
- routing policy;
- schedule calculation;
- continuation policy;
- permission decisions;
- trace event shapes;
- checkpoint manifests.

These modules receive clocks, pricing, provider capabilities, and filesystem facts as data.
They do not access Electron, the DOM, the network, the filesystem, or environment variables.

If the combined domain becomes too large for `packages/ai`, extract a narrow
`packages/automation` package rather than allowing one oversized module. Extraction must not
create a second provider abstraction.

### Main-process orchestration

The Electron main process owns:

- task and schedule persistence;
- sandbox creation and cleanup;
- Git worktrees and shadow copies;
- agent process and provider lifecycle;
- token/cost metering;
- command and network permissions;
- merge queues and test execution;
- checkpoints and rollback;
- terminal adapter input/output;
- crash recovery;
- renderer event streaming through typed, allowlisted IPC.

The renderer may request operations and display events. It cannot construct arbitrary
filesystem paths, commands, environment variables, or permission grants.

### Renderer surfaces

Renderer additions remain focused adapters around domain state:

- Team-mode suggestion card;
- task configuration sheet;
- task board;
- multi-lane trace timeline;
- budget popover;
- schedule sheet and upcoming list;
- checkpoint timeline and rollback comparison;
- enhanced breadcrumb menus.

They reuse existing primitives and do not introduce another component system.

## Core data model

Every task has a stable ID and contains:

- workspace identity and immutable starting checkpoint;
- prompt, acceptance criteria, and required tests;
- mode: single-agent or team;
- review policy: review or trusted;
- task graph and agent assignments;
- routing and privacy policy;
- token/cost budget and usage ledger;
- permission profile and individual grants;
- sandbox and merge state;
- trace stream location;
- checkpoint and rollback metadata;
- schedule and continuation metadata when applicable.

A trace is append-only. Derived indexes and summaries are rebuildable. Budget usage is
recorded from provider-reported values when available and conservatively estimated
otherwise. Estimates are labeled and never represented as provider invoices.

## Sandbox lifecycle

1. Capture the human workspace's Git state and unsaved buffer metadata.
2. Create a durable starting checkpoint.
3. Create one isolated Git worktree per agent at that checkpoint.
4. For non-Git projects, create a copy-on-write shadow workspace.
5. Reuse a read-only dependency cache or platform-appropriate directory link where safe;
   install inside the sandbox when reuse is unavailable.
6. Grant each agent only its sandbox path and approved capabilities.
7. Collect proposals in a separate review sandbox.
8. Merge non-conflicting changes and present conflicts as a three-way comparison.
9. Run required tests on the combined result.
10. Apply through review or trusted mode after rechecking the human workspace base.
11. Keep the final sandbox until checkpoint retention permits cleanup.

Sandboxes live under ADCode's application-data directory rather than inside the opened
project. A disk quota and retention policy are configurable. Cleanup removes expired
sandboxes before checkpoints and always warns before deleting the last rollback source for
an applied task.

## Checkpoints and rollback

Git projects use hidden ADCode references plus manifests for tracked, untracked, and dirty
state. Hidden references do not clutter the user's visible branch history. Non-Git projects
store the affected originals and manifests in application data.

Rollback is three-way, not blind replacement. It can revert one applied change, one agent,
one complete task, or restore a checkpoint. Human edits made after application are
preserved when they do not overlap. Overlaps open a comparison requiring a decision.

Checkpoint retention defaults to a time and disk limit, is visible in settings, and never
silently deletes the only rollback point for an active or recently applied task.

## Model routing and context efficiency

### Modes

- **Automatic:** choose the least expensive suitable model from available providers.
- **Manual:** the user chooses provider and model per agent or task.
- **Hybrid:** the user declares allowed providers, local-only rules, preferred models,
  privacy constraints, and price ceilings; ADCode routes within them.

Manual selection always overrides an automatic recommendation. Automatic routing records
its reason in the trace.

### Context controls

- Retrieve relevant files and symbols rather than scanning the entire tree for every turn.
- Hash file content and avoid retransmitting unchanged context.
- Share investigation notes and completed-task summaries among agents.
- Use provider prompt caching when available.
- Summarize old conversation segments before they crowd out current work.
- Prefer local or inexpensive models for classification, search assistance, summaries, and
  formatting.
- Escalate to stronger models only when the task or failed attempts justify it.
- Record dead ends in the shared task state so another agent does not repeat them.

### Budget enforcement

The coordinator reserves tokens before starting a request so concurrent agents cannot each
consume the remaining allowance. Provider-reported usage settles the reservation; a
conservative estimate settles it otherwise. A hard budget admits no new request that could
exceed the remaining allowance plus the explicitly configured reserve.

## Agent coordination and merge queue

The task graph is the source of truth. A node defines its inputs, outputs, acceptance
criteria, dependencies, assigned role, file claims, and tests. Only dependency-ready nodes
may run.

Agents publish compact handoffs and artifacts to the graph. File claims warn the
coordinator about likely conflicts but do not function as locks. The merge queue combines
completed nodes in dependency order and reruns affected tests after each integration point
when the risk policy requires it.

Team concurrency defaults conservatively and is capped by settings, provider limits, and
the task budget.

## Scheduling

A schedule specifies:

- workspace and prompt;
- target agent or routing policy;
- one-time or recurring time rule;
- token/cost budget;
- permission profile;
- review or trusted mode;
- required tests;
- maximum continuation count and deadline.

Schedules execute only while ADCode is open. Closing the application pauses active work at
the latest durable checkpoint. On reopening, active work returns paused with its sandbox,
trace, budget, and pending approvals intact.

A missed one-time run is marked missed and requires confirmation. A recurring schedule
advances to its next future occurrence and offers the missed run separately; it never emits
a launch backlog at startup.

## Automatic continuation

Continuation occurs only when the stop has a reliable, adapter-specific meaning such as a
provider response with a reset timestamp or a recognized terminal usage-limit prompt. The
task retains its sandbox, trace, compact context handoff, and remaining budget.

Continuation stops on completion, hard budget, deadline, maximum retries, repeated test
failure, conflict, permission request, unknown reset time, unavailable target, or ambiguous
terminal state.

For a known terminal agent, its adapter parses the command and output state and controls
input only while it owns the session. An unsupported process is observational only. A user
may explicitly configure an adapter to start a known CLI when a scheduled task targets no
active session; the saved launch command is validated and uses the schedule's permission
profile.

## Adapter contract

The common adapter reports:

- identity and capabilities;
- connection and prompt state;
- supported models where applicable;
- structured events and usage;
- pause, limit, reset, completion, and refusal signals;
- ability to send a prompt, cancel, or resume;
- whether safe automatic continuation is supported.

Built-in providers, supported terminal agents, MCP connections, and compatible APIs use
this contract. Missing capabilities disable the related control rather than being guessed.

## Permissions and security

Permission presets are read-only, edit sandbox, run safe commands, network read, and
custom. A grant is scoped to one action, current task, or a validated command pattern.

The following always require explicit approval:

- secrets or credential stores;
- destructive filesystem or Git operations;
- deployment, release, publishing, and package publication;
- payments or financial operations;
- external messages or account changes;
- network writes;
- broad access outside the sandbox or workspace.

All paths are resolved and checked in one filesystem domain before use. Commands use argv
arrays instead of shell interpolation whenever possible. Environment variables are
allowlisted. Trace export redacts secrets and sensitive environment values.

## Persistence and privacy

Task metadata, schedules, traces, checkpoints, and sandbox records remain local under
ADCode's application-data directory, keyed by a non-secret workspace identity. Project
knowledge continues to use the existing human-readable memory store. Large trace and
sandbox files never enter the project repository unless the user explicitly exports them.

Crash recovery restores tasks as paused. No model request, terminal input, or command runs
merely because ADCode restarted.

## Error handling

- Provider failure pauses only its agent and leaves the editor responsive.
- Worktree failure falls back to shadow-copy isolation when safe.
- Sandbox disk pressure removes expired sandboxes first and surfaces a storage action.
- Human/AI overlap opens a three-way comparison.
- Failed or missing tests block trusted application.
- An unavailable scheduled target remains pending or missed according to its schedule.
- An unknown usage-limit response requires user action instead of speculative retry.
- Trace index corruption rebuilds from append-only events.
- Checkpoint corruption blocks application and preserves the review sandbox.
- IPC validation failure returns a scoped error and records no partial permission grant.

## Settings

New settings cover:

- automatic, manual, or hybrid routing;
- preferred and forbidden providers;
- local-model preference;
- task token and cost limits;
- Team-mode suggestions and maximum concurrency;
- review and trusted defaults;
- sandbox disk quota and retention;
- checkpoint retention;
- automatic continuation and retry caps;
- terminal adapters;
- schedules;
- trace retention and export.

Each major capability has an independent switch. Defaults are conservative: suggestions on,
single agent until confirmed, review mode, scoped permissions, and no automatic terminal
launch.

## Testing strategy

### Pure and property tests

- Task graph readiness, cycle detection, and file-claim conflict reporting.
- Team suggestion thresholds and dismissal behavior.
- Routing under provider, privacy, capability, and price constraints.
- Budget reservation and settlement; no event sequence may exceed a hard limit.
- Schedule next-run and missed-run behavior across time zones and daylight-saving changes.
- Continuation caps and stop conditions.
- Permission decisions and irreversible-action boundaries.
- Path generation; arbitrary input may never escape a sandbox root.
- Breadcrumb menu construction and symbol/file navigation.

### Integration tests

- Temporary Git repositories for worktree creation, merge queues, checkpoint refs, dirty
  files, untracked files, concurrent human edits, conflicts, and rollback.
- Non-Git shadow workspaces and cleanup.
- Fake providers for usage reporting, rate limits, reset times, refusals, cancellation, and
  recovery.
- Terminal transcript fixtures for each supported adapter, including ambiguous prompts that
  must not auto-continue.
- Schedule persistence and restart into a paused state.
- Typed IPC refusal of malformed paths, commands, grants, and trace events.

### Renderer and accessibility tests

- Keyboard navigation, focus restoration, screen-reader labels, and reduced motion.
- All themes and density modes.
- Widget collision avoidance around editor overlays.
- Trace expansion, budget warnings, schedule review, and rollback comparisons.

### Packaged smoke tests

On each supported platform:

1. Open a repository and continue editing normally.
2. Start a single-agent sandboxed task.
3. Accept a Team-mode suggestion and run independent agents.
4. Merge, test, review, and apply the combined result.
5. Change an overlapping line as a human and verify conflict protection.
6. Apply in trusted mode after passing tests.
7. Roll back the task without losing a later human edit.
8. Schedule a prompt, close ADCode, reopen, and verify it is paused or missed rather than
   executed in the background.
9. Simulate a provider limit and verify safe continuation.
10. Switch files from breadcrumbs using keyboard-only interaction.

### Performance gates

- AI work may not regress the existing keystroke-to-paint target.
- Task restore and trace indexing stay off the first-paint path.
- Large traces virtualize their rows.
- Repository indexing is incremental and cancellable.
- Sandbox creation reports progress and never freezes the renderer.

## Scope and milestone decomposition

This is an umbrella design, not one monolithic implementation plan. It defines the shared
contracts and invariants that keep separately delivered subsystems compatible. Work is
divided into the following ordered milestones, each with its own implementation plan,
verification commands, review, and rollback point:

1. **Baseline recovery:** restore the deleted core packages, reconcile them with the
   checkpointed platform changes, and re-establish green verification, packaging, and smoke
   tests without changing product behavior.
2. **Safe single-agent workspace:** implement the task model, permissions, budgets,
   checkpoints, sandboxes, merge review, and rollback for one built-in agent.
3. **Efficient Team mode:** add suggestion scoring, task graphs, file claims, model routing,
   shared context, multi-agent traces, and the merge queue.
4. **Trusted application:** add passing-test gates, overlap detection, durable automatic
   application, granular rollback, settings, accessibility, and packaged smoke coverage.
5. **Automation and adapters:** add schedules, missed-run review, quota-aware continuation,
   and built-in, terminal, MCP, and API adapter contracts.
6. **Human navigation:** enhance breadcrumbs and complete interaction, theme, performance,
   and cross-platform verification.
7. **Documentation and release:** complete user and developer documentation, remediate the
   release-readiness findings, stage the release, verify rollback, and deploy.

A later milestone may rely only on a tested public contract from an earlier one. No
milestone may add a visible control whose behavior is deferred to a later milestone, weaken
the product invariants, or silently remove an existing feature. A milestone may ship behind
an off-by-default setting when its full end-to-end path is complete.

The next planning step after this umbrella design is approved is Milestone 1, baseline
recovery. Feature implementation starts only after that baseline is green, giving every
later test result a trustworthy reference point.

## Documentation deliverables

Documentation is part of implementation, not a follow-up note. Before deployment, update:

- the main README feature and status tables;
- the build brief where it describes the AI layer, navigation, testing, and definition of
  done;
- user help for Team mode, budgets, trusted mode, schedules, continuation, traces,
  checkpoints, rollback, and breadcrumbs;
- settings descriptions and onboarding;
- developer architecture documentation for adapters, sandbox boundaries, task persistence,
  IPC, and security assumptions;
- deployment and rollback runbooks;
- release notes and changelog.

Every documented capability must be backed by a working control and automated or manual
verification step.

## Deployment and release gates

Deployment is required after implementation, but it is not permitted until all applicable
gates pass:

- restored baseline and new tests are green;
- typecheck, dependency firewall, full tests, web production build, packaging, and packaged
  smoke tests pass;
- production dependency advisories are resolved or explicitly risk-accepted;
- no critical or high known defect remains;
- migrations are backed up and tested in staging;
- feature defaults and rollback switches are verified;
- Windows signing and macOS signing/notarization are configured for public desktop release,
  or an explicitly approved limited unsigned preview is labeled as such;
- the custom domain and published support addresses work;
- payment and payout test-mode flows pass before real-money enablement;
- legal review is complete for public terms and privacy claims;
- a GitHub release contains installers, update metadata, checksums, release notes, and
  rollback instructions;
- staging smoke tests pass before production deployment;
- production monitoring and rollback triggers are defined before rollout.

Roll out new AI capabilities behind settings flags, start with a preview cohort, observe
crashes, failed tasks, rollback rate, cost-estimate accuracy, and editor performance, then
expand. A desktop rollback uses the previous signed release and update metadata. A web/API
rollback uses the previous Cloudflare deployment and compatible database migrations.

## Acceptance criteria

- ADCode's current appearance and every existing feature remain available.
- A human can edit normally while several agents work on one task in isolated sandboxes.
- Team mode is suggested with rationale and cost, but never starts without confirmation.
- Users can choose automatic, manual, or constrained model routing.
- Hard token/cost limits cannot be exceeded by concurrent agents.
- Traces show actions, files, commands, tests, permissions, usage, and outcomes without
  exposing hidden reasoning.
- Review mode and trusted mode both create durable rollback checkpoints.
- Trusted mode cannot perform sensitive or externally consequential actions without
  approval.
- Scheduled prompts work for supported built-in and external adapters only while ADCode is
  open.
- Missed schedules require confirmation and never create a startup backlog.
- Supported agents resume safely after recognized usage limits without the user typing
  "continue."
- Unknown terminal processes never receive automatic input.
- Breadcrumbs show location and permit fast file and symbol switching.
- AI failures do not degrade normal editing or startup.
- User, developer, deployment, rollback, and release documentation is complete before
  deployment.
- All release gates pass before the production rollout.
