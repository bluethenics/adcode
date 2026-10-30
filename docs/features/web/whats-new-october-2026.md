---
slug: whats-new-october-2026
title: "What's new in ADCode: October 2026"
description: "What shipped in ADCode 2.2, 2.3 and 2.4, plus the late-October AI plans, token packs, custom connectors and the next desktop update."
section: Start here
published: 2026-10-20
updated: 2026-10-26
order: 1
related: adcode-in-your-browser, helpers, connectors, free-ai-without-the-meter
---

# What's new in ADCode: October 2026

October brought three releases: 2.2 on 9 October, 2.3 on 12 October with two fixes close behind, and 2.4 on 20 October. The last week of the month added AI plans and token packs, and prepared a faster way to add a custom connector for the next desktop build. Some changes add capability; others change how Vibe feels.

If you have not updated, install the current build from [Versions](/versions). On Windows the signed installer comes from the Microsoft Store, which avoids the SmartScreen warning and keeps ADCode updated. Linux uses a .deb or AppImage. macOS desktop builds are not published.

Two parts of this page are not in the published desktop build yet: the direct custom connector button and the new update notices below. Both are marked where they appear. The website and AI service changes are live.

## Open source, under Apache-2.0

The source is public at [github.com/bluethenics/adcode](https://github.com/bluethenics/adcode) under the Apache License 2.0. You can read, build, change and share it. The licence does not cover the name or logo, so a modified copy needs its own name.

Help > Open Source Licences shows ADCode's licence, its notice and the licence of every package in the installer; the same files ship in `resources/licenses`. See [Open source licences](/docs/workbench-open-source).

## Included AI and daily plans

All Heabsy models and Tagflow AI now share 5M free tokens daily. No subscription is required for included models. The allowance resets 24 hours after first use. Weekly ($3/week) includes 20M daily, Monthly ($9/month) includes 100M daily, and Pro ($29/month) has unlimited tokens. Purchased tokens are used after finite allowances and never expire.

See [Free AI, every day](/docs/free-ai-without-the-meter) and [AI plans](/docs/ai-plans).

## Chats keep working, and answers show their work

Leave a chat working and start another: up to four run at once, or one at a time in Review mode. A spinner marks a working chat, a green dot one finished while you were away, and an amber dot one stopped early. Minimising ADCode does not stop the work, and a notification says when a chat finishes. See [Chats that keep working](/docs/ai-background-chats).

Each answer is now a timeline of thoughts, tool calls and text in the order they happened; repeated calls are grouped into one row. When the turn ends it folds to "Worked for Ns" with the answer below. Scroll back and a Jump to latest pill counts missed messages. See [AI chat workspace](/docs/ai-chat-widget).

## Helpers: the assistant can split a job

For a job with independent parts, the assistant can use up to four helper agents, each with a fresh context and the same model. Explore helpers only read and search; build helpers can edit files and run commands, and are told to stay in their own files.

Helpers belong to the same turn, so one Undo covers their edits and Stop stops them all. They cannot start their own helpers, and local models are not offered them. Type `/helpers`, or let the assistant decide when to split the work. See [Helpers](/docs/helpers).

## Project instructions, rules and hooks

ADCode reads your project's `AGENTS.md`, plus `CLAUDE.md`, `GEMINI.md`, GitHub Copilot instructions and your own `~/.adcode/AGENTS.md`. `/init` asks the assistant to read the project and write an `AGENTS.md` with the real install, build, run and test commands. The file describes the project; it cannot grant permissions, and what you say in chat still wins. See [Project instructions](/docs/ai-project-instructions).

Rules are separate. In `.adcode/settings.json` you can allow, ask or deny a tool, with an optional command or path pattern. Deny wins, and a chained command is checked part by part. Hooks can run before or after a tool call, at session start, or when the assistant tries to stop; exit code 2 blocks a call or sends it back to work. A project's hooks run only after you approve them once, and you are asked again when they change. See [Agent rules and hooks](/docs/ai-agent-rules).

## Prompt caching

Long runs re-send the same instructions, tool list and earlier messages at every step. ADCode now asks providers to cache that repeated beginning. With Claude it marks the cache explicitly; other compatible providers cache a repeated beginning themselves, and ADCode keeps history in the same order and bytes so the cache can match.

Cached tokens appear in AI usage, with the saving per model. A cache lasts a few minutes, so a chat you return to much later starts fresh. Included AI usage still counts every input token, cached or not. See [Prompt caching](/docs/ai-prompt-caching).

## Connectors for the tools you already use

Tools → Connectors accepts MCP servers, Claude Desktop extensions, Claude Code plugins and OpenAI-style actions. Add one from the catalogue, import what Claude Desktop, Claude Code, Cursor, Windsurf or VS Code already have, read a config file, OpenAPI description, `.mcpb` extension or plugin folder, or set one up by hand.

What it finds waits as a dashed card until you press Add, so nothing installs by accident. Extension and plugin files are copied into ADCode's folder; hooks are copied but never run. Secrets go to the operating system's encrypted store, or the private cloud workspace on the web. See [Connectors](/docs/connectors).

### Add a custom connector without the tour

In the next desktop build, **Add custom connector** sits beside Add connector on the Connectors tab. It opens the custom form directly: give the server a name and its MCP URL, then press Continue. The ID comes from the name, so there is nothing to invent; ADCode saves the server and tries to connect straight away. If the connection fails, the server stays saved with the reason on its card. Until that build arrives, Add connector → Custom connector opens the same form.

Advanced holds the optional ID, SSE, a local command, its arguments, and headers or environment values. Open Tools on the card afterwards to turn on the tools the assistant may use. The full route, including a local command, is in [Connectors](/docs/connectors).

## Team agents and the live room

2.2 made Team agents talk. Give two to four named agents a shared task and they message each other mid-run, share project memory and hand work on. The live room above the chat gives each agent a window with its mascot, current file or command, and the messages between teammates. Each window ends with Checks passed, Check failed or Unverified, based on commands the agent actually ran. You can stop one agent, a team, or every run.

Teams count towards the agents working at once, and share a connection's request limit. The live view can be turned off in Settings. See [AI Team](/docs/ai-team) and [Live agent view](/docs/ai-live-agents).

## The new Vibe window

2.4 gives Vibe an icon rail, a sidebar card for the project and chats, a tab per open chat, new type, quieter borders and the app menus behind one button. The IDE window keeps its own chrome. [The new Vibe window, explained](/docs/the-new-vibe-window) is a full tour, including what did not change.

## Invite & earn, reports and the status page

Invite & earn gives every account a link and shows who joined and what it earned. For 365 days you receive 10% of what ADCode earns from ads an invited person sees, and 5% of what an advertiser you bring spends. Both come from ADCode's share, not theirs. On Windows the Store installer drops a link's query string, so the code travels by clipboard or the paste box.

This is separate from the Pro invite on the AI tokens page: Invite & earn shares ad revenue for a year, while a Pro invite gives AI tokens to you and a friend when that friend starts a paid plan.

Administrators get per-model health and provider reports: demand, usage, reliability, response speed and optional feedback. Model-level data starts on 11 October; older totals are not shown as model history. The public [status page](/status) shows measured health for included models over 90 days, with an incident log and RSS feed. Only included models appear; a model on your own key is not ADCode's service.

The browser workspace is in preview: the repository contains browser chat, saved conversations and GitHub review, but production is paused. Read [ADCode in your browser](/docs/adcode-in-your-browser) for what is planned, not as something available today.

## Smaller fixes worth knowing

2.3.1 made slash commands typed with words work like chosen commands, kept attachments visible after sending, and gave local Ollama models a smaller toolset. 2.3.2 retried a free AI task after a dropped connection for about two minutes without repeating completed steps, and stopped a sign-in refresh from asking you to sign in again.

In the last week of October, the AI service also closes an interrupted or cancelled answer cleanly and keeps a complete final message even when the connection closes straight after it. You get the answer or a readable error instead of a response that never finishes.

## Coming in the next desktop build: updates that wait for you

**Not in the published desktop build yet.** The desktop work is complete and tested, but its installers have not been published. This is what the next build will do.

When a new version is available, a quiet card offers Update now or Later, once per version and only when you are not typing. Update now finishes the download in the background while the status bar shows progress. If you choose Later, a separate card appears when the update is ready and offers Restart now or Later.

Restart protects your work first. Every editor window saves its exact unsaved recovery snapshot before ADCode closes. If crash recovery is off and a window has unsaved changes, ADCode asks you to save instead. An unresponsive or unprotected window blocks the install, and the current version stays usable. Ignoring the cards installs the downloaded update the next time you close ADCode normally. Microsoft Store builds open the Store, and portable builds open the official download page.

The same build also retries a temporary free-AI server error a few times before ending the turn, explains when the signed-in account changes mid-task, and recovers a settings save when Windows redirects the settings folder instead of failing silently. Mouse-wheel scrolling works on overflowing chat tabs.

The update settings and the in-app release notes are documented under [Automatic updates](/docs/updates-auto) and [What's New](/docs/updates-whats-new).

## What to try first

1. Open [AI plans and tokens](https://adcode.bluethenics.com/ai-tokens) and compare the weekly allowances with your own usage.
2. Add a custom connector by name and URL through Add connector → Custom connector, or import one you already use in another editor.
3. Update to 2.4, hide the sidebar with Ctrl+B, and start a second chat with Ctrl+Shift+N.
4. Ask for a job with independent parts and begin the message with `/helpers`.
5. Run `/init`, read the `AGENTS.md`, and correct what it got wrong.
6. Check AI usage for cached tokens after a long chat.
