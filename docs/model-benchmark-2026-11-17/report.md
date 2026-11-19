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
