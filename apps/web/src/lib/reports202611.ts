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

const realModel: Report = {
  slug: "real-model-coding-agent-benchmark",
  title: "Real-model benchmark: ADCode, Claude Code and OpenCode on real coding tasks",
  description:
    "ADCode, Claude Code and OpenCode on eight real coding tasks with two real models: tasks solved, model time against harness time, tokens billed and cost per solved task with the provider's cache counted.",
  published: "2026-11-18",
  surface: "docs",
  section: "Comparisons",
  order: 0,
  related: ["coding-agent-token-benchmark", "adcode-vs-claude-code-codex-opencode-t3-code", "adcode-2-6-1-fewer-tokens"],
  body: `
On 14 November we published [a token and speed benchmark](/docs/coding-agent-token-benchmark) in which every coding agent talked to a scripted stand-in for a model. A reader replied, fairly, that this isolates the harness and nothing else: real-model reasoning time, task success and cache-adjusted billing need their own measurements before a token lead can be read as a smaller coding bill. This is that measurement.

Three agents worked on the same four real coding tasks, 5 times each, with the same real model behind them. A task only counted as solved if its own test file passed and was left exactly as it was.

## The result

**Updated 19 November:** the run below is now eight tasks on two models - see [Broadened](#broadened-eight-tasks-and-a-second-model-19-november). The order did not change.

- **Solved:** ADCode 20 of 20, OpenCode 20 of 20, Claude Code 20 of 20. With every agent solving every task, what separates them is time and money.
- **Fastest to a passing test:** ADCode's median task took 20 seconds, against 40 for OpenCode and 36 for Claude Code. The model's own share was 19 s for ADCode, 24 s for OpenCode, 27 s for Claude Code; the harness itself took 0.5 seconds of ADCode's median task, against 11.4 for OpenCode and 5.5 for Claude Code.
- **Fewest tokens:** a median ADCode task sent the model 25,314 input tokens, against 35,498 for OpenCode and 89,062 for Claude Code.
- **Cheapest per solved task:** ADCode, at 23,952 input-token equivalents with the provider's cache counted - 3% less than OpenCode and 62% less than Claude Code. The lead over OpenCode is narrow - smaller than the spread between repeated rounds of the same agent - because the provider served 57% of OpenCode's input from cache against 41% of ADCode's. Count the same work with no cache and the gap is 24%.
- **What we changed in ADCode on the way:** its first runs cost 30,329 per solved task. Watching them showed two habits - listing folders before reading the files a task named, and, after running the whole test suite, fixing failures nobody had asked about. Its instructions now say to read what the task names first, run only the tests that cover the change, and name other failures instead of fixing them. And five tools it never used in any run - external MCP capabilities, skills, file outlines and delete - now wait until they are needed instead of going with every step. It now costs 23,952, 21% less, and no longer edits files outside the task. The other agents ran as shipped.

![What a solved task costs, cache-adjusted.](/images/blog/real-benchmark-cost.svg)

| Agent | Solved | Median time | Model time | Harness time | Requests | Input tokens | Output tokens | Served from cache | Cost per solved task | Same work, no cache |
|---|---|---|---|---|---|---|---|---|---|---|
| ADCode | 20/20 | 20 s | 19 s | 0.5 s | 4 | 25,314 | 469 | 41% | 23,952 | 36,048 |
| OpenCode | 20/20 | 40 s | 24 s | 11.4 s | 5.5 | 35,498 | 470 | 57% | 24,744 | 47,404 |
| Claude Code | 20/20 | 36 s | 27 s | 5.5 s | 5 | 89,062 | 942 | 51% | 63,791 | 113,062 |

Times, requests and tokens are medians per task. Costs are totals over every run, failed ones included, divided by the tasks solved.

## Where the time goes

![Median task time split into model time and harness time.](/images/blog/real-benchmark-time.svg)

The 14 November report said a real model's thinking time would add to every agent equally. Measured, it is the smaller difference: 19 s, 24 s, 27 s of model time for a median task, against 0.5 s, 11.4 s, 5.5 s of harness time - starting up, running tools and the agent's own work between replies. ADCode's model time is the lowest too, because it makes fewer and smaller requests for the model to read.

## Tokens the model was billed for

![Input tokens per task, as the model counted them.](/images/blog/real-benchmark-tokens.svg)

These are the model's own counts, not an estimate. Before reading a single file, the first request weighs 5,862 tokens for ADCode, 7,114 tokens for OpenCode, 16,362 tokens for Claude Code - instructions and tool definitions that go again with every step.

## Cache-adjusted billing

Most providers bill input their cache already holds at about a tenth of the normal price, and output at about four times input. We used those ratios, so costs here are in input-token equivalents and hold whichever model you pick: an uncached input token counts 1, a cached one 0.1, an output token 4. The cached figures are the ones the model's provider reported for each request.

ADCode's prompt is built to be cached - its instructions, tools and earlier messages never change from one step to the next, which we checked request by request - yet the provider served less of it from cache (41%) than of the others' (57% for OpenCode, 51% for Claude Code). We tested two explanations and neither held: waiting longer between requests did not raise ADCode's hit rate, and putting the conversation's own context ahead of the shared instructions did not either. When ADCode missed, the provider had matched exactly the first 1,024 tokens - its shared instructions - from another conversation, which points at how the provider picks a cache for each request. Sending a cache key with each conversation, as OpenAI-style APIs allow, is the next fix; it has to go through ADCode's relay, which today refuses unknown fields.

## Broadened: eight tasks and a second model (19 November)

Readers asked whether four short tasks and one model were enough to say anything. So we doubled the tasks and added a second model, and ran every agent twice on each task with each model: 96 runs in all, on ADCode 2.6.2, Claude Code 2.1.284 and OpenCode 1.19.5.

The four new tasks are harder: fix a CSV parser that breaks on quoted commas and doubled quotes, fix a retry helper with three bugs in its async control flow, implement a least-recently-used cache from a written spec, and rename a function across three files. Each was checked before the run: it fails as shipped and passes with a reference fix.

The second model is Tagflow Code 27B, a 27-billion-parameter coding model served by ADCode's included AI - slower, and a different family from Tagflow Code Flash 1.

### Tagflow Code Flash 1, eight tasks

| Agent | Solved | Median time | Model time | Harness time | Input tokens | Served from cache | Cost per solved task | Same work, no cache |
|---|---|---|---|---|---|---|---|---|
| ADCode | 16/16 | 28 s | 18 s | 1.2 s | 25,002 | 34% | 15,537 | 21,700 |
| OpenCode | 16/16 | 48 s | 25 s | 21.0 s | 31,614 | 51% | 17,651 | 31,087 |
| Claude Code | 16/16 | 33 s | 20 s | 7.1 s | 67,680 | 37% | 36,534 | 53,367 |

### Tagflow Code 27B, eight tasks

| Agent | Solved | Median time | Model time | Input tokens | Cost per solved task |
|---|---|---|---|---|---|
| ADCode | 16/16 | 64 s | 63 s | 40,996 | 48,700 |
| OpenCode | 16/16 | 85 s | 95 s | 61,846 | 67,556 |
| Claude Code | 15/16 | 92 s | 90 s | 99,502 | 126,603 |

What the broader run says:

- **The result holds on both models.** ADCode solved every task with both, was the fastest to a passing test with both, and cost the least per solved task with both: 12% less than OpenCode (inside the 15% spread we see between repeated rounds, so call that a tie) and 57% less than Claude Code on Flash 1, and 28% and 62% less on 27B.
- **The harder tasks did not change the order.** Every agent solved every new task on Flash 1. On 27B, Claude Code ran out of time once, on the rename across three files; the other two solved all sixteen.
- **A slower model widens the gap.** With 27B every request takes longer, so an agent that sends fewer and smaller requests saves more wall-clock time: ADCode's median task was 21 seconds faster than OpenCode's and 28 seconds faster than Claude Code's, against 20 and 5 seconds on Flash 1.

Two caveats specific to 27B. Its server reports no cache hits at all, so every cost in that table is the uncached price and the cache column is left out. And OpenCode sends some requests side by side, so its summed model time can exceed its wall-clock time; its harness time is not measurable on this model and is left out rather than shown as zero.

Not in this run: models that draw credits. We started Qwen3.8 27B and DeepSeek V4.1 Flash too, but the test account ran out of its daily credits part-way, and runs that fail on a credit limit say nothing about the agents. Those runs are kept with the data and left out of every number here. Claude and GPT models are next.

## How we measured

- **One real model for everyone.** A local proxy spoke each agent's own API format - Anthropic Messages for Claude Code, OpenAI Chat Completions for OpenCode and ADCode - and passed every request, translated, to the same model: Tagflow Code Flash 1, ADCode's default included model. It recorded what each agent sent, the model's time for each request, and the tokens the model reported.
- **Four real tasks.** A small JavaScript project tested with Node's built-in runner: fix a discount bug, implement a URL slug function, implement a duration parser, and fix two bugs across two files in a byte formatter. Each starts with failing tests.
- **Solved means solved.** After each run the task's test file had to pass and be byte-for-byte unchanged; an agent that edits the test to pass it fails. The project template was checked after every run too, so no agent could reach outside its own copy.
- **Same conditions.** Each agent ran 5 times per task in its non-interactive mode, from an empty private configuration (no memories, instructions or plugins), in a fresh copy of the project. Runs were interleaved - one task for every agent before the next - so a slow minute on the model's side hit all of them alike. ADCode was run again after each change described above; its row is its last 20 runs, taken the same day as the others', and the earlier rounds are kept with the data.
- **Versions:** ADCode's agent as of this report, OpenCode 1.19.5, Claude Code 2.1.284.

## Limits

- **Two models so far, both from the same provider.** The broadened run added Tagflow Code 27B to Tagflow Code Flash 1. A frontier model such as Claude or GPT may need fewer steps in every agent, and Claude Code is tuned for Claude models in particular, so the gap may differ there.
- **Small tasks.** Eight tasks of one to two minutes each, a single small project; 5 runs per agent per task on the first four with Flash 1, 2 runs per agent per task in the broadened run. Differences under about 15% in cost are within what we saw between repeated rounds of the same agent.
- **Not every agent.** Codex and DeepSeek Harness from the first benchmark were not installed on the test machine this time; they will be in the next run.
- **The cache is the provider's.** Reported cache hits vary from request to request for reasons on the provider's side, so the cache shares carry more noise than the token counts.

The proxy, tasks, runner and analysis are in the ADCode repository under docs/model-benchmark-2026-11-17.
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
  order: 1,
  related: ["real-model-coding-agent-benchmark", "adcode-vs-claude-code-codex-opencode-t3-code", "adcode-2-6-1-fewer-tokens"],
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
- Speed excludes the model. [The real-model benchmark](/docs/real-model-coding-agent-benchmark) measures the model's time, task success and cache-adjusted cost separately.
`,
};

