import { describe, expect, it } from "vitest";
import { createAgent } from "../src/agent.ts";
import { SUMMARY_OPEN } from "../src/compaction.ts";
import type { AgentEvent, Message, Provider, ProviderEvent, ProviderRequest } from "../src/types.ts";

type Summariser = (request: ProviderRequest) => ProviderEvent[] | Error;
type Answer = (request: ProviderRequest) => ProviderEvent[] | Error;

/**
 * A provider that tells the summariser's request (no tools, a summarising system prompt)
 * from an ordinary one, and records both.
 */
function fakeProvider(answer: Answer, summarise: Summariser = () => [{ kind: "text", text: "SUMMARY-ONE" }, { kind: "stop", reason: "end-turn" }]) {
  const requests: ProviderRequest[] = [];
  const summaries: ProviderRequest[] = [];
  const provider: Provider = {
    id: "anthropic",
    displayName: "Fake",
    models: ["m"],
    async *stream(request, signal) {
      const isSummary = request.tools.length === 0 && /summari/i.test(request.system);
      // A copy: the agent keeps appending to the array it sent.
      (isSummary ? summaries : requests).push({ ...request, messages: [...request.messages] });
      const script = isSummary ? summarise(request) : answer(request);
      if (script instanceof Error) throw script;
      for (const event of script) {
        if (signal.aborted) return;
        yield event;
      }
    },
  };
  return { provider, requests, summaries };
}

const reply = (text: string): ProviderEvent[] => [{ kind: "text", text }, { kind: "stop", reason: "end-turn" }];
const user = (text: string): Message => ({ role: "user", content: [{ type: "text", text }] });
const assistant = (text: string): Message => ({ role: "assistant", content: [{ type: "text", text }] });

/** A conversation big enough to be over 80% of a 10k window. */
function longHistory(turns = 12): Message[] {
  const messages: Message[] = [];
  for (let i = 0; i < turns; i++) messages.push(user(`question ${i} ${"q".repeat(900)}`), assistant(`answer ${i} ${"a".repeat(900)}`));
  return messages;
}

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const kinds = (events: readonly AgentEvent[]) => events.map((event) => event.kind);
const flat = (request: ProviderRequest | undefined) => JSON.stringify(request?.messages ?? []);

const base = { model: "m", tools: [], runner: { run: async () => ({ content: "", isError: false }) }, system: "sys", maxTokens: 1000 };

