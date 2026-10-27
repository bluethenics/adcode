# Error report triage — 27 October 2026

43 new report rows from 29 accounts after the previous cutoff `1792980050256`, read through the recent-report index only (two bounded pages; no scans). New cutoff: `1793104688058`. Every report is from 2.4.0 or older, or the website. No replies have been sent yet: the drafts below wait for the relay fix to be live and for the owner's go-ahead.

## What the reports show, and what changed

| Finding | Reports | Change |
| --- | --- | --- |
| **"Included AI stream interrupted"** on `tagflow-code-27b`. The request log for the last three hours shows 103 of ~1,220 requests (8.4%) failing within ~6 s (max 8.7 s) and *before the first token*. | 27 rows, 19 accounts, Windows/Linux/macOS | `f13e2620`: the relay asks the provider again (twice at most) when a stream fails before any token, so the person never sees it. Once text has gone out it does not retry. Server-side: every desktop version benefits once deployed. |
| **"Unlimited" while Heabsy stops at 10M a week.** The sidebar badge said Unlimited whenever Tagflow has no limit; Heabsy models still stop at the free weekly allowance, which refills a week after the first request (not daily). | `rep-1-1793103757614` ("Ur doing Wrong marketing"), `rep-82-1793035873143` | `a8da012a`: the badge counts the Heabsy tokens actually left, with a tooltip that separates Tagflow (no limit) from Heabsy (weekly). The limit itself is now a card with the exact reset time, a countdown, and Upgrade plan / Buy tokens / Switch model. Desktop release needed. |
| **PowerShell commands run in cmd.exe.** Agents wrote `Get-ChildItem`, `ForEach-Object`, `Invoke-WebRequest`; cmd.exe answered "not recognized", and the three-identical-failures guard ended tasks. | `rep-3-1793092512706`, `rep-3-1793081640374`, `rep-5-1793023471394`, `rep-63-1793038290734` | `a8da012a`: on Windows a command that is plainly PowerShell runs in Windows PowerShell; the tool description tells models which shell runs their line. Desktop release needed. |
| **"No API key for tagflow" on Linux** with an empty model: free AI's model list had not loaded, and the message wrongly asked for a key. | `rep-108-1793066614951` | `a8da012a`: the chat now says free AI could not load its models, that no key is needed, and offers Try again. Desktop release needed. |
| Images sent to text-only free models (`images-not-supported`). | `rep-13-1793098429448`, `rep-1-1793018622370`, plus lines in 3 others | Working as designed; the message is clear. Reply explains which models read images. |
| Verify / sign-in prompts, "account changed". | `rep-1-1793080005111`, `rep-15-1793012853527`, `rep-1-1793049464874`, lines in 4 others | Working as designed; replies point to the verification email. |
| Provider-side failures on the person's own keys: Gemini 503 "high demand"; a custom provider (`axonagent.xyz`) 502. | `rep-3-1793104499613`, `rep-43-1793061164520`, a line in `rep-1-1793035531190` | Not ADCode's; replies explain and suggest included AI meanwhile. |
| Feature requests: view sub-agent sessions on the web; IntelliSense in the IDE. | `rep-4-1793018127633`, `rep-3-1793004466276` | Logged for the roadmap. |
| Not a report (`NEXUS STORE` / `boraa`). | `rep-1-1793050205167` | No reply. |

## Draft replies (send after the relay deploy, with the owner's approval)

Sender: `ADCode <adcode@bluethenics.com>`. Recipients come from each account's keyed user record, never the report body. One reply per account; it is recorded against every listed report.

**A. Stream interruptions only** — `rep-8-1793104688058`; `rep-32-1793096666021`; `rep-1-1793096596212`, `rep-10-1793095866711`; `rep-5-1793076827107`, `rep-18-1793076169088`, `rep-22-1793070890663`; `rep-11-1793076638192`; `rep-42-1793076098952`, `rep-8-1793066026642`; `rep-1-1793066356364`, `rep-1-1793037550705`; `rep-9-1793066281995`; `rep-5-1793055638867`; `rep-45-1793054166747`, `rep-87-1793030416076`; `rep-1-1793052058112`, `rep-1-1793051504361`; `rep-11-1793051989724`, `rep-49-1793042518259`; `rep-41-1793051656455`; `rep-3-1793042141896`; `rep-1-1793035531190`, `rep-1-1793029018766`; `rep-37-1793029905618`; `rep-7-1793026666601`

> Thanks for reporting "Included AI stream interrupted". We found the cause: the Tagflow Code model's provider was dropping some answers in the first few seconds, before any text arrived. ADCode's server now asks again automatically when that happens, so those answers come through instead of failing. The fix is on our server, so there is nothing to install - just send your message again. If you still see it, reply to this email and we'll look at your case directly.

(For accounts whose logs also show images or sign-in prompts, add the matching paragraph from C or D.)

