/**
 * November 2026 reports and updates, published under /docs with the rest of ADCode's writing.
 *
 * The charts and diagrams are SVG files in public/images/blog, drawn from a measured replay of
 * one coding task (docs/token-efficiency-2026-11-13.md says how). Every chart is followed by a
 * table holding the same numbers, so nothing here is readable only as a picture.
 */
interface Report {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly published: string;
  readonly body: string;
  readonly surface: "docs";
  readonly section: string;
  readonly order: number;
  readonly related: string[];
}

const comparison: Report = {
  slug: "adcode-vs-claude-code-codex-opencode-t3-code",
  title: "ADCode vs Claude Code, Codex, OpenCode and T3 Code: the November 2026 report",
  description:
    "A side-by-side report on five ways to code with an AI agent - price, models, editor, phone access, open source, and how much each request costs in tokens - with tables, charts and the cases where another tool is the better pick.",
  published: "2026-11-13",
  surface: "docs",
  section: "Comparisons",
  order: 1,
  related: ["adcode-2-6-1-fewer-tokens", "adcode-vs-vs-code-vs-cursor", "zeekend-sponsored-cards-phone-and-notifications"],
  body: `
Five tools now compete for the same job: you describe a change, an AI agent reads your project, edits files, runs the tests and reports back. They differ in what they cost, which models they run, how much of an editor they give you, and how many tokens they spend doing it. This report puts them side by side as of 13 November 2026.

The five: **ADCode**, a full code editor with the agent built in; **Claude Code** in Anthropic's desktop app; **Codex**, OpenAI's agent in its desktop app, CLI and cloud; **OpenCode**, an open-source agent for the terminal, desktop and web; and **T3 Code**, an open-source app that drives other agents from one window.

## The short answer

- **Cheapest to start:** ADCode, OpenCode and T3 Code all cost nothing to install. Only ADCode also includes a model: Free AI gives 140 requests a day with no key and no card. OpenCode needs a model provider, and T3 Code needs a Codex or Claude plan underneath it.
- **Most editor:** ADCode is the only one of the five that is a complete code editor - files, tabs, search, terminal, git and debugger - with the agent inside it. The others are agent apps that show diffs and previews.
- **Most models:** ADCode and OpenCode both run models from several providers, including one on your own machine. Claude Code runs Claude; Codex runs OpenAI's models.
- **Fewest tokens per task:** in ADCode 2.6.1, the same 23-step task costs 44% fewer billed input tokens than in 2.6.0, because the provider's cache now holds for every step. The details are below and in [the efficiency report](/docs/adcode-2-6-1-fewer-tokens).
- **Only one that pays you:** ADCode shows sponsored cards and credits you half of what they earn. Turn them off and it is still free.

## At a glance

| | ADCode | Claude Code (desktop) | Codex (app) | OpenCode | T3 Code |
|---|---|---|---|---|---|
| What it is | A full code editor with an AI agent built in | Anthropic's coding agent in a desktop app | OpenAI's coding agent in a desktop app, CLI and cloud | An open-source agent for the terminal, desktop and web | An open-source app that drives other agents |
| Cheapest way to start | Free, with Free AI (140 requests a day) | Claude Pro, $20 a month | ChatGPT Plus, $20 a month; Free and Go get a lighter model | Free app; pay a model provider, or OpenCode Go at $10 a month | Free app; needs a Codex or Claude plan |
| Models | Four providers or any OpenAI-compatible endpoint, including a local model | Claude | OpenAI | Many providers, with your own keys | Whatever the connected agent runs |
| Code editor | Full editor: files, search, terminal, git, debugger | Diff review and previews | Diff review | Terminal interface | None - it is a control panel |
| From your phone | Phone link: chat with the assistant on your own computer | Cloud sessions in the Claude app | Cloud tasks in the ChatGPT app | Web app | iOS and Android app |
| Open source | Yes, Apache 2.0 | No | The CLI is | Yes, MIT | Yes, MIT |
| Earn while you code | Yes - half of what sponsored cards earn | No | No | No | No |
| Token savings built in | Cache held across every step, stale tool output cleared in batches, compaction, a lean mode for small models | Prompt caching, compaction | Compaction | Old tool output pruned, compaction | Whatever the connected agent does |

![What it costs to start, per month. ADCode, OpenCode and T3 Code are free to install; Codex and Claude Code start at $20.](/images/blog/coding-agents-starting-price.svg)

| Tool | Starting price a month | What you get for it |
|---|---|---|
| ADCode | $0 | Editor, agent and Free AI - 140 requests a day |
| OpenCode | $0 | The agent; models are paid to the provider you connect |
| T3 Code | $0 | The app; the agent underneath needs its own plan |
| Codex | $20 | ChatGPT Plus; the Free and Go plans get a lighter model |
| Claude Code | $20 | Claude Pro; the free plan does not include Claude Code |

## Where ADCode is ahead

- **One window for the whole job.** The agent edits the same files you have open, in the same editor, with every turn undoable. You never copy a diff from an agent app into an editor.
- **Free that actually works.** Free AI is built in: no key, no card, 140 requests a day. Paid plans add more when you want them.
- **Any model, per chat.** Pick a provider per conversation, connect your own key, or run a model on your computer. Race mode can give one task to two or three models and keep the best answer.
- **Your computer, from your phone.** Phone link connects your phone to the assistant on your own computer, so the work runs where your project and tools already are - not in a cloud copy of it.
- **It pays you back.** Half of what sponsored cards earn is credited to you. The cards are walled off from your files, and one switch in Settings turns them off.
- **Fewer tokens for the same work.** See the next section.

## Efficiency: what we measured

Every agent re-sends the whole conversation with each step, so the cost of a task grows with every file it reads. We replayed one realistic 23-step task - add a dark mode toggle, fix a failing test, check the page, then remember the choice - through ADCode's own request builder, before and after the 2.6.1 changes, and counted every token.

![The same 23-step task: input tokens sent fell 20% and billed input fell 44% from ADCode 2.6.0 to 2.6.1.](/images/blog/adcode-2-6-1-billed-tokens.svg)

| Measure, whole task | ADCode 2.6.0 | ADCode 2.6.1 | Change |
|---|---|---|---|
| Input tokens sent | 603,458 | 482,879 | −20.0% |
| Billed input, with cache pricing | 208,777 | 117,487 | −43.7% |
| Size of the last request | 36,499 | 27,396 | −24.9% |
| Steps allowed per message | 50 | 100 | 2× |

Two changes do most of it. The host context - which file is open, where the cursor is, what is running - is now read once per message instead of at every step, so the provider's cache keeps hitting instead of being thrown away whenever the cursor moves. And file reads that have gone stale, because the file was edited or read again later, are cleared from what is sent in batches that leave the cache intact in between. [The efficiency report](/docs/adcode-2-6-1-fewer-tokens) has the full method and every chart.

We then measured all five side by side by recording every request each one sent on the same task. ADCode 2.6.1 sent the fewest tokens - 37,175 against 44,401 for DeepSeek Harness, 48,066 for Codex, 50,589 for OpenCode and 91,586 for Claude Code - and added the least time between steps. [The benchmark](/docs/coding-agent-token-benchmark) has every number, chart and the method.

## When to choose one of the others

- **Claude Code** if you work only with Claude, want Anthropic's own harness tuned for its models, and already pay for a Claude plan. It is also on macOS today, which ADCode is not yet.
- **Codex** if you live in ChatGPT, want cloud tasks that run while your laptop is closed, and your ChatGPT plan already covers it.
- **OpenCode** if you want a terminal-first agent you can read and change line by line, with your own keys.
- **T3 Code** if you already pay for Codex or Claude and want one window to run several agents side by side.

ADCode is the pick when you want the editor and the agent in one place, a free tier that works on day one, any model you like, your own computer reachable from your phone, and the fewest tokens spent per task.

## How we compared

Token and speed figures for all five come from [the benchmark](/docs/coding-agent-token-benchmark). Prices and plans come from each product's public pages and reporting as of 13 November 2026, and plans change often - check before you buy. ADCode's token figures come from replaying the task through ADCode's own code with the o200k tokenizer, using real files from the ADCode repository as the files being read, and Anthropic's cache prices (reads at a tenth of the input price, writes at 1.25 times). A provider without caching sees the 20% drop in tokens sent rather than the 44% drop in billed input.
`,
};

