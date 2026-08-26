# ADCode Four-Page Marketplace Design

**Date:** 2026-08-26

**Status:** Approved in chat

**Supersedes:** The public-site navigation, $3 CPM floor, and multi-page portal/admin UI
described in `2026-08-26-advertising-credits-auction-payouts-design.md`. Its payment,
ledger, settlement, privacy, and manual-payout invariants remain in force.

## 1. Product shape

ADCode has four primary product pages:

1. `/` — public landing page, live market, download action, and advertiser bid builder
2. `/portal` — the advertiser's complete campaign and credit workspace
3. `/dashboard` — the developer's complete earnings and payout workspace
4. `/admin` — the operator's complete review and operations workspace

The product does not expose tabs or primary navigation to secondary product pages. Essential
legal, authentication callback, asset, download, and API routes may remain, but they are not
presented as additional product destinations. Existing secondary routes redirect into the
appropriate primary page and section.

## 2. Pricing language and auction arithmetic

The customer-facing unit is one **500-impression block**.

- Minimum bid: **$1.00 USD per 500 impressions**
- Internal equivalent: **$2.00 CPM** (`2_000_000` USD micros)
- Fixed auction increment: **$0.01 per 500 impressions**, represented internally as a
  $0.02 CPM increment
- The second-price auction remains in place: the winner pays the lower of its maximum bid
  and one increment over the next eligible bid, subject to the floor.
- A campaign's maximum budget is its block bid multiplied by its requested number of blocks.
- Actual settlement remains per verified impression, using integer USD-micro arithmetic.
- The developer continues receiving 50% of the captured clearing charge.

APIs and persistence continue using CPM micros where they already do so. A shared conversion
boundary maps between CPM micros and the UI's per-500-impression dollars. This avoids a risky
money migration while making all customer-facing prices match the approved block model.

The minimum hosted credit checkout becomes $1.00 so a one-block campaign at the floor can be
purchased. Credits remain account-level USD spending power; delivery is not guaranteed and
stops at the campaign budget.

## 3. Landing page

### 3.1 Header

The header contains only:

- ADCode mark and wordmark, linking home
- **Advertise**, scrolling to the bid builder
- **Earn**, scrolling to the download action

There is no docs, blog, changelog, product-tab, account, or repeated download navigation.
Authenticated users reach their role page from the relevant Advertise or Earn flow.

### 3.2 Hero

The approved headline is:

> **Earn while you code**

One short supporting sentence explains that ADCode is a privacy-first code editor funded by
respectful ads and that developers receive 50% of verified ad spend. A single primary earn
action starts the correct desktop download or opens the compact download choices.

The visual direction is a dark, minimal, professional ADCode environment inspired by the
provided reference's restraint, not its branding or composition. It uses:

- near-black background and warm off-white text
- one controlled ADCode green for money, live state, and primary actions
- Inter Tight display type, Inter body type, and JetBrains Mono for market values
- a subtle code-grid/terminal atmosphere built with CSS, not a decorative stock scene
- low-motion glow and chart updates that respect `prefers-reduced-motion`

### 3.3 Live market chart

The hero includes a fixed-size, accessible 24-hour price chart showing:

- current indicative price in USD per 500 impressions
- $1 floor reference line
- hourly realized clearing-price points when available
- current active funded campaign count and demand state
- last refresh time

The current point comes from the same live demand calculation used by auction messaging. The
history is aggregated from actual captured serve prices; no synthetic price movement is
generated. If there is no history, the chart draws the floor and says that no settled auction
history is available yet. Data refreshes every 60 seconds without causing layout movement.

### 3.4 Inline bid builder

The advertiser can configure a campaign without leaving the landing page. The form contains:

- email (pre-filled when authenticated)
- ad line, 3–60 characters
- destination URL, HTTPS only
- optional company name
- optional brand icon with the existing asset constraints
- maximum bid per 500 impressions, minimum $1.00
- number of 500-impression blocks, minimum one
- audience: everyone or selected existing targeting tags
- delivery estimate disclaimer
- estimated maximum spend
- live ADCode card preview

The form deliberately omits placement tabs and artificial delivery-speed controls because
ADCode has one bounded ad surface and auction delivery depends on eligible demand. The button
says **Continue to secure checkout** and uses Dodo Payments, not Stripe.

If authentication is required, an inline sign-in gate appears and preserves the draft. After
authentication the client creates or reuses the advertiser account, creates the campaign and
creative, and opens the hosted Dodo checkout. Browser redirects never grant credits; signed
Dodo webhooks remain authoritative. The creative remains subject to manual approval, and the
copy makes that clear before payment.

## 4. Advertiser page

`/portal` is one continuous page with no tabs. It contains:

- available, committed, spent, refunded, and disputed credit totals
- add-credits checkout controls
- reporting-window control and aggregate views/clicks/spend
- live and historical campaigns
- inline campaign creation
- expandable campaign rows for editing, creative status, pause/resume, targeting, budget,
  bid, and performance
- order and credit history

The page may use disclosure panels and filters, but not tab navigation or links to separate
billing/campaign-management screens. Old portal routes redirect back with a focus/open query.

## 5. Developer page

`/dashboard` is one continuous page with no tabs. It contains:

- available earnings, pending payout amount, lifetime earnings, and verified activity
- earnings and impression history
- append-only ledger
- payout eligibility checklist
- encrypted country/currency-specific bank profile
- $50 minimum withdrawal request
- withdrawal status/history and allowed cancellation
- device or installation identity information required to understand tracked activity

Compact disclosure panels may reduce visual density. All earnings, tracking, and payout
operations remain on this page.

## 6. Admin page

`/admin` is one continuous page with no tabs. It contains:

- queue overview and platform health
- creative approval
- withdrawal review, approval, decrypted-detail access, and manual Wise payment evidence
- advertisers, users, and administrator management
- live market price/configuration
- payout corridors
- reports, notices, releases, posts, and test-delivery tools

Sections are searchable and collapsible. Urgent queues are expanded by default; low-frequency
operations are collapsed. Existing admin subroutes redirect to anchored sections.

## 7. Density, accessibility, and responsive behavior

- One dominant task per visual region; no repeated marketing copy.
- Desktop uses a wide hero with market chart and bid builder arranged for quick scanning.
- Mobile keeps the same reading order and turns the builder into a single column.
- Minimum 44px interactive targets, visible focus states, explicit labels, and programmatic
  error associations are required.
- Charts have text summaries and do not rely on color alone.
- Authentication, payment, upload, and API failures preserve entered data and show one clear
  recovery action.
- The four primary pages use landmarks and section headings so a continuous page remains
  navigable without tabs.

## 8. Success criteria

- A first-time advertiser can see the live price and begin a valid bid from `/`.
- Every visible minimum price is $1 per 500 impressions; no customer-facing $3 CPM floor
  remains.
- The landing header has exactly Advertise and Earn actions.
- Advertiser, developer, and admin work is each possible from its one canonical page without
  tab navigation.
- Dodo webhook, credit, settlement, 50% share, $50 payout, encryption, and manual payout
  safety invariants continue passing their tests.
- The four-page experience passes type checking, production build, focused interaction tests,
  and responsive visual inspection.
