# Shared project sessions and account recovery

The local desktop build includes a Projects entry for persistent team membership, project chat sessions, member message/session contributions, and access to the existing local Git contributions panel. A member can start a session, send a team message, or explicitly ask AI using their own account and current checkout. Only the shared transcript and final reply enter the project conversation; private chats are not uploaded.

## Plan limits

| Plan | Owned shared projects | People per project, including owner |
| --- | ---: | ---: |
| Free | 1 | 3 |
| Weekly ($3/week) | 3 | 5 |
| Monthly ($9/month) | 5 | 8 |
| Pro ($29/month) | 15 | 15 |
| Max ($99/month) | 50 | 30 |
| Unlimited ($299/month) | 100 | 50 |

Invited projects do not use ownership slots. The owner's active plan controls new memberships. Downgrading keeps existing conversations accessible; archiving preserves read-only history and frees an ownership slot. The server checks entitlements through a private service binding and serializes quota/membership changes in SQLite Durable Objects.

AI requests use provider-specific queues with 16 active slots, bounded queues, per-account concurrency caps, cancellation, and renewable leases. Active paid plans receive increasing priority. Ten seconds of waiting offsets the entire Free-to-Unlimited priority difference, preventing starvation. Priority affects waiting for a provider slot; it does not promise a fixed token-generation speed. Rejected queue admissions release the request's credit reservation.

## Account fixes

- Desktop builds without a Google client secret use the hosted `/desktop-sign-in` page. The callback is a state-bound form POST to an ephemeral loopback listener. Credentials never enter URLs. `Origin:null` is accepted only with the required unpredictable state, supporting the hosted page's no-referrer policy.
- Desktop and website expose verification resend/check controls with truthful delivery errors and cooldowns. The AI verification card opens these controls and resumes the pending message after verification.
- The independently verified mail repair uses Resend delivery and a hashed, single-use, one-hour proof with explicit POST confirmation. Merely opening a link cannot consume it. Fresh proof checks avoid stale account-cache authorization. It does not grant Firebase/admin verification claims.

## Hosted deployments

- Main website/API: `e78390c3-650b-40c6-8761-afa90d6a34e8`, including hosted sign-in, verification controls, `ProjectEntitlements`, and `AI_PRIORITY` bound to `adcode-projects#RequestPriority`.
- New project/priority Worker: `adcode-projects`, `2b3615ca-80e6-4fcb-a340-919516e38d1e`, at `https://projects.bluethenics.com`. Removing a member also clears that member's unfinished assistant turn so the team can continue.
- Existing `adcode-collab` and its CloudProject/ProjectAccount storage remain untouched. New live invites use `.projects.adcode`; existing `.relay.adcode` invites retain their original service routing. A rejected attempt to update the old Worker applied no migration. The new Worker uses separate namespaces rather than recreating existing storage.
- These desktop changes are compiled locally for `adcode app`. This work does not publish an installer. An independent patch-release task is coordinating Google fallback and recovery fixes against the currently published desktop branch.

## Validation

- 74 real Worker/SQLite integration checks: ownership races, seat caps, membership isolation/revocation, idempotent messages, shared sessions, serialized assistant turns, turn renewal/removal, archive behavior, private queue ordering and lease ownership.
- Deployed service tested with three disposable Firebase accounts: actual Free entitlement, one-project cap, shared session/message persistence, and revoked-member denial. Test project archived and accounts deleted afterward; signup did not trigger email delivery.
- Browser test against the hosted sign-in page: Google button ready, matching state returned by real form navigation, `Origin:null`, credential only in POST body.
- After the final main deployment, an existing authenticated admin used the model-test UI successfully: Qwen3.8 27B Queen replied `ok`, with no verification-email sends or plan changes.
- Actual compiled desktop startup: preload bridge, Projects panel and shared transcript all loaded successfully.
- Chromium panel tests: shared replies, explicit team/AI actions, retained drafts/focus, escaped text, leaving a project and reachable send controls in narrow windows.
- Targeted API, account verification/proof, Google callback, collaboration, source-profile, WebSocket bundling and AI recovery tests; desktop/root/relay types and website production build.
- Dependency checks: zero errors; existing orphan warnings remain.

Evidence logs are under `output/shared-*`. No credentials or live verification links are included here.
