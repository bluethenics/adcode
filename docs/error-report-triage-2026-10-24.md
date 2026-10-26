# Error report triage — 24 October 2026

Reviewed the 27 open bug reports and two open help reports in the production database. The unrelated coding request filed as “other” was excluded. One bug report is actually a request for Russian interface localization; it was acknowledged without claiming localization is implemented.

## Replies

Sent 19 individual support emails from the user-authorized address, covering 23 reports. Reports from the same account address were combined. Every accepted send was recorded in `report_replies` with its provider receipt and an audit entry. Six reports have no account email address; no message was sent to an address copied from untrusted report prose. All 29 reviewed reports remain in progress.

The email provider confirmed all 19 messages delivered, with zero bounces or failures. Reconciled delivery webhooks that arrived before their report-reply records were inserted. A final queue check found no new open bug/help reports outside this review.

## Changes and verification

- Rebuild a cached chat provider after an account-change error, so the next user attempt can bind to the new account while the interrupted run stays stopped.
- Distinguish email verification from being signed out; offer retry after the verification link is opened.
- Retry temporary included-AI server errors before output, with bounded waits of 2, 5 and 10 seconds. Recognize a response reported only as “terminated” as a connection failure. Partial responses and completed tools are never replayed.
- Reset the repeated-tool failure count after successful mutating progress, so failed tests across successful corrections do not incorrectly stop a task.
- Preserve a validated backup when schedule storage must copy on drives that reject rename. Recover an interrupted copy and skip writes for unchanged schedules.
- Handle asynchronous preview file-watcher errors, fall back to a shallow watcher, and close the active fallback on shutdown.
- Keep desktop rendering timers active when the window loses focus. This is a mitigation; the reported Windows freeze has not been reproduced or confirmed resolved.

705 tests passed across 49 files. Desktop TypeScript checks and the desktop production build passed. Dependency checks reported zero errors and 33 existing warnings.

These desktop changes are built locally and have not been published in an installer or updater release. Replies explicitly state this. The server database dependency repair from the preceding status-page work is already live.

## Remaining limitations

GLM has genuine upstream rate limits. Google's high-demand responses, a missing private provider key, and models without tool/image support cannot be fixed by pretending those capabilities or credentials exist. Reporters received the relevant explanation and next step. Project-specific Django/test failures require the missing final traceback or assertion. Freeze reports require reproduction details. Full Russian interface localization remains a feature request without a promised release date.

## Report coverage

| Report | Diagnosis | Reply |
| --- | --- | --- |
| rep-36-1792588829278 | unsupported-tools | Sent and recorded |
| rep-3-1792605777200 | account-switch | Sent and recorded |
| rep-7-1792614640658 | google-unavailable | Sent and recorded |
| rep-1-1792617910026 | account-switch | Sent and recorded |
| rep-3-1792663126355 | repeated-command | Sent and recorded |
| rep-1-1792666133501 | verification | Unavailable: no account email |
| rep-8-1792666228893 | account-switch | Unavailable: no account email |
| rep-11-1792666286599 | account-switch | Unavailable: no account email |
| rep-9-1792666464595 | account-switch | Unavailable: no account email |
| rep-18-1792675425930 | image-support | Sent and recorded |
| rep-86-1792687065348 | repeated-command | Sent and recorded |
| rep-3-1792687168946 | verification | Unavailable: no account email |
| rep-1-1792695680043 | connection | Sent and recorded |
| rep-55-1792701393781 | localization | Sent and recorded |
| rep-34-1792788524847 | verification | Sent and recorded |
| rep-1-1792794507993 | schedule-storage | Sent and recorded |
| rep-1-1792795283693 | verification | Sent and recorded |
| rep-4-1792798168455 | account-switch | Unavailable: no account email |
| rep-1-1792798336094 | account-switch | Sent and recorded |
| rep-1-1792800690697 | missing-key | Sent and recorded |
| rep-3-1792806864948 | account-switch | Sent and recorded |
| rep-5-1792815603393 | freeze | Sent and recorded |
| rep-3-1792826970743 | verification | Sent and recorded |
| rep-21-1792830214139 | freeze | Sent and recorded |
| rep-1-1792853434006 | included-unavailable | Sent and recorded |
| rep-1-1792855099513 | connection | Sent and recorded |
| rep-1-1792856738213 | included-unavailable | Sent and recorded |
| rep-6-1792858696676 | schedule-storage | Sent and recorded |
| rep-14-1792861649067 | included-unavailable | Sent and recorded |