const efficiency: Report = {
  slug: "adcode-2-6-1-fewer-tokens",
  title: "ADCode 2.6.1: the same work for 44% fewer billed tokens",
  description:
    "Why a moving cursor used to cost money, what ADCode 2.6.1 changed in every AI request, and the measured result on a 23-step task: 20% fewer tokens sent, 44% fewer billed, and twice as many steps per message.",
  published: "2026-11-13",
  surface: "docs",
  section: "How ADCode works",
  order: 30,
  related: ["adcode-vs-claude-code-codex-opencode-t3-code", "every-feature-the-full-tour"],
  body: `
An AI agent does a task in steps: read a file, edit it, run the tests, read the output, edit again. Every step is a new request to the model, and every request carries the whole conversation so far. By the twentieth step the model is reading the same files for the twentieth time, and you are paying for it - in money on a paid model, in daily requests on Free AI, and in time either way.

ADCode 2.6.1 changes how each request is built. On the same 23-step task it sends **20% fewer tokens**, the provider bills **44% fewer**, and one message may now run **100 steps instead of 50**, so long tasks finish instead of stopping half done.

## What every request starts with

Before your first word, each request carries ADCode's instructions, the definitions of the tools the agent can call, and the host context: which project is open, which file you are looking at, what is running. In 2.6.0 that was about nine thousand tokens; in 2.6.1 it is about five thousand, the lightest of five coding agents we measured.

![What the first request carries in five coding agents: ADCode 5,237, DeepSeek Harness 5,273, OpenCode 6,808, Codex 8,192, Claude Code 17,581.](/images/blog/benchmark-first-request.svg)

| Part | Tokens in 2.6.1 | Change |
|---|---|---|
| Tool definitions | 3,645 (21 tools) | Was 7,430 for 40: rarely used tools are listed by name in load_tools and sent in full once loaded |
| System prompt | 1,028 | Was 1,252: the same rules, said once instead of twice |
| Host context and guidance | about 540 | Was about 800: read once per message, and no longer repeats the system prompt |

The whole comparison is in [the token and speed benchmark](/docs/coding-agent-token-benchmark).

Providers cache this part, so after the first step it is read at a tenth of the price. The trouble was what came after it.

## Why a moving cursor used to cost money

Providers cache a request by its beginning. If the start of the next request matches the start of the last one, the matching part is read from cache, cheaply; from the first difference onward, everything is processed again at full price - and written to the cache again, at a quarter more.

ADCode put the host context near the start of every request and read it fresh at every step. The moment it changed - you moved the cursor, a dev server printed its address, the preview opened - the whole conversation behind it stopped matching. Twenty steps into a task, that is tens of thousands of tokens processed again, several times per task.

![Why a moving cursor used to cost money: in 2.6.0 a change in the host context made the whole conversation after it miss the cache; in 2.6.1 the context is held for the whole message.](/images/blog/prompt-cache-before-after.svg)

ADCode 2.6.1 reads the host context once, when your message starts, and holds it until the message is done. Anything that changes because of the agent's own work - a server it started, a page it opened - is already in that tool's result, so nothing is lost. Your next message reads the context fresh.

## Clearing what has gone stale

The second change is about what the conversation carries. A file the agent read at step 3 and edited at step 6 is out of date by step 7 - and it was still being sent, in full, at every step after. So was the output of a test run three runs ago.

ADCode 2.6.1 replaces that output with a one-line note in what it sends: a read of a file that was edited or read again later, and older output beyond the newest sixteen thousand tokens of tool results. The newest results, your answers to the agent's questions, skill instructions and the plan are always kept. It clears in batches of at least six thousand tokens, so between batches the conversation stays byte-for-byte the same and the cache keeps hitting.

Your chat is untouched. The saved conversation, every tool card and every file read are all still there; only what is sent to the model changes. If the agent needs an old file again, the note tells it to read it again, and it does.

![Tokens sent with each request over 23 steps: the 2.6.1 line drops when the first batch of stale output is cleared, and ends at 27.4k against 36.5k.](/images/blog/adcode-2-6-1-request-size.svg)

## The result

![The same 23-step task: input tokens sent fell from 603k to 483k, and billed input from 209k to 117k.](/images/blog/adcode-2-6-1-billed-tokens.svg)

| Measure, whole task | 2.6.0 | 2.6.1 | Change |
|---|---|---|---|
| Requests | 23 | 23 | Same work |
| Input tokens sent | 603,458 | 482,879 | −20.0% |
| Read from cache | 474,387 | 422,706 | |
| Written to cache | 129,071 | 60,173 | −53.4% |
| Billed input (cache reads 0.1×, writes 1.25×) | 208,777 | 117,487 | −43.7% |
| Last request | 36,499 | 27,396 | −24.9% |

## What it means for you

- **Free AI goes further.** Smaller requests stay inside a free model's limits for longer, so fewer turns hit "request too large".
- **Paid models cost less per task.** On a model with caching, the same task is billed for about 44% fewer input tokens; without caching, 20% fewer.
- **Long tasks finish.** One message can run 100 steps, and the conversation is compacted later because it grows more slowly.
- **Nothing to switch on.** It is how every chat works from ADCode 2.6.1.

## How we measured

We replayed one task - add a dark mode toggle to a header, make the tests pass, check the page on a phone-sized screen, then make it remember the choice - through ADCode's own request builder, once as 2.6.0 builds requests and once as 2.6.1 does. Files read in the task are real files from the ADCode repository; command output is real text of the same length. Tokens are counted with the o200k tokenizer, so other models' counts differ by a few percent, but the change between versions holds. The host context changes four times during the task (the cursor moves twice, a dev server starts, the preview opens), which is what a watched session does. Billing uses Anthropic's cache prices.
`,
};

