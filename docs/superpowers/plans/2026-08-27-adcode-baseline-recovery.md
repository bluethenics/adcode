# ADCode Baseline Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore every checkpointed core package and prove the pre-feature ADCode desktop, web, tests, package boundaries, installers, and packaged smoke paths work again without changing product behavior.

**Architecture:** Recover `packages/` exactly from the parent of checkpoint `11ca5214d`, which is the last commit containing the existing package implementations. Treat any verification failure after restoration as a regression to diagnose rather than rewriting the recovered architecture. Keep the generated `supabase/.temp/` linkage cache untracked.

**Tech Stack:** TypeScript 5.9, Node.js 24, npm 11, Vitest 4, dependency-cruiser 18, Electron 43, electron-vite 5, electron-builder 26, Next.js 16.

**Spec:** `docs/superpowers/specs/2026-08-27-ai-workspaces-automation-design.md`

## Global Constraints

- ADCode's current appearance and every existing feature remain available.
- No behavior, UI, provider contract, settings default, or public API is redesigned in this milestone.
- Typing, saving, terminal input, startup, Git, debugging, and navigation must remain independent of AI availability.
- Filesystem and process authority remains in the Electron main process; the renderer remains untrusted.
- The generated `supabase/.temp/` directory is not source and must remain untracked.
- Each verification failure must be reproduced and diagnosed before a fix is written.
- End the milestone with a clean tracked worktree and a rollback commit.

---

## File map

- Restore: `packages/ads/**` — ad scheduling, validation, identity, serving, receipts, and tests.
- Restore: `packages/ai/**` — provider-neutral agent loop, model catalogue, providers, diffs, sessions, and tests.
- Restore: `packages/collab/**` — live-collaboration protocol, permissions, sessions, and tests.
- Restore: `packages/debug/**` — debug protocol helpers, inspection, and tests.
- Restore: `packages/diagnostics/**` — diagnostic types, explanations, grouping, and tests.
- Restore: `packages/format/**` — built-in formatting functions and tests.
- Restore: `packages/git/**` — safe Git process adapter, conflict helpers, and tests.
- Restore: `packages/help/**` — in-product help catalogue and tests.
- Restore: `packages/highlight/**` — tree-sitter encoding and language mappings.
- Restore: `packages/lsp/**` — LSP framing, protocol, server registry, and tests.
- Restore: `packages/memory/**` — local memory store, indexes, MCP server, and tests.
- Restore: `packages/search/**` — fuzzy and workspace text search and tests.
- Restore: `packages/settings/**` — settings schema, migration, and tests.
- Restore: `packages/spell/**` — comment spell correction and tests.
- Restore: `packages/structure/**` — outlines, markup, relations, scaffolds, and tests.
- Verify: `tsconfig.json`, `apps/desktop/tsconfig.json`, `apps/web/tsconfig.json` — existing path mappings resolve the recovered modules.
- Verify: `.dependency-cruiser.cjs` — existing architectural boundaries still hold.
- Verify: `vitest.config.ts` — restored tests and checkpointed platform tests are both collected.
- Verify: `electron-builder.yml` — the current desktop package is buildable without changing release behavior.

### Task 1: Recover the core package tree

**Files:**
- Restore: `packages/**`

**Interfaces:**
- Consumes: Git checkpoint `11ca5214d` and its parent tree.
- Produces: the exact `packages/**` tree from `11ca5214d^`, available through the existing `@adcode/*` TypeScript aliases.

- [ ] **Step 1: Prove the recovery source contains the package entry points**

Run:

```powershell
git ls-tree -r --name-only '11ca5214d^' -- packages | Select-String -Pattern '^packages/(ads|ai|collab|debug|diagnostics|format|git|help|highlight|lsp|memory|search|settings|spell|structure)/src/'
```

Expected: output contains source files for all fifteen named package directories.

- [ ] **Step 2: Restore only the deleted package tree**

Run:

```powershell
git restore --source='11ca5214d^' -- packages
```

Expected: `git status --short -- packages` lists package files as restored additions and no path outside `packages/` changes.

- [ ] **Step 3: Verify representative package entry points byte-for-byte**

Run:

```powershell
git show '11ca5214d^:packages/ai/src/index.ts' | git hash-object --stdin
git hash-object packages/ai/src/index.ts
git show '11ca5214d^:packages/ads/src/index.ts' | git hash-object --stdin
git hash-object packages/ads/src/index.ts
```

Expected: each historical/current hash pair is identical.

- [ ] **Step 4: Run the TypeScript gate**

Run:

```powershell
npm run typecheck
```

Expected: PASS with all three TypeScript projects completing and no missing `@adcode/*` modules.

