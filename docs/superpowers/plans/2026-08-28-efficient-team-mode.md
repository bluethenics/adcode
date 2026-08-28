# Efficient Team Mode Implementation Plan

> Execute this milestone in small test-first commits. Do not start an additional model
> request until a user has confirmed a complete team configuration.

**Goal:** Let a user split one coding task among several isolated built-in agents, share
compact findings instead of duplicate context, merge their proposals deterministically,
and review the combined result through the existing safe apply boundary.

**Architecture:** Add pure team planning, graph, routing, claim, handoff, and budget modules
to `packages/ai`. Persist one parent team record in the Electron main process and allocate
one existing safe workspace service task per agent. A coordinator starts dependency-ready
agents up to a conservative concurrency cap, collects structured handoffs, and builds one
combined review task. Renderer surfaces remain a quiet suggestion inside the current chat
widget plus on-demand configuration and task-board sheets.

**Invariants:** Suggestions are local and deterministic. Dismissal preserves single-agent
behavior. No extra provider request starts before explicit confirmation. Each agent gets
its own sandbox. Claims warn and schedule; they never lock human editing. Concurrent budget
reservations are atomic at the parent team ledger. Provider prices are optional estimates,
never invoices. All human-workspace writes still pass the Milestone 2 overlap, checkpoint,
review, and rollback service.

## Task 1: Define team plans and deterministic suggestions

**Files:**

- Create: `packages/ai/src/team.ts`
- Modify: `packages/ai/src/index.ts`
- Create: `packages/ai/test/team.test.ts`

**Steps:**

1. Write failing tests for bounded role/node IDs, acceptance criteria, dependencies, agent
   assignments, and conservative defaults.
2. Add local suggestion scoring from task wording, requested tests/review, independent
   subsystems, file hints, and estimated context size.
3. Require a useful rationale, proposed roles, estimated sequential/parallel work, and
   token range before a suggestion can be shown.
4. Make dismissal keys stable for the prompt and workspace, without storing prompt text in
   the key.
5. Prove simple/small prompts stay single-agent and ambiguous signals never consult a model.
6. Run `npx vitest run packages/ai/test/team.test.ts` and commit.

## Task 2: Implement task graphs, claims, and compact handoffs

**Files:**

- Create: `packages/ai/src/teamGraph.ts`
- Modify: `packages/ai/src/index.ts`
- Create: `packages/ai/test/teamGraph.test.ts`

**Steps:**

1. Write failing tests for cycle detection, missing dependencies, dependency readiness,
   failure blocking, deterministic ordering, and terminal graph state.
2. Add advisory file claims with exact-path and directory-prefix overlap reporting.
3. Reject lexical traversal, absolute paths, duplicate claims, and contradictory exclusive
   claims at configuration time.
4. Add compact handoffs containing findings, decisions, changed paths, tests, blockers, and
   dead ends, all with size/count limits.
5. Build the next-agent context from the original task, dependency handoffs, and relevant
   claims—not another agent's full transcript.
6. Add property-style hostile-input cases and commit after focused tests pass.

## Task 3: Add provider routing and parent-level budget reservations

**Files:**

- Modify: `packages/ai/src/catalogueTypes.ts`
- Modify: `packages/ai/src/catalogue.ts`
- Modify: `scripts/catalogue.mjs`
- Regenerate: `packages/ai/src/catalogueSnapshot.ts`
- Create: `packages/ai/src/routing.ts`
- Create: `packages/ai/src/teamBudget.ts`
- Modify: `packages/ai/src/index.ts`
- Modify: `packages/ai/test/catalogue.test.ts`
- Create: `packages/ai/test/routing.test.ts`
- Create: `packages/ai/test/teamBudget.test.ts`

**Steps:**

1. Preserve optional upstream input/output/cache prices as microdollars per million tokens;
   validate all network catalogue values and label absent prices unknown.
2. Test automatic, manual, and hybrid routing across connected state, tool capability,
   reasoning need, local-only policy, allowed/forbidden providers, preferred models, and
   price ceilings.
3. Automatic routing chooses the least expensive suitable connected candidate only when
   comparable prices exist; otherwise it uses a deterministic capability/preference order
   and records that price was unknown.
4. Manual routing is exact and always wins when valid. Hybrid routing never escapes the
   user's provider/privacy constraints.