const ads: Report = {
  slug: "zeekend-sponsored-cards-phone-and-notifications",
  title: "Sponsored cards: Zeekend only, back to back, and now on your phone",
  description:
    "From ADCode 2.6.1 every sponsored card comes from Zeekend: under AI replies, in sponsored notifications that follow each other at your chosen frequency, and under replies on Phone link. Imprezia is no longer used.",
  published: "2026-11-13",
  surface: "docs",
  section: "Earning and advertising",
  order: 30,
  related: ["how-you-get-paid-step-by-step", "how-targeting-works-without-reading-your-code", "adcode-vs-claude-code-codex-opencode-t3-code"],
  body: `
Four changes to sponsored cards arrive together in ADCode 2.6.1. Every card now comes from one partner, Zeekend. An ad box above the message box keeps a fresh Zeekend card in view. Sponsored notifications follow each other at exactly the frequency you chose, with no dead time in between. And every Zeekend card you are shown pays you $0.002.

## The ad box above the message box

A single box sits just above where you type: the product's picture, its name with Zeekend's own Sponsored label, one line about it, and a button. It fills as soon as the chat is open and changes to a fresh card every 30 seconds while the window is on screen, and right after each reply with a card about what you just asked. Clicking it opens the product in your browser. It pauses while ADCode is minimised or hidden, because a card nobody can see earns nothing.

## You earn $0.002 for every Zeekend card

Each Zeekend card you are shown - in the ad box or in a notification - credits $0.002 to your ADCode earnings once Zeekend has counted it as seen (half of it on screen for a second). Each card pays once, to the one person who saw it, up to 300 cards ($0.60) a day. You can watch it arrive in Earnings.

| Cards seen | You earn |
|---|---|
| 1 | $0.002 |
| 100 | $0.20 |
| 300, the most in a day | $0.60 |


## One partner: Zeekend

ADCode used to ask Zeekend first and Imprezia when Zeekend had nothing. Imprezia is no longer used anywhere - not under replies, not in notifications - and nothing is sent to it. Zeekend picks a product that fits the conversation, draws the card and counts its views and clicks, all inside a page from adcode.bluethenics.com that is walled off from the editor.

## Notifications, back to back at your frequency

When a sponsored message is due and no ADCode advertiser has one for you, Zeekend fills the slot. The app now wakes the moment the next slot opens, instead of checking once a minute, and if Zeekend has nothing it asks again about twenty seconds later rather than skipping the slot.

![Sponsored notifications, back to back at your frequency: Light every 30 minutes, Standard every 10, Max every 5; an empty slot is asked again 20 seconds later.](/images/blog/zeekend-notification-cadence.svg)

| Frequency | One card every | At most a day |
|---|---|---|
| Light | 30 minutes | 8 |
| Standard | 10 minutes | 24 |
| Max | 5 minutes | 60 |
| Off | Never | 0 |

Change it in **Settings > Ads > Frequency**. Every other rule still applies: nothing while you debug, nothing while ADCode is in the background, nothing in your first minutes after installing, and an empty slot never counts toward the daily limit.

## On your phone

With Phone link on and **Sponsored cards under AI replies** switched on in the desktop app, a Zeekend card can appear above the message box on your phone after the computer finishes a reply - the same card, chosen the same way, as on the computer. Switch it off on the computer and every connected phone stops showing cards at once.

## What is sent

| Where | What Zeekend receives | Never sent |
|---|---|---|
| Under an AI reply, on the computer or phone | Your message and the reply (the first 2,000 and 4,000 characters), which question of the conversation it is, and a one-way code for the conversation | Files, paths, project names, your account |
| Sponsored notification | The names of the languages and frameworks you have open, which notification of this session it is, and a code that changes every launch | Code, prompts, file names, your account |

Like any website, Zeekend also sees your IP address and browser details when its card loads. The [privacy policy](/privacy#sponsored-cards) lists everything.

## Turning it off

Open **Settings > Ads**. Switch off **Sponsored cards under AI replies** to stop cards under replies on the computer and the phone, and **Sponsored notifications from ADCode's ad partner** to stop the notifications. Set **Frequency** to Off, or switch off sponsored messages altogether, and nothing is shown or sent. ADCode stays free either way.
`,
};

