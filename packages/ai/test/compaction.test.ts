import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  SUMMARY_OPEN,
  compactedHistory,
  compactionCut,
  compactionDue,
  estimateTokens,
  isSummaryMessage,
  planCompaction,
  summaryRequest,
  type Message,
} from "@adcode/ai";

const user = (text: string): Message => ({ role: "user", content: [{ type: "text", text }] });
const assistant = (text: string): Message => ({ role: "assistant", content: [{ type: "text", text }] });
const call = (id: string, name = "read_file", text?: string): Message => ({
  role: "assistant",
  content: [...(text === undefined ? [] : [{ type: "text" as const, text }]), { type: "tool-call", id, name, input: { path: `src/${id}.ts` } }],
});
const result = (id: string, content = "x".repeat(40)): Message => ({
  role: "user",
  content: [{ type: "tool-result", toolCallId: id, content, isError: false }],
});

/** Every call in `tail` has its result in `tail`, and every result answers a call in `tail`. */
function pairsIntact(tail: readonly Message[]): boolean {
  const calls = new Set<string>();
  const results = new Set<string>();
  for (const message of tail) {
    for (const block of message.content) {
      if (block.type === "tool-call") calls.add(block.id);
      if (block.type === "tool-result") results.add(block.toolCallId);
    }
  }
  const last = tail[tail.length - 1];
  // The newest assistant message's calls are allowed to be unanswered: the results come next.
  const open = new Set(last?.role === "assistant" ? last.content.flatMap((block) => (block.type === "tool-call" ? [block.id] : [])) : []);
  return [...calls].every((id) => results.has(id) || open.has(id)) && [...results].every((id) => calls.has(id));
}

describe("estimateTokens", () => {
  it("grows with the conversation", () => {
    const small = estimateTokens("system", [user("hi")], []);
    const large = estimateTokens("system", [user("hi"), assistant("y".repeat(3000))], []);
    expect(large).toBeGreaterThan(small + 900);
  });

  it("counts an image as a flat allowance, not its base64 length", () => {
    const image: Message = { role: "user", content: [{ type: "image", mediaType: "image/png", data: "A".repeat(600_000) }, { type: "text", text: "what is this" }] };
    const tokens = estimateTokens("", [image], []);
    expect(tokens).toBeGreaterThan(1000);
    expect(tokens).toBeLessThan(5000);
  });
});

describe("compactionDue", () => {
  it("is never due when automatic compaction is off", () => {
    expect(compactionDue(1_000_000, 100_000, 8_000, null)).toBe(false);
  });

  it("is due at the threshold share of what is left after the answer's reservation", () => {
    // (100k - 8k) * 80% = 73.6k
    expect(compactionDue(73_600, 100_000, 8_000, 80)).toBe(true);
    expect(compactionDue(73_599, 100_000, 8_000, 80)).toBe(false);
  });

  it("does not let a huge output reservation make every request due", () => {
    // Reserving more than half the window still leaves half of it to fill.
    expect(compactionDue(10_000, 32_000, 30_000, 80)).toBe(false);
  });
});

describe("compactionCut", () => {
  const history: Message[] = [
    user("first question"),
    assistant("first answer"),
    user("second question"),
    call("c1"),
    result("c1"),
    assistant("second answer"),
    user("third question"),
    assistant("third answer"),
    user("fourth question"),
  ];

  it("cuts at the start of a user turn, keeping as much as fits", () => {
    const tokens = estimateTokens("", history.slice(6), []);
    expect(compactionCut(history, tokens)).toBe(6);
  });

  it("never starts the tail on a message of tool results", () => {
    for (let keep = 1; keep < 400; keep += 7) {
      const cut = compactionCut(history, keep);
      if (cut === null) continue;
      expect(history[cut]?.content.some((block) => block.type === "tool-result")).toBe(false);
    }
  });

  it("has nothing to do with a two-message conversation", () => {
    expect(compactionCut([user("a"), assistant("b")], 1)).toBeNull();
  });

  it("leaves at least two messages to summarise", () => {
    expect(compactionCut([user("a"), user("b"), user("c")], 1)).not.toBe(1);
  });

  it("cuts inside one long turn, before an assistant step, when that turn alone is too big", () => {
    const turn: Message[] = [user("do the big refactor")];
    for (let i = 0; i < 10; i++) turn.push(call(`k${i}`), result(`k${i}`, "z".repeat(3000)));
    const cut = compactionCut(turn, 2500);
    expect(cut).not.toBeNull();
    expect(turn[cut!]?.role).toBe("assistant");
    expect(pairsIntact(turn.slice(cut!))).toBe(true);
    expect(estimateTokens("", turn.slice(cut!), [])).toBeLessThanOrEqual(2500);
  });

  it("keeps tool calls with their results for any history and any budget", () => {
    const arbitraryHistory = fc
      .array(fc.oneof(fc.constant("turn"), fc.constant("step"), fc.constant("reply")), { minLength: 1, maxLength: 30 })
      .map((shape) => {
        const messages: Message[] = [user("start")];
        let n = 0;
        for (const kind of shape) {
          const last = messages[messages.length - 1]!;
          if (kind === "turn" && last.role === "assistant") messages.push(user(`q${n++}`));
          else if (kind === "step" && last.role === "user") {
            const id = `t${n++}`;
            messages.push(call(id), result(id, "r".repeat(50 + n * 13)));
          } else if (kind === "reply" && last.role === "user") messages.push(assistant(`a${n++}`));
        }
        return messages;
      });
    fc.assert(
      fc.property(arbitraryHistory, fc.integer({ min: 1, max: 2000 }), (messages, keep) => {
        const cut = compactionCut(messages, keep);
        if (cut === null) return true;
        return cut >= 2 && cut < messages.length && pairsIntact(messages.slice(cut));
      }),
      { numRuns: 400 },
    );
  });
});