const whatsNew262: Report = {
  slug: "adcode-2-6-2-teams-and-agents",
  title: "What's new in ADCode 2.6.2: build with your team and a team of agents",
  description:
    "Team chats in the real chat, Agent flow for up to 50 agents, mods made by asking, and the reliability work behind it: a slow free model hands over, a busy chat waits its turn, and saved chats stay saved.",
  published: "2026-11-18",
  surface: "docs",
  section: "How ADCode works",
  order: 29,
  related: ["adcode-2-6-1-fewer-tokens", "adcode-vs-claude-code-codex-opencode-t3-code", "workbench-agent-flow", "workbench-solo-team", "workbench-mods"],
  body: `
ADCode 2.6.2 is about two kinds of team: the people you build with, and the AI agents you hand work to. It also fixes the things that most often stopped a first conversation from finishing. Every change below is in the app when you update - there is nothing to switch on unless the step says so.

## Build with your team, in the chat you already use

Above Conversations in the Vibe sidebar there is now a switch: **Solo** and **Team**. Solo is your own chats, as before. Team shows only the shared projects you belong to.

1. Press **Team** and sign in if asked - team projects belong to your account.
2. Choose **Share this project** (the open folder must be on GitHub) or **Join with an invite** and paste the invite a teammate sent you.
3. Press **+** beside a project to start a chat and give it a name.
4. Write in the box and press Enter. Every message carries its writer's name; teammates sit on the left. Their messages reach you within a few seconds.
5. With **AI replies** on - or by starting a message with **@ai** - the AI takes the message as a task and builds it right there: it reads the project, edits files and runs commands, and everyone sees the answer and who asked.
6. Press **Invite** to copy a link for more people, and **Solo** to go back. A solo chat that was working kept going while you were away.

What is different from before: a team chat used to be a separate panel with its own box. It is now the same chat you use alone - composer, model picker, tools and build cards - with the people, Invite and AI replies in a strip above it. [The full guide](/docs/workbench-solo-team) has every option.

## A team of agents: Agent flow

One model doing everything plans, types and checks its own work in a single pass, and a strong model charges its price for every line it types. **Agent flow** splits the work the way a team would.

1. Open **Agents** on the left rail and choose the **Flow** tab (or run Agents: Agent Flow from the command palette).
2. Start from the ready-made flow - Thinker, Coder, Reviewer, Tester and Researcher - or drag new agents onto the canvas, up to 50.
3. Connect agents by dragging from one agent's right-hand dot to another, then click the link to say what it means: hands work to, sends for review to, or can ask.
4. Click an agent to set its name, role, the work it takes over, the **model it runs on** and its instructions. Tick Read-only for a reviewer that must never edit.
5. Type a sample message under **Try it** to see which agents would take it, in order.
6. Switch the flow **On** for every chat or the chats you pick. Share it with **Copy link**; it arrives switched off for whoever opens it.

The payoff is concrete: a fast or cheap model can type while a stronger one plans, a reviewer checks the work before you read it, and every agent's tokens are counted against its own model so you can see where the cost goes. [The Agent flow guide](/docs/workbench-agent-flow) walks through each step with the screens.

Two more agent changes ship with it:

- **A redesigned Agents board.** Each box leads with a status chip and a timer, shows what the agent is doing with a moving bar while it works, and keeps edit and delete out of the way until you need them.
- **Task agents** (new in 2.6.1) still work inside a flow: a saved agent can run helper work on its own model, and "use DeepSeek for all coding work" in the chat sets one up after you confirm.

## Change ADCode by asking: mods

Ask the assistant to change ADCode itself - "a warm paper theme with a terracotta accent", "a /standup command that summarises yesterday's commits", "a clock in the status bar". It writes a mod, lists every change before anything happens, and applies it when you press **Apply mod**. Ask again to adjust it, switch it off or remove it. Mods follow the same rules as plugins: they cannot touch your models, keys, ads or permissions. [How mods work](/docs/workbench-mods).

## Conversations that finish

These changes come from in-app reports. The most common one was a chat that stopped with an error before the model had written a word.

- **A slow free model hands over.** If an included model has not started answering after a minute, or its stream dies before the first word, the task is asked again and then switched to another included model - and the chat says so. Paid models you chose are never switched.
- **No more "4 chats are already working".** Up to four chats work at once. A message sent while all four are busy waits its turn and starts by itself the moment one finishes; Stop takes it out of the line.
- **Saved chats stay saved.** Conversations are written to a new file and then moved into place, so a crash mid-save can no longer leave an empty file. Chats saved under an older spelling of the project's folder are found and moved on their next save, and **Clear all** now asks before it deletes a project's history.
- **The model picker opens at once.** With Claude Code, Codex or OpenCode installed, the picker used to wait for each tool to report its models - up to a minute and a half after a restart. It now shows the last known list straight away and fills in the live one a few seconds later.
- **Look around first.** The sign-in screen has a "Look around first - sign in later" option. Included AI still needs a verified account; everything else works without one.

## Smaller things

- **Sort and pin conversations** by recent activity, newest, oldest, name or length; pinned chats stay on top. [Guide](/docs/ai-sort-conversations).
- **Searchable dropdowns** in Agent flow, Tools, the agent dialogs and the conversation sort: type to filter, grouped by connection, full keyboard control.
- **Coming back is easier.** The Continue card says why a conversation is worth reopening - it is waiting on your answer, or your last message never got one.
- **Cancelling a plan is easy to find.** The account menu's plan button now reads **Manage or cancel plan**.

## ADCode or the Claude desktop app?

People ask this, so here is a straight answer. If you pay for Claude and want Anthropic's own agent with the strongest Claude models, the Claude desktop app is excellent at that one job, and ADCode does not try to beat it there. ADCode is the better pick when you want **a full editor around the agent**, **models from any provider** (including free included models and local ones), **a team of agents on different models**, or **people and AI in one shared chat**.

You also do not have to choose: under Connect a model, the **Coding CLIs** tab runs Claude Code inside ADCode on the Claude subscription you already pay for, with ADCode's preview, browser and page checks available to it. [The November comparison report](/docs/adcode-vs-claude-code-codex-opencode-t3-code) puts ADCode, Claude Code, Codex, OpenCode and T3 Code side by side, including where another tool is the better choice.

## Updating

ADCode updates itself: when 2.6.2 is ready on your computer, a notice asks you to restart. To update by hand, download the installer from [Versions](/versions). Your chats, settings and keys carry over.
`,
};

export const REPORTS_2026_11: readonly Report[] = [whatsNew262, realModel, benchmark, comparison, efficiency, ads];