const benchmark: Report = {
  slug: "coding-agent-token-benchmark",
  title: "Token and speed benchmark: ADCode vs Claude Code, Codex, OpenCode, DeepSeek Harness and T3 Code",
  description:
    "We recorded every request five coding agents sent on the same task. ADCode 2.6.1 sends the fewest tokens - 37,175 for the whole task against 44,401 for the next best - and adds the least time between steps.",
  published: "2026-11-14",
  surface: "docs",
  section: "Comparisons",
  order: 0,
  related: ["adcode-vs-claude-code-codex-opencode-t3-code", "adcode-2-6-1-fewer-tokens"],
  body: `
Every coding agent pays for the same thing over and over: its instructions, its tool definitions and the conversation so far, sent again with each step. We measured exactly what five agents send on one task, counted every token, and timed how much each adds between steps. ADCode came fourth on tokens the first time we ran it. We fixed that, ran everything again, and this is the result.

## The result

- **Fewest tokens for the whole task:** ADCode 2.6.1 sent 37,175 tokens. The next best, DeepSeek Harness, sent 44,401: ADCode sent 16% fewer. Claude Code sent 91,586, nearly two and a half times as many.
- **Lightest first request:** 5,237 tokens before reading a single file, just under DeepSeek Harness at 5,273 and well under OpenCode, Codex and Claude Code.
- **Fastest between steps:** 26 milliseconds of its own time per step, against 228 to 4,101 for the others. The whole task took about one second.

![Tokens sent for the whole task: ADCode 37,175, DeepSeek Harness 44,401, Codex 48,066, OpenCode 50,589, Claude Code 91,586.](/images/blog/benchmark-task-tokens.svg)

## Tokens

| Tool | Requests | Tools offered | First request | System prompt | Tool definitions | Whole task |
|---|---|---|---|---|---|---|
| ADCode 2.6.1 | 4 | 21 | **5,237** | 1,570 | 3,645 | **37,175** |
| DeepSeek Harness | 5 | 24 | 5,273 | 562 | 4,272 | 44,401 |
| Codex | 4 | 9 | 8,192 | 4,167 | 3,806 | 48,066 |
| OpenCode | 5 | 10 | 6,808 | 2,121 | 4,664 | 50,589 |
| Claude Code | 4 | 23 | 17,581 | 1,398 | 13,714 | 91,586 |
| T3 Code | - | - | as the agent it runs | | | Codex's or Claude Code's |

![What the first request carries, split into system prompt, tool definitions and the rest: ADCode 5,237, DeepSeek Harness 5,273, OpenCode 6,808, Codex 8,192, Claude Code 17,581.](/images/blog/benchmark-first-request.svg)

The first request is the floor every later step builds on, so a light start stays light. Each step after it adds the file just read; ADCode's file reads were already the most compact of the five, so its line climbs the least.

![Tokens in each request across the four steps; ADCode stays lowest at every step and ends at 13,209.](/images/blog/benchmark-per-step.svg)

| Tool | Step 1 | Step 2 | Step 3 | Step 4 |
|---|---|---|---|---|
| ADCode 2.6.1 | 5,237 | 8,038 | 10,691 | 13,209 |
| DeepSeek Harness | 5,273 | 9,100 | 13,656 | 16,224 |
| Codex | 8,192 | 10,627 | 13,311 | 15,936 |
| OpenCode | 6,808 | 10,578 | 15,078 | 17,589 |
| Claude Code | 17,581 | 21,108 | 25,248 | 27,649 |

On a model that bills by the token, the whole-task figure is the bill. Run the same work a hundred times a day and ADCode sends about 720,000 fewer tokens than DeepSeek Harness, and 5.4 million fewer than Claude Code.

## Speed

The model answered every agent instantly, so these are the agents' own costs: starting up, running the tool, and preparing the next request. Each agent ran three times; the table shows the median and the range.

| Tool | Time added per step | Whole task | Startup to first request |
|---|---|---|---|
| ADCode 2.6.1 | **26 ms** (18-34) | **0.8 s** (0.7-1.1) | 0.5 s (0.4-0.6) |
| DeepSeek Harness | 228 ms (95-357) | 35.1 s (10.6-38.5) | 34.0 s (10.0-36.7) |
| Claude Code | 328 ms (144-332) | 4.9 s (2.7-5.1) | 3.4 s (2.0-3.5) |
| OpenCode | 2,364 ms (417-2,941) | 26.3 s (5.6-27.4) | 9.0 s (2.1-9.2) |
| Codex | 4,101 ms (1,335-4,944) | 18.5 s (7.2-19.9) | 3.7 s (2.3-5.0) |

![Time each agent adds between steps, median of three runs: ADCode 26 ms, DeepSeek Harness 228 ms, Claude Code 328 ms, OpenCode 2,364 ms, Codex 4,101 ms.](/images/blog/benchmark-step-overhead.svg)

Even each agent's fastest run is slower than ADCode's slowest: 95 ms per step at best for the others, 34 ms at worst for ADCode. A fair caveat on startup: ADCode's assistant lives inside an editor that is already open, while the command-line agents start a fresh process for each task, so part of their startup figure is that process.

![The whole task, start to finish, median of three runs: ADCode 0.8 s, Claude Code 4.9 s, Codex 18.5 s, OpenCode 26.3 s, DeepSeek Harness 35.1 s.](/images/blog/benchmark-wall-time.svg)

## How ADCode got to first

The first run put ADCode fourth on tokens: 53,503 for the task and 9,319 for the first request. Its file reads were already the leanest; the problem was what it sent before them, again on every step - forty tool definitions, and instructions that said some things twice. Three changes, all in ADCode 2.6.1:

| Change | First request |
|---|---|
| Rarely used tools - forks, team rooms, page audits, browser control, connectors, memory, helpers - are listed by name in one small load_tools tool and sent in full only once the assistant loads them | 3,824 fewer tool-definition tokens |
| The workspace context stopped repeating the system prompt's tool advice | about 150 fewer |
| The design-skill and parallel-work guidance say each thing once | about 120 fewer |

Nothing was taken away: every tool is still there, loaded the moment a task needs it, and it stays loaded for the rest of the conversation. A conversation that loads nothing sends exactly the same tools at every step, so the provider's cache keeps working. Together with the changes in [ADCode 2.6.1's token work](/docs/adcode-2-6-1-fewer-tokens), a long task gets lighter still: stale file reads are cleared and the cache holds across every step.

For a model on your own computer, ADCode's lean mode goes further: 2,503 tokens for the first request and 19,403 for this task.

## How we measured

- **A recording model server.** Instead of a real model, every agent talked to a local server that speaks the Anthropic Messages, OpenAI Chat Completions and OpenAI Responses formats. It saved every request and answered every agent with the same script: read src/app.ts, then src/markdown.ts, then src/styles.css, one per step, then a fixed final answer. It used each agent's own file tool, or its shell where it has none (Codex reads with cat).
- **The same project.** Three real source files from the ADCode repository - 33 KB in all - and no instructions file.
- **Out of the box.** Each agent ran with an empty, private configuration (no memories, no user instructions, no plugins) in its non-interactive mode: claude -p, codex exec, opencode run, dsh headless. ADCode ran its real assistant code - the agent loop, the OpenAI-compatible provider, the file tool, the chat's tool list and workspace context.
- **Counting.** All of each request - instructions, tool definitions, messages and tool results - with the o200k tokenizer, the same way for every format. Side requests, such as a title for the session, count too.
- **Versions.** Claude Code 2.1.325, Codex 0.169.0, OpenCode 1.19.5, DeepSeek Harness 0.2.2-rc.1. T3 Code drives Codex or Claude Code through their official interfaces, so its requests are theirs.

## Limits

- Each model counts tokens with its own tokenizer, a few percent apart from o200k. ADCode's lead on the first request, 36 tokens, is inside that margin; its 16% lead on the whole task is not.
- One task of four steps. Longer tasks favour ADCode further, because it clears stale tool output and keeps the provider's cache through every step.
- Speed excludes the model. With a real model, its thinking time adds to every agent equally.
`,
};

export const REPORTS_2026_11: readonly Report[] = [benchmark, comparison, efficiency, ads];
