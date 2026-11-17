/**
 * The chat's own usage box (renderer/ai/chatUsageModel.ts), the one-chat filter it reads
 * through (shared/usagePage.ts), and which room messages count as news for a notification
 * (renderer/collab/liveSessionDock.ts).
 */
import { describe, expect, it } from "vitest";
import { dayKey, type UsageRow } from "../src/shared/aiUsage.ts";
import { usagePage } from "../src/shared/usagePage.ts";
import { chatUsageModel } from "../src/renderer/ai/chatUsageModel.ts";
import { freshRoomMessages } from "../src/renderer/collab/liveSessionDock.ts";
import type { ArtifactRoomSnapshot } from "../src/shared/community.ts";

const NOW = new Date(2026, 10, 17, 12).getTime();
const row = (over: Partial<UsageRow>): UsageRow => ({ day: dayKey(NOW), provider: "anthropic", model: "sonnet", source: "chat", requests: 1, inputTokens: 1000, outputTokens: 100, cachedTokens: 0, estimatedRequests: 0, pricedRequests: 1, costMicros: 5000, ...over });
const context = (tokens: number) => ({ tokens, contextWindow: 200_000, thresholdPercent: 80, autoCompact: true });

describe("the one-chat filter", () => {
  it("counts only the chat asked for, and agents drop out", () => {
    const rows = [row({ chat: "a", requests: 3 }), row({ chat: "b", requests: 5 }), row({ source: "agents", requests: 7 })];
    const page = usagePage(rows, "all", NOW, { chat: "a" });
    expect(page.totals.requests).toBe(3);
    expect(page.filter.chat).toBe("a");
    expect(usagePage(rows, "all", NOW).totals.requests).toBe(15);
  });
});

describe("the chat usage box", () => {
  it("says nothing was used yet without inventing a zero cost", () => {
    const model = chatUsageModel(null, null, null);
    expect(model.empty).toBe(true);
    expect(model.chip).toBe("Usage");
    expect(model.rows).toEqual([]);
  });

  it("leads the chip with the context fill, then tokens and cost", () => {
    const page = usagePage([row({ chat: "a", requests: 2, inputTokens: 40_000, cachedTokens: 30_000, outputTokens: 2000, costMicros: 410_000 })], "all", NOW, { chat: "a" });
    const model = chatUsageModel(page, context(68_000), null);
    expect(model.chip).toBe("34% · 42k · $0.41");
    expect(model.rows.map((one) => one.id)).toEqual(["context", "tokens", "cost", "cache", "requests"]);
    expect(model.rows.find((one) => one.id === "cache")?.value).toBe("75%");
  });

  it("warns as the context nears compaction, and says so first", () => {
    const model = chatUsageModel(null, context(150_000), null);
    expect(model.rows[0]).toMatchObject({ id: "context", tone: "warn" });
    expect(model.tips[0]).toMatch(/filling up/);
    expect(chatUsageModel(null, context(170_000), null).rows[0]?.tone).toBe("full");
  });

  it("notices a model switch, which re-reads the history without the cache", () => {
    const page = usagePage([row({ chat: "a" }), row({ chat: "a", provider: "deepseek", model: "v4" })], "all", NOW, { chat: "a" });
    const model = chatUsageModel(page, null, null);
    expect(model.models).toHaveLength(2);
    expect(model.tips.some((tip) => /2 models/.test(tip))).toBe(true);
  });

  it("shows No price rather than $0 for an unpriced model", () => {
    const page = usagePage([row({ chat: "a", pricedRequests: 0, costMicros: 0 })], "all", NOW, { chat: "a" });
    expect(chatUsageModel(page, null, null).rows.find((one) => one.id === "cost")).toMatchObject({ value: "No price", tone: "muted" });
  });
});

describe("room messages worth a notification", () => {
  const message = (id: string, uid: string, kind = "chat") => ({ id, uid, name: uid === "me" ? "Me" : "Sam", text: `hi ${id}`, kind, at: 0 });
  const room = (messages: ReturnType<typeof message>[]) => ({ selfId: "me", messages } as unknown as ArtifactRoomSnapshot);

  it("is nothing on the first look: a backlog is not news", () => {
    expect(freshRoomMessages(room([message("1", "sam")]), null)).toEqual([]);
  });

  it("is what others said after the marker, not mine and not system lines", () => {
    const fresh = freshRoomMessages(room([message("1", "sam"), message("2", "me"), message("3", "sam"), message("4", "sam", "system")]), "1");
    expect(fresh.map((one) => one.id)).toEqual(["3"]);
  });

  it("counts none when the marker has scrolled away, rather than everything", () => {
    expect(freshRoomMessages(room([message("5", "sam")]), "1")).toEqual([]);
  });
});
