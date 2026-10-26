---
slug: free-ai-without-the-meter
title: Free AI, every week
description: Included AI with a verified ADCode account: 10 million free Heabsy tokens a week, Tagflow AI without a personal quota, and bought tokens that never expire.
section: The assistant
published: 2026-10-20
updated: 2026-10-26
order: 4
related: whats-new-october-2026, ai-plans, ai-buy-tokens
---

# Free AI, every week

ADCode includes AI with a verified ADCode account. You do not need an API key, a card, or a separate subscription. Tagflow AI has no personal quota. Heabsy's models include 10 million free tokens each week, and you can raise that with a plan or top up with tokens you buy.

Nothing is required to start: sign in, verify your email, and choose an included model. The rest of this page explains the weekly allowance, what still has limits, and what happens when a request fails.

## Start with an included model

Sign in from Account with Google, GitHub or email, and verify your email address. Verification ties included AI to you rather than to a machine.

On a new installation, an included model is already selected, so you can type a message without opening a settings screen. If you used ADCode before and had no model connected, it selects one for you as well. Your own connected providers are left alone.

The model menu lists every included model, alongside models from any provider you connected yourself. Each entry says what the model can read at once. Tagflow AI is free with no weekly limit; Heabsy's models use the weekly allowance described below. Switching takes effect on your next message and keeps the conversation, including its summary and completed tool results.

Included AI accepts text and tool calls, so it can read and search your project, edit files, run commands and check its work. It does not accept image attachments. If a tool returns an image, the assistant works from the tool's text findings instead.

## The weekly allowance

Two included services have different rules.

- **Tagflow AI.** No personal request, token, daily or weekly quota from ADCode.
- **Heabsy's models (GLM 5.3 Flash, Qwen 3.8, Mimo).** 10 million free tokens each week per account, then tokens you buy.

Tagflow AI is the always-free option. ADCode sets no personal request or token limit on it, and you can switch to it at any time.

Heabsy's models give every verified account 10 million free tokens a week, shared across your devices. The week starts with your first request on them, not on a fixed day. When the free tokens are gone, Heabsy uses tokens you bought. If you have none, the chat offers Buy tokens; a task that paused carries on by itself once they arrive.

The daily allowance from 2.3 is gone. This is one weekly balance on Heabsy's models, not a daily meter, and it is separate from Tagflow AI.

## When the week runs long

A plan raises the weekly Heabsy allowance. It does not change Tagflow AI.

- **Weekly:** $3 a week for 60M tokens each week.
- **Monthly:** $9 a month for 60M tokens each week.
- **Pro:** $19 a month for 150M tokens each week, plus two invites.

A plan renews at the interval shown, and its Heabsy tokens arrive each week. Pro's two invites can each earn 4M purchased tokens for you and the friend once the friend accepts the invite before starting a paid plan and their first subscription becomes active while your Pro plan is still active. Each friend can earn the reward once.

One-time packs add tokens without a subscription: $10 for 50M, $25 for 140M, $50 for 300M. They never expire and are used only after the weekly allowance. Promo codes can add tokens or plan days once per account while they are unexpired and have uses left.

Open [AI plans and tokens](https://adcode.bluethenics.com/ai-tokens), or run AI: Upgrade Plan in ADCode, and sign in with the same account. Payment is handled by Dodo. Manage subscription on the page handles billing and cancellation; cancelling keeps the plan until the paid period ends. The step-by-step pages are [AI plans](/docs/ai-plans) and [Buying AI tokens](/docs/ai-buy-tokens).

## What free does not mean

Free refers to Tagflow AI and to the weekly Heabsy allowance. It does not promise that every model, every request size or every moment will work, and past the weekly allowance Heabsy uses tokens you bought.

- **Tagflow AI.** No personal request, token, daily or weekly quota from ADCode.
- **Heabsy's models.** 10 million free tokens a week; after that, bought tokens. A plan raises the allowance but does not make capacity infinite.
- **Provider availability.** A provider can be slow, rate-limit requests, or be unavailable for a while. The chat names the provider and explains the wait.
- **Context limits.** The conversation, tool results and reply share the model's context window. ADCode compacts a long conversation as it fills, but a single request can still be too large, and a reply can still reach its output limit.
- **Shared service capacity.** Included AI is a shared service. At a busy time you may be asked to wait or try again. Free does not reserve a private machine for each request.
- **Account access.** Included AI needs a verified account. An account can be blocked or have included AI switched off.

None of these is a hidden personal quota. They are the limits of the provider and the service doing the work.

## Where your request goes

Included AI does not put a provider key on your computer. When you send a message, the prompt, the relevant project context and the tool results pass through ADCode's server to the selected provider. The server stores usage counts, not your prompts or replies.

Only the context needed for the request is sent.

## Check Usage

Select Usage in the chat's header, or run AI: Show Usage from the command palette. Choose Today, 7 days, 30 days or All time to see this computer's history: tokens in and out, requests, and an estimated cost for models you pay for.

With a Heabsy model selected, the included AI card and the composer meter show the weekly allowance, what is left and when it refills, plus your purchased balance. Tagflow AI shows no personal quota.

The activity calendar always shows the past year. Each square is a local calendar day with at least one AI request from chat or an agent on this computer. It shows your current streak, longest streak and active days. Hover, select or focus a square to see its date, requests and tokens; the arrow keys move between days, and Home and End jump to the oldest and newest day.

Clear usage removes this computer's history, activity and streaks. It does not change your account's allowance or bought tokens. Your own provider's billing page remains the exact record for models you pay for.

## If a request fails

A dropped connection does not end the turn. ADCode retries inside the same turn for about two minutes, with a short pause between attempts and a status line that says what is happening. Stop cancels the wait. Completed tool steps are not repeated when the request resumes, so the assistant carries on from where it was instead of re-reading files or re-running commands. If the connection stays down, the message names the network error.

If the week's allowance is used up, the card offers Buy tokens instead. The task that paused continues by itself once the tokens arrive.

If the problem is the model rather than the network, the failure card offers a way forward. Choose Switch model, either from the card or from the model chip beside the send button. After a rate limit, an unavailable model or a rejected key, choosing a model that can answer resumes the request by itself. You do not retype the prompt, and the conversation, its compacted summary and its completed tool results travel with it.

The card explains the failure in plain words. Depending on the cause it offers Try again, Switch model, Start fresh with this request, View AI usage or Report problem. Open Details to read the provider's exact message.

## Use your own key or a local model

Included AI is one option, not a lock-in. Open Connect a model and choose Bring your own key to add a provider account. ADCode checks the key before saving it, and the operating system's credential store holds it. Requests then go from your computer to that provider under your account, at that provider's prices. A provider you connect may support image attachments or a larger context window.

For work that should not leave the machine, connect a local model through Ollama. It needs no key and sends nothing to a provider. Its speed and abilities depend on the model and your hardware. Local models work with a smaller set of tools and are not offered helpers.

You can switch between included AI, your own provider and a local model at any time. The conversation stays, so trying another route after a failure does not cost you the work already done.
