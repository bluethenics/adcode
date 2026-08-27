# Monochrome glass navigation and public pages

## Goal

Make ADCode feel like one quiet, professional product: a black-and-white landing page with restrained iOS-style glass motion, direct portal access, and no unnecessary navigation or clicks.

## Navigation

The global header contains the ADCode mark, plain Support and Versions links, two primary destinations (Advertiser portal and User portal), and a separate Sign in or Log out control. Administrators may also see an Admin link. On small screens, both portal destinations remain immediately visible while secondary links and authentication move into a compact menu.

The header is the only product navigation. The footer remains limited to legal links.

## Landing page

Keep the approved headline, “Earn while you code,” the live demand chart, and the complete advertiser bid builder on the landing page. Replace decorative color and gradients with a monochrome circuit/chip field behind the hero. Surfaces use translucent black or white, blur, hairline borders, and subtle spring-like hover movement. Respect reduced-motion preferences.

All price language remains $1 USD per 500 verified impressions. The existing live demand endpoint remains the source of chart data.

## Support

`/support` is an authenticated, single-form page. It collects category, subject, message, and an optional reference. Submissions use the existing `/v1/reports` endpoint, so the sender identity comes from the verified session and every message appears in the existing Admin feedback queue. The page shows explicit sending, success, and error states.

## Versions and downloads

`/versions` is a public page containing platform download actions and release history from the existing releases feed. `/download` and `/changelog` redirect to it. Installer links continue to use ADCode's `/dl/:platform` proxy. If no release notes are available, the page remains useful and honest rather than inventing a version.

## Visual constraints

- Black, white, and neutral grays only.
- No CSS or SVG gradients and no colored glows.
- Glass comes from transparency, blur, borders, and shadow.
- Motion is small, functional, and disabled when reduced motion is requested.
- Continuous portal, user, and admin pages remain tab-free.

## Verification

Add coverage for monochrome chart markup, support payload construction, and download destinations. Run the repository test suite, web typecheck, production build, secret scan, deploy, and live HTTP checks for the landing page and new routes.
