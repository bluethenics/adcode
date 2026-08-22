# Web marketing redesign handoff

## Scope respected

The redesign changed only `apps/web/**` plus the two planning documents below. No desktop, services, API, or billing files were modified.

## Added

- `apps/web/src/components/DesktopMockup.tsx` — static, responsive ADCode desktop product preview; no runtime dependencies; reduced-motion-safe.
- `apps/web/src/components/HeroHeadline.tsx` — accessible animated “Earn while you code” hero headline.
- `docs/specs/2026-08-20-adcode-marketing-redesign.md`
- `docs/plans/2026-08-20-adcode-marketing-redesign.md`

## Updated

- Public marketing routes: home, download, advertise, blog, blog posts, privacy, terms.
- Shared visual system in `apps/web/src/app/globals.css`.
- Shared `Nav` and `Footer` components.

## Verification

- `npm --prefix apps/web run typecheck` passes.
- `npm --prefix apps/web run build` passes.

## Collaboration note

Please keep any further work scoped away from the web marketing files above unless a change is intentionally coordinated with this redesign.

## Follow-up web changes

- Added `apps/web/src/components/HeroProduct.tsx`: product links in the home hero and scroll-triggered desktop mockup reveal.
- Added `apps/web/src/components/DocsSidebar.tsx`: a static broad docs side panel (Product, Guides, Developers). Please replace this static navigation with admin-managed documentation sections/links in your workstream; it deliberately has no CMS or API dependency yet.
- Blog index and articles now render inside the docs side-panel shell.
- Reduced home scroll painting cost by removing blur from the scrolled header and decorative hero horizon. The header stays black at the top and dark graphite when floating after scroll.