- [ ] **Step 5: Commit the recovered baseline tree**

Run:

```powershell
git add packages
git commit -m "fix: restore ADCode core packages"
```

Expected: one commit restoring only `packages/**`.

### Task 2: Prove architecture and unit behavior

**Files:**
- Verify: `.dependency-cruiser.cjs`
- Verify: `vitest.config.ts`
- Verify: `packages/**/test/**`
- Verify: `apps/desktop/test/**`
- Verify: `apps/web/test/**`
- Verify: `services/api/test/**`

**Interfaces:**
- Consumes: restored `@adcode/*` packages from Task 1.
- Produces: a green dependency-boundary result and green repository test suite.

- [ ] **Step 1: Run the architecture firewall**

Run:

```powershell
npm run firewall
```

Expected: PASS with no forbidden dependency edge.

- [ ] **Step 2: Run the complete unit and integration suite**

Run:

```powershell
npm run test
```

Expected: PASS with no skipped failure caused by a missing package.

- [ ] **Step 3: Run the combined mandatory verification command**

Run:

```powershell
npm run verify
```

Expected: PASS for typecheck, firewall, and the full test suite in the same process chain.

- [ ] **Step 4: Record the verified baseline without source changes**

Run:

```powershell
git status --short
```

Expected: only `supabase/.temp/` is untracked. If a diagnostic fix was required, commit its focused tests and implementation before continuing.

### Task 3: Prove production builds and installers

**Files:**
- Verify: `apps/desktop/electron.vite.config.ts`
- Verify: `apps/web/next.config.ts`
- Verify: `electron-builder.yml`
- Verify: `scripts/package.mjs`

**Interfaces:**
- Consumes: green verification from Task 2.
- Produces: production desktop/web bundles and Windows package artifacts for version `0.1.0`.

- [ ] **Step 1: Build the desktop production bundle**

Run:

```powershell
npm run desktop:build
```

Expected: PASS and `apps/desktop/out/main/index.js` exists.

- [ ] **Step 2: Build the web production bundle**

Run:

```powershell
npm run web:build
```

Expected: PASS and Next.js prints the complete route table.

- [ ] **Step 3: Package the Windows desktop application**

Run:

```powershell
npm run package
```

Expected: PASS and `release/` contains the current setup executable, portable executable, `latest.yml`, blockmap, and unpacked application.

- [ ] **Step 4: Validate artifact metadata**

Run:

```powershell
Get-ChildItem release -File | Select-Object Name,Length,LastWriteTime
Get-Content release/latest.yml
```

Expected: current timestamps, non-zero binaries, version `0.1.0`, SHA-512 metadata, and filenames matching `electron-builder.yml`.

### Task 4: Prove packaged user flows

**Files:**
- Verify: `scripts/smoke.mjs`
- Verify: `scripts/smoke-ads.mjs`
- Verify: `mock-server/src/server.ts`

**Interfaces:**
- Consumes: packaged desktop artifacts from Task 3.
- Produces: evidence that editor and ad flows cross their real Electron/IPC/server boundaries.

- [ ] **Step 1: Run the packaged editor smoke suite**

Run:

```powershell
npm run smoke -- --packaged
```

Expected: PASS for launch, folder open, edit/save, terminal, menus, navigation, and packaged runtime checks.

- [ ] **Step 2: Run the ad delivery smoke suite**

Run:

```powershell
npm run smoke:ads
```

Expected: PASS for serving, targeted creative display, inline cached asset, receipt acknowledgement, and balance refresh.

- [ ] **Step 3: Confirm recovery did not change tracked files**

Run:

```powershell
git status --short
```

Expected: only `supabase/.temp/` remains untracked; generated build artifacts are ignored.

### Task 5: Close the milestone

**Files:**
- Modify: `docs/superpowers/plans/2026-08-27-adcode-baseline-recovery.md`

**Interfaces:**
- Consumes: verification evidence from Tasks 1–4.
- Produces: a checked-off recovery plan and stable base commit for Milestone 2.

- [ ] **Step 1: Mark completed steps in this plan**

Change each completed checkbox from `- [ ]` to `- [x]`. Leave a failed or externally blocked step unchecked and append its exact command and failure summary immediately below it.

- [ ] **Step 2: Run the final tracked-state check**

Run:

```powershell
git diff --check
git status --short
```

Expected: no diff errors and only the deliberately untracked `supabase/.temp/` cache.

- [ ] **Step 3: Commit the milestone record**

Run:

```powershell
git add docs/superpowers/plans/2026-08-27-adcode-baseline-recovery.md
git commit -m "docs: record ADCode baseline recovery"
```

Expected: the milestone plan records the verified state and `git log -1 --oneline` shows the documentation commit.