describe("planCompaction", () => {
  it("carries the request being worked on when the cut falls inside that turn", () => {
    const turn: Message[] = [user("rename every widget to gadget")];
    for (let i = 0; i < 8; i++) turn.push(call(`w${i}`), result(`w${i}`, "q".repeat(3000)));
    const plan = planCompaction(turn, 2500);
    expect(plan?.request).toBe("rename every widget to gadget");
    expect(plan?.older.length).toBe(plan?.cut);
  });

  it("carries nothing extra when the tail starts with the user's own turn", () => {
    const history = [user("a"), assistant("b"), user("c"), assistant("d"), user("e")];
    expect(planCompaction(history, estimateTokens("", history.slice(4), []))?.request).toBeNull();
  });
});

describe("summaryRequest", () => {
  const older: Message[] = [
    user("make the header sticky"),
    call("s1", "read_file", "Reading the header."),
    result("s1", "h".repeat(2000)),
    { role: "user", content: [{ type: "image", mediaType: "image/png", data: "AAAA" }, { type: "text", text: "like this" }] },
    assistant("Done - the header sticks."),
  ];

  it("renders the conversation as a readable transcript for the summariser", () => {
    const request = summaryRequest(older);
    const text = request.messages.map((message) => message.content.map((block) => (block.type === "text" ? block.text : "")).join("")).join("\n");
    expect(text).toContain("make the header sticky");
    expect(text).toContain("→ read_file(");
    expect(text).toContain("[image]");
    expect(text).toContain("Done - the header sticks.");
    expect(text).not.toContain("h".repeat(700));
    expect(request.messages[0]?.role).toBe("user");
    expect(request.system.toLowerCase()).toContain("summar");
  });

  it("carries an earlier summary into the next one", () => {
    const earlier = compactedHistory("The user wants a dark theme; tokens live in theme.css.", [user("next")]);
    const request = summaryRequest([...earlier, assistant("ok")]);
    expect(JSON.stringify(request.messages)).toContain("tokens live in theme.css");
  });

  it("includes a focus when one is given", () => {
    expect(JSON.stringify(summaryRequest(older, "keep the API decisions").messages)).toContain("keep the API decisions");
  });

  it("drops the oldest part rather than sending a transcript too long for the model", () => {
    const long = [user("OLDEST-" + "a".repeat(5000)), assistant("b".repeat(5000)), user("NEWEST question")];
    const text = JSON.stringify(summaryRequest(long, undefined, 3000).messages);
    expect(text).toContain("NEWEST question");
    expect(text).not.toContain("OLDEST-");
    expect(text.length).toBeLessThan(6000);
  });
});

describe("compactedHistory", () => {
  it("puts the summary ahead of the user's turn in one message", () => {
    const history = compactedHistory("summary text", [user("carry on"), assistant("sure")]);
    expect(history).toHaveLength(2);
    expect(history[0]?.role).toBe("user");
    expect(history[0]?.content[0]).toMatchObject({ type: "text" });
    expect(JSON.stringify(history[0])).toContain("summary text");
    expect(JSON.stringify(history[0])).toContain("carry on");
    expect(isSummaryMessage(history[0]!)).toBe(true);
  });

  it("starts with a user message when the tail starts with an assistant step", () => {
    const history = compactedHistory("summary text", [call("a1"), result("a1")], "fix the build");
    expect(history.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(JSON.stringify(history[0])).toContain("fix the build");
  });

  it("never puts two user messages side by side at the seam", () => {
    for (const tail of [[user("x")], [assistant("y")], [] as Message[]]) {
      const history = compactedHistory("s", tail);
      expect(history[0]?.role).toBe("user");
      expect(history[1]?.role ?? "assistant").toBe("assistant");
    }
  });

  it("keeps tool results first when the tail's first message carries them", () => {
    const tail: Message[] = [{ role: "user", content: [{ type: "tool-result", toolCallId: "z", content: "", isError: true }, { type: "text", text: "next" }] }];
    expect(compactedHistory("s", tail)[0]?.content[0]?.type).toBe("tool-result");
  });

  it("marks only summary messages as summaries", () => {
    expect(isSummaryMessage(user(`${SUMMARY_OPEN} not really`))).toBe(true);
    expect(isSummaryMessage(user("hello"))).toBe(false);
    expect(isSummaryMessage(assistant(SUMMARY_OPEN))).toBe(false);
  });
});