**B. "Unlimited" vs the 10M weekly limit** — `rep-1-1793103757614`, `rep-3-1793092512706` (one account); `rep-82-1793035873143`

> You're right, and thank you for saying it plainly. Tagflow AI has no ADCode limit, but Heabsy models include 10M free tokens per week, and the week starts from your first Heabsy request - it isn't a daily reset, which is why the time moved past 24 hours. The "Unlimited" label didn't make that clear. The next ADCode update shows exactly how many Heabsy tokens you have left, and a paused task now shows a card with the reset time and a countdown, and carries on by itself. Until then, Tagflow AI keeps working with no limit, or a plan from $3 a week raises the Heabsy allowance: https://adcode.bluethenics.com/pricing

(For `rep-3-1793092512706`, add E.)

**C. Images on a text-only model** — `rep-13-1793098429448` (with A), `rep-1-1793018622370`, `rep-63-1793038290734` (with A and E)

> The free Tagflow Code and Qwen models read text only, so a message with an image attached is refused. Remove the image, or describe what it shows, and send again; for screenshots, connect a model that reads images (for example a Gemini or OpenAI key) in Connect a model.

**D. Verify / sign in** — `rep-1-1793080005111`, `rep-3-1793081640374` (one account, with E); `rep-15-1793012853527`; `rep-1-1793049464874`

> Free AI needs a signed-in account with a verified email - no API key. Open the verification link we emailed you (check spam; a new one can be sent an hour after the last), then send your message again. "The signed-in account changed" means the task was started under another account; start it again and it runs on the current one.

**E. PowerShell commands on Windows** — `rep-3-1793092512706`, `rep-3-1793081640374`, `rep-5-1793023471394`, `rep-63-1793038290734`

> Some of your task's commands failed with "is not recognized as an internal or external command". The assistant wrote PowerShell commands, and ADCode ran them in Command Prompt. The next ADCode update runs PowerShell commands in PowerShell automatically. Until then, asking the assistant to "use Command Prompt (cmd) commands" avoids it.

**F. Free models not found on Linux** — `rep-108-1793066614951`

> Sorry for the confusing message: free AI never needs an API key. "No API key for tagflow" appeared because ADCode couldn't load the free model list at that moment. Open Connect a model, choose Free · no API key, sign in, and pick a model; if the list is empty, check your connection and reopen it. The next update says this plainly and offers Try again.

**G. Provider errors on your own key** — `rep-3-1793104499613` (Gemini 503); `rep-43-1793061164520` (custom provider 502)

> That error came from your model provider, not ADCode: Google answered "high demand" (503) / your custom provider's server returned "502 Bad gateway". It usually passes within minutes. Meanwhile you can switch to ADCode's included AI (Free · no API key) in Connect a model and carry on.

**H. Feature requests** — `rep-4-1793018127633` (sub-agent sessions on the web), `rep-3-1793004466276` (IntelliSense)

> Thanks for the suggestion - it's on our list. (Sub-agents: their progress appears in the Helpers step of the chat today; opening each one's own session is the part we'll add. IntelliSense: the IDE has language-server completions for TypeScript/JavaScript and more; tell us which language you need, and we'll prioritise it.)

No reply: `rep-1-1793050205167`.

## Follow-up, 28 October 2026 (IST): queue closed out

Six more reports arrived after the cutoff above (`rep-9-1793107079245`, `rep-1-1793107083758`, `rep-5-1793107181502`, `rep-32-1793107306597`, `rep-17-1793107792475`, `rep-25-1793122723930`); all six are "Included AI stream interrupted" from 2.4.0, all sent before the relay fix went live (17:38 UTC at the latest; Worker `f23c70eb` was deployed at about 17:45 UTC).

The relay fix (`f13e2620`) halved the failure but did not remove it. `ai_model_requests`, each row one request after its retries: in the six hours before the deploy, 137 of 10,376 requests (1.32%) ended `stream-interrupted`, 136 of them before any token; in the first 1 h 45 min after it, 15 of 2,041 (0.73%), all before any token - so these reached people even after two restarts.

Queue actions, with an `audit_log` row each (`report:<status>:<id>`, admin `FPEuDxd945b5OTF38Jdlg5Oxg2V2`):

- **Closed 68**: the 52 already triaged and answered on 24-26 October, and 16 open ones that are fixed in 2.4.4 (Unlimited badge, PowerShell in cmd, "No API key" on Linux), working as designed (images on text-only models, email verification), the person's own provider failing (Gemini 503, custom provider 502), or feature requests (IntelliSense; sub-agent sessions on the web).
- **Deleted 2** that are not reports: `rep-1-1793050205167` ("NEXUS STORE" / "boraa") and `rep-11-1792633259685` (a build prompt pasted into the form).
- **Kept 32 as triaged**: the 26 stream-interruption reports in group A above and the six new ones, until the stream failure rate is near zero.

The draft replies above have still not been sent.