5. Implement a pure reservation ledger with reservation IDs, settle/release operations,
   per-agent allowances, and a team hard limit. Prove arbitrary interleavings cannot admit
   more than the limit.
6. Regenerate the catalogue, run focused tests, and commit.

## Task 4: Persist durable parent team records

**Files:**

- Create: `apps/desktop/src/main/aiTeamStore.ts`
- Create: `apps/desktop/test/aiTeamStore.test.ts`

**Steps:**

1. Write failing tests for atomic JSON replacement, per-workspace listing, schema/corruption
   isolation, trace append order, and bounded record identifiers.
2. Persist configuration, graph/node state, child workspace task IDs, routes, claims,
   handoffs, team ledger, merge state, and confirmation time under
   `<userData>/ai-teams/<team-id>`.
3. Store operational events as append-only JSONL with team and agent lane IDs.
4. On restart, change active parent/nodes to paused without starting providers or child
   workspaces.
5. Hash workspace identity; keep privileged roots main-process-only.
6. Run focused tests and commit.

## Task 5: Create one isolated child workspace per agent

**Files:**

- Modify: `apps/desktop/src/main/aiWorkspaceService.ts`
- Modify: `apps/desktop/src/main/aiSandbox.ts`
- Create: `apps/desktop/src/main/aiTeamService.ts`
- Modify: `apps/desktop/test/aiWorkspaceService.test.ts`
- Create: `apps/desktop/test/aiTeamService.test.ts`

**Steps:**

1. Add an optional immutable Git revision/source snapshot to sandbox creation so all child
   workspaces begin from the same base even if agents start at different times.
2. For non-Git workspaces, create one durable base shadow snapshot and copy children from
   it rather than repeatedly reading a changing human workspace.
3. Allocate child workspace tasks only after the confirmed parent record is durable.
4. If any allocation fails, pause the parent, keep successful children registered for
   review/cleanup, and never fall back to the human workspace.
5. Enforce team concurrency and storage quota without deleting active child sandboxes.
6. Test clean Git, dirty Git, non-Git, human edits during allocation, restart, and cleanup.
7. Commit after focused integration tests pass.

## Task 6: Build the merge queue and combined review task

**Files:**

- Create: `packages/ai/src/teamMerge.ts`
- Create: `packages/ai/test/teamMerge.test.ts`
- Modify: `apps/desktop/src/main/aiTeamService.ts`
- Modify: `apps/desktop/test/aiTeamService.test.ts`

**Steps:**

1. Write pure tests for dependency-order merge planning, disjoint files, compatible hunks,
   same-file overlap, delete/edit conflicts, invented output paths, and deterministic
   results independent of agent completion timing.
2. Treat claims as warnings; the actual merge compares each child proposal against the
   immutable team base.
3. Build a combined review sandbox/task without writing the human workspace.
4. Stop the queue on unresolved overlap and expose a three-way conflict record; do not
   choose one agent silently.
5. Route the combined task through the existing validated review/apply/checkpoint/rollback
   service.
6. Add all-or-nothing integration tests and commit.

## Task 7: Orchestrate confirmed agents and shared context

**Files:**

- Create: `apps/desktop/src/main/aiTeamCoordinator.ts`
- Create: `apps/desktop/test/aiTeamCoordinator.test.ts`
- Refactor: `apps/desktop/src/main/ai.ts` only where provider/tool factories need reuse

**Steps:**

1. Extract provider and sandbox-scoped tool-runner factories without changing single-agent
   behavior.
2. Use deterministic fake providers to prove no agent starts on suggestion or configuration
   alone; only the explicit `startConfirmed` operation may schedule nodes.
3. Start only dependency-ready nodes and never exceed configured concurrency or provider
   limits.
4. Atomically reserve the parent ledger before every provider request, then settle reported
   usage or retain the conservative estimate when usage is absent.
5. Feed agents only their role prompt, acceptance criteria, scoped file hints, and compact
   dependency handoffs. Record routes and reasons in operational traces.
6. Isolate provider failure to its node, cancel the whole team on request, and pause safely
   on budget, storage, conflict, or restart.
7. Commit after deterministic integration tests pass.

## Task 8: Expose a validated Team-mode IPC bridge

**Files:**

