# ADCode Marketing Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign ADCode’s public marketing pages around a credible desktop application and direct installer downloads.

**Architecture:** Add a reusable desktop-app product mockup and use a revised shared CSS system to provide the visual language. Keep page content and metadata server-rendered; use a small client component only for the hero’s animated phrase.

**Tech Stack:** Next.js App Router, React, TypeScript, CSS, next/font.

**Spec:** `docs/specs/2026-08-20-adcode-marketing-redesign.md`

## Global Constraints

- Change only `apps/web/**` plus this design documentation.
- Add no runtime dependency.
- Keep current release links, installer commands, metadata, schema, and economic data.
- Maintain visible keyboard focus and reduced-motion behavior.

---

### Task 1: Build reusable product proof

**Files:**
- Create: `apps/web/src/components/DesktopMockup.tsx`
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**
- Produces: `DesktopMockup({ compact?: boolean }): JSX.Element` for home, download, and advertise pages.

- [ ] Write a component test only if an existing web test harness supports rendering React components; otherwise rely on TypeScript and production-build verification because no component-test script is configured.
- [ ] Implement a static, semantic desktop application mockup with visual editor, sidebar, terminal, sponsored card, and ledger.
- [ ] Add responsive CSS classes scoped to the component, including the reduced-motion-safe ledger presentation.
- [ ] Run `npm run typecheck --workspace=@adcode/web`.

### Task 2: Rebuild shared marketing visual system

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/components/Nav.tsx`
- Modify: `apps/web/src/components/Footer.tsx`

**Interfaces:**
- Consumes: existing navigation/footer links and CSS custom properties.
- Produces: shared navigation, button, editorial, and responsive layout styles.

- [ ] Replace generic page-band styling with the graphite/blue/ledger-green token system and app-marketing layout primitives.
- [ ] Make the navigation’s download action explicit and preserve all existing route links.
- [ ] Restyle the footer as a compact product footer while retaining its existing navigation.
- [ ] Run `npm run typecheck --workspace=@adcode/web`.

### Task 3: Redesign the home conversion flow

**Files:**
- Create: `apps/web/src/components/HeroHeadline.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**
- Consumes: `DesktopMockup` and `HeroHeadline`.
- Produces: a home page with a product-first hero and direct download CTA.

- [ ] Write a failing behavior test for the headline’s reduced-motion fallback if the configured web test runner can render client components; otherwise skip the test because there is no supported DOM test environment.
- [ ] Implement `HeroHeadline` as a client component that preserves the full phrase as accessible text and uses CSS-only animation for the visual accent.
- [ ] Replace the existing home hero visual with the reusable desktop mockup and reorganize sections around product features, respectful ad rules, ledger proof, advertisers, and FAQ.
- [ ] Run `npm run typecheck --workspace=@adcode/web`.

### Task 4: Deliver app-first download and advertiser pages

**Files:**
- Modify: `apps/web/src/app/download/page.tsx`
- Modify: `apps/web/src/app/advertise/page.tsx`

**Interfaces:**
- Consumes: `DesktopMockup`, existing platform constants, and existing campaign links.
- Produces: direct installer cards and an advertiser campaign-preview page.

- [ ] Keep each platform’s existing release URL and command while elevating the direct installer link to the primary button.
- [ ] Add product proof to download and an advertiser-oriented sponsored-card preview to advertise.
- [ ] Preserve all current installation notices, advertiser FAQ entries, and route metadata.
- [ ] Run `npm run typecheck --workspace=@adcode/web`.

### Task 5: Align editorial routes and verify

**Files:**
- Modify: `apps/web/src/app/blog/page.tsx`
- Modify: `apps/web/src/app/blog/[slug]/page.tsx`
- Modify: `apps/web/src/app/privacy/page.tsx`
- Modify: `apps/web/src/app/terms/page.tsx`
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**
- Consumes: shared editorial CSS classes.
- Produces: consistent reading surfaces without changing article or legal content.

- [ ] Apply the shared page header and editorial layout classes while leaving document copy and metadata unchanged.
- [ ] Run `npm run typecheck --workspace=@adcode/web`.
- [ ] Run `npm run build --workspace=@adcode/web`.
- [ ] Check `git diff -- apps/web` and confirm it excludes desktop/API/billing files.
