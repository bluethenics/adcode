# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub:
https://github.com/bluethenics/adcode/security/advisories/new

If you cannot use GitHub, write to adcode.support@gmail.com with "Security" in the subject.

Include what you found, how to reproduce it, and which version or commit you tested. We will
acknowledge the report within five working days and tell you what we intend to do about it.
Please give us a reasonable chance to fix it before you publish.

## In scope

- The desktop app: anything that lets a web page, a project file, an AI response or an ad
  creative run code, read files outside the open workspace, or reach stored credentials.
- The ad server and ledger (`services/api`): forging a receipt, earning for a view that did
  not happen, reading or changing another account, or moving a balance.
- The website, advertiser portal and admin panel (`apps/web`).
- The update and install path: anything that gets a user to run a build we did not publish.

## Out of scope

- A modified build behaving differently from an official one. The client runs on the user's
  machine; what protects earnings is that the server verifies every receipt.
- Reports from automated scanners with no demonstrated impact.
- Denial of service by volume.

## Supported versions

Security fixes go into the latest release. The app updates itself; see
Help > Check for Updates.