- Modify: `apps/desktop/src/shared/api.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Create: `apps/desktop/src/main/aiTeamIpcValidation.ts`
- Create: `apps/desktop/src/main/aiTeamViews.ts`
- Create: `apps/desktop/test/aiTeamIpcContract.test.ts`

**Steps:**

1. Define renderer-safe suggestion, configuration, graph, lane trace, claim, handoff,
   route, budget, conflict, and action views.
2. Validate counts, lengths, enums, graph dependencies, portable claims, model/provider IDs,
   concurrency, and budgets in the main process.
3. Scope every operation to the currently open workspace and redact absolute roots,
   credentials, raw provider payloads, and child sandbox IDs.
4. Expose suggest, dismiss, configure, start, pause, cancel, status, trace, merge, and open
   combined review methods only.
5. Prove malformed IPC cannot start agents, expand permissions, exceed budgets, or select an
   arbitrary task.
6. Commit after contract tests pass.

## Task 9: Add the quiet suggestion, configuration sheet, and task board

**Files:**

- Modify: `apps/desktop/src/renderer/ai/chatWidget.ts`
- Create: `apps/desktop/src/renderer/ai/teamViewModel.ts`
- Create: `apps/desktop/src/renderer/ai/teamSheet.ts`
- Modify: `apps/desktop/src/renderer/styles/ai.css`
- Create: `apps/desktop/test/aiTeamView.test.ts`

**Steps:**

1. Test labels, role/route summaries, graph progress, budget warnings, legal actions, and
   dismissal behavior as pure view-model functions.
2. Show a quiet dismissible suggestion only after local scoring. Explain why, proposed
   roles, time range, and token/cost estimate; never imply it has already started.
3. Accepting opens an inset-grouped configuration sheet for roles, models/routing,
   concurrency, per-agent/team budgets, claims, dependencies, and acceptance criteria.
4. Require a final **Start team** action. Restore focus on close; support Escape, visible
   focus, screen-reader labels, and keyboard reordering/navigation.
5. Add an on-demand compact task-board sheet with graph state, claims, blockers, tests,
   merge status, and one trace lane per agent.
6. Reuse current semantic tokens, glass materials, radii, density modes, and icon geometry.
   Animate only opacity/transform and remove movement under reduced motion.
7. Keep normal editing and the single-agent chat flow unchanged when Team mode is dismissed
   or disabled.
8. Commit after view tests and desktop build pass.

## Task 10: Add settings and in-app help

**Files:**

- Modify: `packages/settings/src/index.ts`
- Modify: `packages/settings/test/schema.test.ts`
- Modify: `packages/help/src/entries/ai.ts`
- Regenerate: `apps/web/src/lib/docsSeed.ts`

**Steps:**

1. Add conservative available settings: suggestions on, default concurrency 2, maximum 4,
   automatic/manual/hybrid routing, allowed providers, local preference, and default team
   budget.
2. Explain that suggestions never start agents, prices are estimates, claims are advisory,
   and each agent uses additional provider quota.
3. Validate settings before persistence and make disabling suggestions leave manual Team
   mode available.
4. Regenerate web help, run settings/help/docs-seed tests, and commit.

## Task 11: Documentation, review, and milestone verification

**Files:**

- Create: `docs/features/team-mode.md`
- Create: `docs/architecture/ai-team-coordination.md`
- Modify: `docs/features/ai-workspaces.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-27-ai-workspaces-automation-design.md` only after verification
- Modify: `scripts/smoke.mjs` for a deterministic fake-provider Team path if safely
  injectable; otherwise add an equivalent Electron-main integration test and document why
  packaged smoke cannot spend real provider credentials

**Steps:**

1. Document suggestions, explicit confirmation, configuration, routing, prices, budgets,
   claims, handoffs, merge/conflicts, trace lanes, cancellation, recovery, storage, and
   privacy.
2. Run `npm run verify`, `npm run desktop:build`, and `npm run web:build`.
3. Run desktop smoke and deterministic multi-agent integration coverage without real API
   keys. Package only after the final milestone source is complete.
4. Review the complete milestone diff for authority leaks, accidental agent starts, budget
   races, merge data loss, path exposure, accessibility, theme consistency, and baseline
   regressions.
5. Record exact evidence, commit the verified Team milestone, then begin trusted apply.