describe("remembering a conversation", () => {
  it("sends the history it was given before the new message", async () => {
    const { provider, requests } = fakeProvider(() => reply("hello again"));
    const agent = createAgent({ ...base, provider, initialMessages: [user("my name is Ada"), assistant("Hi Ada")] });
    await collect(agent.send("what is my name?"));
    expect(requests[0]?.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(flat(requests[0])).toContain("my name is Ada");
  });
});

describe("automatic compaction", () => {
  const compaction = { contextWindow: () => 10_000, thresholdPercent: () => 80 };

  it("summarises the older part before a request that would pass the threshold", async () => {
    const { provider, requests, summaries } = fakeProvider(() => reply("done"));
    const agent = createAgent({ ...base, provider, compaction, initialMessages: longHistory() });
    const events = await collect(agent.send("and now?"));
    expect(kinds(events).slice(0, 2)).toEqual(["compacting", "compacted"]);
    expect(summaries).toHaveLength(1);
    expect(flat(requests[0])).toContain("SUMMARY-ONE");
    expect(flat(requests[0])).not.toContain("question 0 ");
    expect(flat(requests[0])).toContain("and now?");
    const compacted = events.find((event) => event.kind === "compacted");
    expect(compacted).toMatchObject({ summary: "SUMMARY-ONE" });
    if (compacted?.kind === "compacted") expect(compacted.after).toBeLessThan(compacted.before);
    expect(agent.history()[0]?.content[0]).toMatchObject({ type: "text" });
    expect(JSON.stringify(agent.history()[0])).toContain(SUMMARY_OPEN);
  });

  it("does nothing while the conversation is small", async () => {
    const { provider, summaries } = fakeProvider(() => reply("done"));
    const agent = createAgent({ ...base, provider, compaction });
    const events = await collect(agent.send("hi"));
    expect(summaries).toHaveLength(0);
    expect(kinds(events)).not.toContain("compacting");
  });

  it("does nothing when automatic compaction is off", async () => {
    const { provider, summaries } = fakeProvider(() => reply("done"));
    const agent = createAgent({ ...base, provider, compaction: { contextWindow: () => 10_000, thresholdPercent: () => null }, initialMessages: longHistory() });
    await collect(agent.send("and now?"));
    expect(summaries).toHaveLength(0);
  });

  it("keeps the whole history and still answers when the summariser fails", async () => {
    const { provider, requests } = fakeProvider(() => reply("answered anyway"), () => new Error("HTTP 429 rate limited"));
    const agent = createAgent({ ...base, provider, compaction, initialMessages: longHistory() });
    const events = await collect(agent.send("and now?"));
    expect(kinds(events)).not.toContain("compacted");
    expect(kinds(events)).toContain("status");
    expect(kinds(events)).toContain("turn-end");
    expect(JSON.stringify(agent.history())).toContain("question 0 ");
    expect(requests).toHaveLength(1);
  });

  it("treats an empty summary as a failure", async () => {
    const { provider } = fakeProvider(() => reply("ok"), () => [{ kind: "text", text: "   " }, { kind: "stop", reason: "end-turn" }]);
    const agent = createAgent({ ...base, provider, compaction, initialMessages: longHistory() });
    const events = await collect(agent.send("and now?"));
    expect(kinds(events)).not.toContain("compacted");
    expect(JSON.stringify(agent.history())).toContain("question 0 ");
  });

  it("carries the first summary into the second", async () => {
    let n = 0;
    const { provider, summaries } = fakeProvider(() => reply("x".repeat(3000)), () => [{ kind: "text", text: `SUMMARY-${String(++n)}` }, { kind: "stop", reason: "end-turn" }]);
    const agent = createAgent({ ...base, provider, compaction, initialMessages: longHistory() });
    await collect(agent.send("first"));
    for (let i = 0; i < 6 && summaries.length < 2; i++) await collect(agent.send(`more ${String(i)} ${"m".repeat(2000)}`));
    expect(summaries.length).toBeGreaterThanOrEqual(2);
    expect(flat(summaries[1])).toContain("SUMMARY-1");
  });

  it("reports how full the context is after each request", async () => {
    const { provider } = fakeProvider(() => reply("done"));
    const agent = createAgent({ ...base, provider, compaction });
    const events = await collect(agent.send("hi"));
    const context = events.find((event) => event.kind === "context");
    expect(context).toMatchObject({ contextWindow: 10_000 });
    if (context?.kind === "context") expect(context.tokens).toBeGreaterThan(0);
    expect(agent.contextUsage()).toMatchObject({ contextWindow: 10_000 });
  });

  it("stops cleanly when stopped while summarising", async () => {
    const controller = new AbortController();
    const { provider } = fakeProvider(() => reply("never"), () => {
      controller.abort();
      return [{ kind: "text", text: "late" }, { kind: "stop", reason: "end-turn" }];
    });
    const agent = createAgent({ ...base, provider, compaction, initialMessages: longHistory() });
    const events = await collect(agent.send("and now?", { signal: controller.signal }));
    expect(kinds(events)).toContain("cancelled");
    expect(kinds(events)).not.toContain("compacted");
    expect(JSON.stringify(agent.history())).toContain("question 0 ");
  });
});

describe("compacting when the provider says the request is too large", () => {
  it("compacts and retries before trimming", async () => {
    let calls = 0;
    const { provider, requests, summaries } = fakeProvider(() => (++calls === 1 ? new Error("prompt is too long: 250000 tokens > 200000 maximum") : reply("fits now")));
    const agent = createAgent({ ...base, provider, compaction: { contextWindow: () => 1_000_000, thresholdPercent: () => 80 }, initialMessages: longHistory() });
    const events = await collect(agent.send("and now?"));
    expect(summaries).toHaveLength(1);
    expect(requests).toHaveLength(2);
    expect(flat(requests[1])).toContain("SUMMARY-ONE");
    expect(kinds(events)).toContain("turn-end");
    // Compaction was enough: the retry was not the trimmed, lean one.
    expect(events.some((event) => event.kind === "status" && /leaner/.test(event.text))).toBe(false);
  });
});

describe("compacting on request", () => {
  it("says there is nothing to compact in a short conversation", async () => {
    const { provider } = fakeProvider(() => reply("ok"));
    const agent = createAgent({ ...base, provider, compaction: { contextWindow: () => 10_000, thresholdPercent: () => 80 } });
    expect(await agent.compact()).toMatchObject({ ok: false });
  });

  it("compacts a long conversation with the focus it was given", async () => {
    const { provider, summaries } = fakeProvider(() => reply("ok"));
    const agent = createAgent({ ...base, provider, compaction: { contextWindow: () => 1_000_000, thresholdPercent: () => null }, initialMessages: longHistory() });
    const before = agent.history().length;
    const outcome = await agent.compact("keep the API decisions");
    expect(outcome).toMatchObject({ ok: true, summary: "SUMMARY-ONE" });
    expect(agent.history().length).toBeLessThan(before);
    expect(flat(summaries[0])).toContain("keep the API decisions");
  });
});
