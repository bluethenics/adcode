# Shared projects and AI recovery — ADCode 2.4.8

Published: https://github.com/bluethenics/adcode/releases/tag/v2.4.8
Source commit: 0864bd50b78b454b80f21dc31b20816ab76ba19d
Source branch: codex/shared-projects-release
Release checkout: C:/Users/SINAN/.codex/worktrees/adcode-shared-projects-release-20261030
Successful release CI: https://github.com/bluethenics/adcode/actions/runs/41093678958

## Delivered

- Join Discord in the existing sidebar: https://discord.gg/WH2UBsQd3 . Existing desktop stylesheets and layout are preserved.
- Encrypted internet collaboration for a GitHub-connected project. Guests open a checkout of the same repository. New internet guests are viewers until the host grants edit access. Guest AI file tools execute against host files, with permission checks, serialized remote operations, cancellation, disconnect handling and exact-text edit checks. Guest plans/questions remain local to their conversation. Commits and pushes remain under host control. Both peers require collaboration protocol 2.
- All Heabsy models are available on Free. Included models share 5M daily tokens, resetting 24 hours after first use. Weekly has 20M daily, Monthly 100M daily, Pro unlimited; existing prices remain unchanged. Purchased balances and active holds were preserved.
- Incomplete streams no longer silently succeed or execute partial tool calls. Final completion records without trailing newlines are recognized. Queue/thinking events do not block retries before an answer. Partial included answers can continue within the existing task without replaying completed tool history.
- Paid plans receive healthy-model fallback after temporary provider server errors. Paused-task state clears on resumed progress while intentional model-switch cancellation still permits continuation. Stop cancels recovery.
- Fixed app event names/counts cover Discord, collaboration, retry waits, allowance waits, interrupted streams and cancellation. Relay timeouts distinguish initial response, idle and hard duration failures. The existing admin first-day funnel includes the new events; provider accounting remains content-free.

## Live deployment

- Website/API Worker: 9ff96f26-4b35-4b75-ba91-5780d9adc094 . Public catalogue verified at 5M, with subscriptionRequired false for all three enabled Heabsy models.
- Collaboration Worker: a3aa2841-2438-413d-8bda-097fb36defc1 at https://collab.bluethenics.com . Health verified.
- Daily-allowance and experience-event migrations applied. Verified zero usage windows longer than 24 hours, 5M configured free tokens, daily reservation function and extended growth event catalogue.
- Public 2.4.8 release feed record published with announcements off. No release emails were sent.

## Verification and Store file

Local full verification: 5,804 tests passed, type checks and module boundaries passed. Release CI passed verification and Windows, Linux, macOS packaging, followed by combined asset verification. GitHub release is the latest stable release with ten assets. Relay integration exercised authentication rejection, host presence, bidirectional routing and shutdown. SQL accounting checks covered daily exhaustion/reset and preservation of purchased balances. The existing composer GUI test verified waiting-task model switching and cancellation. Sidebar preview verified the Discord action and tracking.

Microsoft Store upload: E:/adcode-sourcecode/release/store/ADCode-2.4.8-x64.appx
Size: 183,990,415 bytes
SHA-256: 634e3a4596e7e575c59e63fbaf75c707e3d7004936d9283e32fcc1cd03bbbf67
Identity: bluethenics.ADCode
Publisher: CN=D5C2302F-6F6C-4A0E-B93A-F757B1A7CC4D
Manifest version: 2.4.8.0

Identity matches the previous Store package. Archived app payload matches the final build; version, Discord control, relay and recovery code were verified in the archive. The copied upload checksum matches. The package has not been submitted to Partner Center.

Shared sessions require the host to stay open, expire after 24 hours, and do not expose guest commands, external tools or host private memory. The host runs checks. Existing upstream provider rate limits and capacity problems can still occur; recovery does not create provider capacity.
