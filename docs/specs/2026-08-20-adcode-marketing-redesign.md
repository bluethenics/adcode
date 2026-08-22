# ADCode Marketing Redesign

## Goal

Redesign every public ADCode marketing route as a product-first desktop application site whose primary conversion is an installer download.

## Audience and page job

Developers should immediately see a credible, capable IDE, understand that it is free, and then understand that earnings are transparent and non-disruptive. Advertisers should see a compact, credible path to launching a campaign.

## Direction

Use a dark graphite product surface, electric-blue product actions, and ledger green only for factual earnings. The home hero headline is **“Earn while you code.”** with a restrained, reduced-motion-safe emphasis animation. The visual inspiration is the product proof, clear download flow, and live-feeling UI of Kickbacks.ai and Freebuff, without reusing their copy, marks, or assets.

## Product proof

Build a reusable static ADCode desktop mockup with editor chrome, source code, terminal, sidebar, sponsored-card placement, and an append-only ledger. It must be responsive and appear on the home and download routes. It represents the existing desktop product; it is not a functional embedded IDE.

## Downloads

`/download` leads with platform cards for Windows, macOS, and Linux. Each card links to the existing GitHub latest-release URL. Terminal commands remain secondary. Do not promise files beyond the project’s existing release links. Keep the current OS requirements and Windows SmartScreen disclosure.

## Routes

- `/`: animated hero, desktop proof, features, earnings/respect rules, advertiser CTA, FAQ.
- `/download`: application download cards, mockup, install explanation.
- `/advertise`: advertiser positioning, card preview, campaign workflow, FAQ.
- `/blog`, `/blog/[slug]`, `/privacy`, `/terms`: retain content and metadata; apply the new shared editorial treatment.

## Constraints

- Modify only `apps/web/**` for the shipped redesign. This spec and its implementation plan are the only documentation additions.
- Do not alter desktop, services, billing, or API files, including existing uncommitted changes.
- Preserve existing metadata, schema, URLs, economics, and installer commands.
- No new runtime dependencies.
- Maintain keyboard-visible focus, semantic headings, and `prefers-reduced-motion` support.

## Verification

Run the web TypeScript check and production build. Visually inspect the home, download, and advertiser pages at desktop and mobile widths if the local app can be run without affecting other work.
