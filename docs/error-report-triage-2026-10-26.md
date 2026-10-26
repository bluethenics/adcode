# Error report triage — 26 October 2026

Reviewed ten new report rows from seven accounts after the previous cutoff, `1792945571379`. The indexed recent-report query returned ten rows; a second bounded page between the oldest result and that cutoff was empty. This brings the two triage records to 23 reviewed reports. The new review cutoff is `1792980050256`; no further queue polling is required for this batch.

Sent seven individualized replies from the explicitly confirmed sender, `ADCode <adcode@bluethenics.com>`. Provider delivery webhooks confirmed all seven delivered. Four reports from one account share one reply, recorded against all four rows. Each recipient came from the report account's keyed user record, never its body: all seven records are active and verified, no suppression rows matched, and none of these ten reports had an existing reply. Every send was recorded in `report_replies` and the audit log; reports remain triaged, not closed. Together with the 25 October record, 23 reports were reviewed and 18 support messages delivered.

| Report | Finding | Reply status |
| --- | --- | --- |
| `rep-1-1792980050256` | Gradle `compileJava` cannot resolve a Fabric API dependency; repeated identical failed commands trigger the loop guard; bare `gradle` is unavailable on Windows | Delivered |
| `rep-1-1792973535720` | Repeated stream interruptions; file tools also refused because no project was open; account is now verified | Delivered |
| `rep-12-1792973006790` | Repeated stream interruptions; separate project test failures, unsupported Windows `head`, unknown tool name and malformed arguments | Delivered |
| `rep-4-1792967846017` | Stream interruptions and repeated invalid checklist status updates; account is now verified | Delivered |
| `rep-29-1792952360370`, `rep-53-1792952083820`, `rep-12-1792949165750`, `rep-11-1792949137218` | Repeated interruptions during a Windows/CMake task; separate missing paths, wrong Git working directory, compiler failures and a command timeout | Combined reply delivered |
| `rep-1-1792949513751` | Repeated interruptions; earlier missing workspace, search-input and edit-match refusals; account is now verified | Delivered |
| `rep-3-1792949052184` | Large-conversation HTTP 413 refusal plus later stream interruptions; separate missing project documents and HTTP 404 | Delivered |

## Verified distinctions

- Nine report rows contain the newly readable `stream-interrupted` message. They show that the published response-transport correction is reaching released 2.4.0 desktops, but they do not establish why each provider stream ended. Most failure lines name `tagflow-code-27b`. One report's current selection is `heabsy-qwen38`, while its recorded error lines name the former model. The reports do not include partial output or provider completion markers. Model names and exact log times were sent to the server investigation agent; no reporter was told the interruptions were resolved.
- The live server already contains commit `60c78fb`, which finishes an interrupted response with a sanitized SSE error rather than breaking Next's response pipe. A further correction, `97712502`, is now published as Worker `9e18b288-834f-4686-8f8c-5ff838650ca1`. It handles disconnects before response headers, preserves valid final provider data lines without a blank separator, and prevents duplicate concurrent settlement writes. Its 147 focused tests, type checks, independent review and Cloudflare build/preview passed. These reproduce concrete failure paths, but the logs do not prove the individual cause of every report. Reports remain in progress.
- The Gradle report ends before the complete dependency coordinates and repository search details. It does not provide the project's build files, so prescribing a Fabric API version would be speculative. The reply requests the complete dependency-resolution section and relevant build configuration with credentials removed, and explains using a checked-in `gradlew.bat` wrapper if present.
- `packages/ai/src/agent.ts` deliberately stops three identical failed real tool calls. The existing working-tree correction clears accumulated failures after a successful mutating operation; it has not shipped in an installer. Repeating the same unresolved Gradle build still warrants stopping. The logs do not prove a new defect in that guard.
- `apps/desktop/src/main/aiTools.ts` already normalizes checklist `completed` to `done`, and `packages/ai/src/agent.ts` retires a repeatedly invalid checklist so coding work can continue. These are local desktop fixes, not a published desktop update.
- `services/api/src/tagflow.ts` explicitly rejects requests above 1 MB with HTTP 413 and suggests `/compact` or a new conversation. Missing files, an unopened workspace, compiler failures and an unsupported command are separate from provider streaming failures.

No user project was changed, no report was closed, no balance was adjusted, and no production table was scanned or aggregated. All database reads used the recent-report index or exact report/user/email keys with a 1,500 ms statement timeout. Desktop installer publication remains separate.
