---
slug: whats-new-2-4-12
title: "What's new in ADCode 2.4.12"
description: "Fork chats that split a job into parallel conversations, clearer credits that pause instead of failing, purchases in any currency, and more room on smaller screens."
section: Start here
published: 2026-11-03
order: 1
related: ai-chat-forks, free-ai-without-the-meter, whats-new-october-2026, helpers
---

# What's new in ADCode 2.4.12

2.4.12 brings fork chats: one conversation can split a job into several that work at the same time and talk to each other. It also fixes most of what you reported about credits in early November, makes the app easier to use on laptop-sized screens, and points the way out of the errors that used to be dead ends.

Some of these changes are on ADCode's servers and already live in every version. Each section below says which.

## Fork chats: one job, several conversations at once

Ask for something with independent parts, such as a new settings page, its API and its tests, and the assistant can split it into **fork chats**. Each fork is a real conversation with its own tab. It starts with a copy of the conversation, so you never repeat the brief. It works on its own part, and you can open, redirect or stop it.

The chats coordinate while they work. A fork can warn its siblings before it edits a shared file, ask the main chat a question, or report a decision. The main chat waits for the forks' reports, checks the combined result and tells you what was done.

- **The assistant forks on its own** when a request splits into independent parts that each take real work. It says which forks it started. Small or tightly connected tasks stay in one chat.
- **You can fork yourself:** press Fork in the chat header, choose Fork this conversation from a conversation's menu, or run AI: Fork This Conversation.
- **History shows each family as a tree:** the main chat on top, its forks beneath it.
- Up to three forks start at once, and a chat keeps up to six. Forks don't start forks of their own.
- Turn self-forking off in **Settings > AI > Fork chats on its own** if you'd rather ask for each fork.

Read the full guide: [Fork chats](/docs/ai-chat-forks).

## Credits that say what is happening

*Live on the servers for every version since 2 and 3 November.*

- **No more false "conversation too big".** ADCode estimated each step's cost about three times too high, and refused requests you could afford, sometimes on a brand-new chat. It now prices a step on its real size.
- **Running out pauses instead of failing.** When today's credits can't cover another step, the task waits and carries on by itself when your credits refill. The card says when that is, and how to keep going now: upgrade, add a credit pack, or switch to a model that uses no credits.
- **The meter shows what you spent.** A long reply sets aside its largest possible cost while it runs and returns the rest when it ends. The meter used to count that as spent, so it seemed to plunge and recover. It now shows only what you used, and the tooltip names what is set aside. *(This app version.)*

## Buying credits from anywhere

*Live on the servers since 2 November.*

Credit packs paid in a local currency, such as reais, euros or pounds, were charged but not credited. Packs are now charged in US dollars, so the amount always matches, and every affected purchase has been credited. Purchased credits show under **Purchased** on the [AI credits page](https://adcode.bluethenics.com/ai-tokens) and in the app's credit meter.

## More room on smaller screens

*This app version.*

- **AI usage scrolls as one.** Your balance, the range tabs and the activity grid now share one scrolling area, and the range tabs stay pinned at the top.
- **Chats get the sidebar.** On windows under 900 pixels tall, the sidebar's links fold into one row of icons, and the desktop card keeps only its button. That gives your chat history about 200 pixels back.

## Ways out of the errors that used to stop you

*This app version.*

- **Unsaved files:** if your unsaved edits stop the assistant mid-task, the card names the files and offers **Save all and continue**.
- **Custom providers:** a failed connection check now says what usually causes it: the address (often a missing `/v1`), the model name, or the key.
- **Accounts with no email:** if your sign-in didn't share an email address, you can add one and verify it from the sign-in screen.
- **Retired models:** when a provider retires a model and names its successor, the card tells you which model to pick.
- **Ollama:** when a local model's context window is too small, the card says exactly which setting to raise.

## Smaller changes

- **New** tags mark models and features added in the last 45 days, in the model menu, Connect a model, the Feature library and the [pricing page](https://adcode.bluethenics.com/pricing).
- The pricing page's credit table lists only the models you can use today.
- Free accounts can run four AI requests at once, up from two. Extra requests wait their turn instead of failing. *(Live on the servers.)*
- Join Discord now shows Discord's own icon.

## Getting it

On Windows, the Microsoft Store updates ADCode for you once the new version is approved. Installers for Windows and Linux are on the [Versions](/versions) page. The server changes above already apply to every version.
