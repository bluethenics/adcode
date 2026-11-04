# ADCode account onboarding, conversation recovery and project chats

**UI update:** The sidebar, account presentation and shared-project UI described below are superseded by [the UI restoration](ui-restoration-2026-11-02.md). Sign-in and first-time onboarding remain required; sharing is paused. Context and usage fixes remain in place.

The desktop implementation is built locally. No desktop installer or Store release was published by this task. The context-window backend is live as Worker `00c0f5b8-f076-487f-94fe-6d7d607c750d`.

## Direction and design references

- Product: a coding workspace where people sign in once, build with an agent, and collaborate in project conversations.
- Character: precise, calm, technical.
- World: a terminal and a working code editor; retain the existing neutral surfaces and accent.
- Moments: an ASCII ADCode sign-in mark and a clear verification-success state.
- Signature: terminal-style onboarding, with project/conversation breadcrumbs and compact icon controls.

Design and motion guidance: [Emil Kowalski's skills](https://github.com/emilkowalski/skills/) and [Unslop by Damir Sokolovsky](https://github.com/heydamir/unslop/tree/main), CC BY 4.0. Existing motion tokens are reused. New movement is limited to short onboarding entries, pointer feedback, hover previews and project chevrons; reduced-motion and keyboard paths remain immediate.

| Before | After | Why |
| --- | --- | --- |
| An oversized step ended in a fresh-conversation error | Bounded automatic compaction and same-task retry; local transcript extracts if summarizing also exceeds the limit | Continue completed work without replaying tools |
| An earlier summary could exceed a later compaction budget | Bound the pinned summary and reserve room for recent instructions | Repeated compaction must actually make room |
| Percentage badges could imply that a large request fit | Remove remaining-percentage badges from sidebar/account navigation | Request size and remaining daily credits are different limits |
| Account sign-in and verification were separate discoveries | A mandatory native-dialog sign-in gate, explicit email step, server verification checks, and a ready state | Make the next action clear and prevent unverified entry |
| Shared chats opened in a floating project window | Shared project conversations mount in the main chat area, with a project/conversation header and Beta label | Keep conversations in one place |
| Shared sessions had a separate list | Expandable projects in the chat sidebar, with their conversations underneath | Make project scope visible before opening a conversation |
| Footer links and an IDE promo card occupied the sidebar | Compact icon controls with accessible names and tooltips | Preserve actions while keeping navigation quiet |
| Truncated chat titles exposed little detail | Hover/focus previews with full title, update time and message count | Inspect a conversation without opening it |

## Recovery

Size refusals trigger up to two bounded recovery attempts. The recovery summary request is small; an oversized summarizer can fall back to explicitly marked transcript extracts. Old tool output is reduced while current user instructions and tool-call/result pairing remain intact. Successful requests reset the recovery counter for later agent steps. Auth errors, provider policy refusals and actual credit exhaustion remain distinct. The final fallback offers “Compact and continue” rather than discarding the conversation.

## Accounts

The gate reuses the existing Google/GitHub flows, so no new password or token store is introduced. It checks verification through the existing authenticated endpoint, polls while verification is pending, rechecks on focus, and relocks on account changes/sign-out. Version checks reject stale verification responses. Provider/browser sign-in errors stay visible. First-build onboarding waits until the gate completes.

## Shared project conversations

Private and shared transcripts remain separate. Switching back to a private chat restores the private view, including keyboard-created conversations. Shared project sessions keep individual drafts; async responses are guarded against navigation/account changes. Shared conversation refreshes preserve the focused project/session control. Replies use the existing escaped Markdown renderer. Existing ownership, membership, invite, archive and spending rules remain in effect.

## Provider context windows

The previous 262,144 global ceiling and 1 MB transport ceiling could reject histories smaller than the provider's window. The transport now accepts up to 8 MB while still bounding memory. Hosted model windows refresh from explicit provider metadata, cached per handler/isolate; a failed or incomplete provider response preserves the saved value. No model is enabled or repriced by the refresh.

Verified saved windows were updated for 37 Heabsy and 13 OpenRouter model IDs, plus direct GPT-6 Luna. Sources: [Heabsy's catalogue API](https://api.heabsy.com/site/v1/models), [OpenRouter's catalogue API](https://openrouter.ai/api/v1/models), and [official OpenAI GPT-6 Luna documentation](https://developers.openai.com/api/docs/models/gpt-6-luna). Direct DeepSeek also returns a numeric context through its authenticated model metadata. Tagflow remains at its saved 262,144 value; an independent numeric window was not confirmed from its public provider data, so it was not guessed. Other unconfigured/undocumented routes likewise retain saved values.

The public API currently offers 14 routes. Live checks confirm Qwen at 524,288; MiMo/GLM/DeepSeek at 1,048,576; direct GPT-6 Luna at 1,050,000; and continued sponsored Tagflow access. The free allowance remains 100 daily credits. Prices and purchased balances were not changed by this task. The persisted configuration's input ceiling is now 1,050,000. Rollback to an older backend parser requires restoring the previous 262,144 input ceiling first.

## Verification and artifacts

224 focused tests pass, including automatic recovery, oversized prior summaries, a 1.2 MB history, metadata parsing/caching, login/verification/sign-out, shared sessions and drafts, safe rendering, hover previews, and existing main-chat edit cards. API, desktop and web TypeScript checks pass. Dependency checks have zero errors (36 existing warnings). Desktop and production website builds pass.

Evidence is under `output/`: `provider-windows-live-2026-11-02.json`, `verified-provider-contexts-2026-11-02.json`, the guarded context-update SQL, build/deploy logs, and `account-journey-signin.png`, `account-journey-verification.png`, `shared-project-main-chat.png`. UI screenshots use fixture accounts and sample projects; no live customer account was used to test sign-in.
