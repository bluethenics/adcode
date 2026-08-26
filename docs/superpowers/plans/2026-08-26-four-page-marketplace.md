# ADCode Four-Page Marketplace Implementation Plan

**Date:** 2026-08-26

**Design:** `docs/superpowers/specs/2026-08-26-four-page-marketplace-design.md`

## Task 1: Establish the per-500 pricing boundary

**Primary files:**

- `services/api/src/config.ts`
- `services/api/src/demand.ts`
- `services/api/src/serve.ts`
- `services/api/src/advertisers.ts`
- `services/api/src/creditOrders.ts`
- `services/api/test/demand.test.ts`
- `services/api/test/serve.test.ts`
- `services/api/test/advertisers.test.ts`
- `services/api/test/creditOrders.test.ts`
- `apps/web/src/lib/site.ts`
- `apps/web/src/lib/demand.ts`
- `apps/web/test/money.test.ts`

1. Add failing tests for a $2 CPM internal floor, $0.02 CPM increment, $1 minimum checkout,
   and exact conversion to a $1 per-500 UI value.
2. Change configuration defaults and validation together.
3. Centralize the UI conversion and remove old $3 floor text from current product surfaces.
4. Run the focused API and money tests.

## Task 2: Add truthful live price history

**Primary files:**

- `services/api/src/contract.ts`
- `services/api/src/store.ts`
- `services/api/src/memoryStore.ts`
- `services/api/adapters/supabaseStore.ts`
- `services/api/adapters/firestoreStore.ts`
- `services/api/src/demand.ts`
- `services/api/src/fetchHandler.ts`
- `services/api/test/demand.test.ts`
- `services/api/test/memoryStore.test.ts`
- `apps/web/src/lib/demand.ts`

1. Add failing tests for a 24-hour, hourly aggregate of captured clearing prices, including
   empty history and privacy-safe output.
2. Extend the store contract with the smallest aggregate read needed by the public endpoint.
3. Return current demand and historical points from `/v1/demand`, keeping bids, advertiser
   identity, and campaign detail private.
4. Verify all adapters and the public route.

## Task 3: Build the market hero and chart

**Read first:** the locally installed Next.js guidance for client components, caching, and
navigation under `apps/web/node_modules/next/dist/docs/`.

**Primary files:**

- `apps/web/src/app/page.tsx`
- `apps/web/src/components/MarketDemand.tsx`
- `apps/web/src/components/MarketPriceChart.tsx` (new)
- `apps/web/src/components/Nav.tsx`
- `apps/web/src/components/Footer.tsx`
- `apps/web/src/app/layout.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/test/marketplaceLanding.test.tsx` (new)

1. Add failing component tests for the approved headline, exact header actions, current
   per-500 price, floor fallback, history summary, and empty-history state.
2. Replace the long marketing page with the dark ADCode hero and live chart.
3. Remove global release/navigation/footer clutter from the primary-page layout while keeping
   compact legal links.
4. Verify reduced-motion, keyboard focus, mobile layout, and stable loading dimensions.

## Task 4: Put the advertiser bid builder on the landing page

**Primary files:**

- `apps/web/src/components/LandingBidBuilder.tsx` (new)
- `apps/web/src/app/portal/campaigns/new/page.tsx`
- `apps/web/src/components/SignInCard.tsx`
- `apps/web/src/lib/api.ts`
- `apps/web/src/app/globals.css`
- `apps/web/test/landingBidBuilder.test.tsx` (new)

1. Extract reusable campaign-draft validation and write failing tests for the $1 floor,
   block quantity, estimated maximum, HTTPS URL, preview, draft preservation, and API order.
2. Build the compact one-column/two-column responsive form and inline sign-in gate.
3. Reuse the existing advertiser, campaign, creative, asset, and Dodo checkout APIs.
4. Preserve drafts through authentication and recover from partial failures without duplicate
   campaign creation.
5. Route successful checkout returns to `/portal`.

## Task 5: Consolidate the advertiser workspace

**Primary files:**

- `apps/web/src/app/portal/page.tsx`
- `apps/web/src/app/portal/billing/page.tsx`
- `apps/web/src/app/portal/campaigns/new/page.tsx`
- `apps/web/src/app/portal/campaigns/[id]/page.tsx`
- `apps/web/src/app/portal/tabs.ts`
- `apps/web/src/components/AppShell.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/test/advertiserWorkspace.test.tsx` (new)

1. Add tests asserting no tabs and that balance, checkout, reporting, campaign creation,
   campaign detail/editing, and credit history are reachable on `/portal`.
2. Compose those operations into one continuous page with expandable campaign rows.
3. Replace secondary pages with redirects into the appropriate portal section/open state.
4. Verify authenticated and no-advertiser states.

## Task 6: Consolidate the developer workspace

**Primary files:**

- `apps/web/src/app/dashboard/page.tsx`
- `apps/web/src/components/PayoutPanel.tsx`
- `apps/web/src/components/AppShell.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/test/developerWorkspace.test.tsx` (new)
- `apps/web/test/payouts.test.tsx`

1. Replace segmented tab state with continuous earnings, activity, ledger, payout profile,
   eligibility, request, and history sections.
2. Use compact disclosure only for secondary detail, never for primary navigation.
3. Verify the $50 withdrawal minimum and every existing payout safety state.

## Task 7: Consolidate the admin workspace

**Primary files:**

- `apps/web/src/app/admin/page.tsx`
- `apps/web/src/components/AdminShell.tsx`
- `apps/web/src/app/admin/_sections/*.tsx`
- `apps/web/src/app/admin/{content,money,people,review,tools}/page.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/test/adminWorkspace.test.tsx` (new)

1. Add tests asserting no admin tabs and presence of all review and operations sections.
2. Compose existing section components on `/admin`, urgent sections first and expanded.
3. Redirect old admin routes to `/admin` anchors.
4. Verify admin authorization, sensitive payout-detail handling, and action refresh behavior.

## Task 8: Redirect secondary routes and align public copy

**Primary files:**

- `apps/web/src/app/advertise/page.tsx`
- `apps/web/src/app/download/page.tsx`
- `apps/web/src/app/blog/page.tsx`
- `apps/web/src/app/docs/page.tsx`
- `apps/web/src/components/AccountMenu.tsx`
- `apps/web/src/lib/schema.ts`
- `apps/web/src/lib/site.ts`
- `apps/web/src/app/llms.txt/route.ts`
- `apps/web/src/app/llms-full.txt/route.ts`
- `README.md`
- `SETUP.md`

1. Redirect non-primary product routes to the matching landing or workspace section while
   retaining privacy and terms routes.
2. Remove stale CPM, multi-page navigation, and old campaign-builder language.
3. Update structured data and setup documentation to the per-500 block model.

## Task 9: Verification

1. Run focused API and web component tests during each task.
2. Run `npm run typecheck` and the relevant API test suite.
3. Run `npm --prefix apps/web run build`.
4. Start the site and visually inspect `/`, `/portal`, `/dashboard`, and `/admin` at desktop
   and mobile widths.
5. Exercise landing bid validation without making a live purchase.
6. Run secret scanning and `git diff --check`.
7. Report any pre-existing failures separately and do not claim they were caused or fixed by
   this feature without evidence.
