# Report responses and first fix — 30 October 2026

Reviewed the 73 unresolved reports present at cutoff `1793354234093`: 41 open and 32 already triaged, from 54 accounts. The earlier 32 stream-interruption drafts had not been sent. Closed reports and deleted records were left alone.

## Responses

Sent two individual replies through the admin form, then 52 account-specific replies through the connected Resend service. The connected account and sender were verified against the first successful admin reply. Recipients came from the keyed account records, never from addresses typed into report bodies. No account lacked an email address or was suppressed for bounce/complaint before sending. The batch used the stable idempotency key `adcode-report-triage-2026-10-30-grouped-v1`.

Each grouped reply references all of that account's reports. All 52 provider IDs were matched back to recipients and subjects before recording 71 associated `report_replies` rows, 71 audit rows, and moving the remaining 39 open reports to triaged. Together with the two admin-form replies, all 73 report rows have a reply record. No unresolved report was marked closed.

At verification: 52 of the 54 emails were confirmed delivered, one bounced (`rep-39-1793287620907`), and one remained sent without a delivered event (`rep-45-1793054166747`, also covering that account's other report). No duplicate send was attempted for either. Private sending plans and receipts are in `output/report-reply-*.private.json`; they contain account email addresses and must not be published.

Some signed mail webhooks arrived before their grouped report records existed. After inserting the actual send records, the matching unprocessed events were replayed through the existing idempotent `email_apply_event` function. This preserves real delivery-event timestamps and applies the normal suppression/cancellation rules to the bounced address.

The two previously missing Weekly subscriptions were checked against live records and remain active through 5 November 2026. Replies confirmed access without another payment. The Russian-language cancellation question received a Russian reply explaining where to stop automatic renewal; no subscription was cancelled and no financial transaction was initiated.

## Verification-email fix, live

The first failure was confirmed in both reports and code: the server claimed an hour-long resend window before calling Firebase. A refused or failed delivery retained that claim, and a later refusal incorrectly said a verification link had been emailed.

- Failed deliveries now permit a retry after about one minute. Successful deliveries retain the one-hour limit.
- The update matches both account and original claim timestamp, so a late failure cannot release a newer send's claim.
- A thrown delivery error follows the same recovery path.
- Throttled messages no longer claim that an email was sent. They distinguish ADCode verification from GitHub's verification.
- Email verification remains required; no account was marked verified or allowed past the gate merely because it signed in with GitHub.

Live Worker version: `aaf53cf2-dc89-4370-ad0e-c71aec4a7196`. No desktop update or database migration is required for this fix. Source: `services/api/src/tagflow.ts`, `tagflowTypes.ts`, `tagflowMemoryStore.ts`, `tagflowUnavailable.ts`, and `services/api/adapters/tagflowStore.ts`.

Validation: 110 API relay/wallet tests passed, root TypeScript passed, and the isolated production build/deploy passed. PostgreSQL checks covered the minute-long retry, successful-send cooldown, stale-failure guard and denied anonymous access. Public catalogue and protected API routes were checked after deploy. Firebase delivery itself can still fail because of upstream quotas or delivery conditions; this change corrects recovery and messaging rather than claiming those upstream conditions are resolved.

## Remaining work

- Sign-in/retry task state: one 2.4.7 report contains repeated “already handling a message” errors; renderer retries and swallowed send failures need a focused reproduction and fix.
- Stream interruptions: the last-24-hour snapshot found 121 Tagflow `stream-interrupted` outcomes, including 45 near the 20-minute limit, plus 31 incomplete streams. Existing telemetry does not prove which local timer or upstream disconnect caused each interruption. Add explicit timeout-cause telemetry before changing limits.
- Heabsy capacity: the same snapshot counted 38,830 GLM, 1,574 Qwen and 1,108 MiMo upstream rate-limit failures. Retries cannot create provider capacity; these remain separate from the verification fix.
- Provider setup/compatibility: NVIDIA guidance references its official OpenAI-compatible endpoint. Custom-provider HTTP 400 cases need exact provider/model settings from the reporter. TinyLlama's lack of tool support is explained as a model capability limit.
- Unsaved-file recovery: the guard protects unsaved work but an agent repeating that blocked command reaches the identical-failure stop. Keep the guard and improve the task's recovery path.
- Report capture: a long project description exhausted the 4,000-character report limit and hid the debug section. Reserve diagnostic space in a future desktop fix rather than inferring a root cause from “eror”.
