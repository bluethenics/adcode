import { describe, expect, it } from "vitest";
import type { CatalogueProvider, Message } from "@adcode/ai";
import { compactThreshold, contextWindowFor, keptUserTurns, parseCompactFocus } from "../src/main/chatCompaction.ts";

describe("when to compact", () => {
  it("compacts at the chosen share of the context", () => {
    expect(compactThreshold({ "adcode.ai.autoCompact": true, "adcode.ai.autoCompactAt": "70" })).toBe(70);
    expect(compactThreshold({ "adcode.ai.autoCompact": true, "adcode.ai.autoCompactAt": "90" })).toBe(90);
  });

  it("defaults to 80% and on", () => {
    expect(compactThreshold({})).toBe(80);
    expect(compactThreshold({ "adcode.ai.autoCompactAt": "150" })).toBe(80);
  });

  it("never compacts on its own when switched off", () => {
    expect(compactThreshold({ "adcode.ai.autoCompact": false, "adcode.ai.autoCompactAt": "70" })).toBeNull();
  });
});

describe("a model's context size", () => {
  const catalogue: CatalogueProvider[] = [
    { id: "anthropic", name: "Anthropic", env: [], doc: null, models: [{ id: "big", name: "Big", toolCall: true, reasoning: false, contextWindow: 1_000_000 }] },
  ];

  it("comes from the catalogue", () => {
    expect(contextWindowFor(catalogue, "anthropic", "big")).toBe(1_000_000);
  });

  it("is assumed 128k for a model nobody published a size for", () => {
    expect(contextWindowFor(catalogue, "anthropic", "custom-finetune")).toBe(128_000);
    expect(contextWindowFor(catalogue, "custom", "anything")).toBe(128_000);
  });
});

describe("the focus a user gives /compact", () => {
  it("accepts a short focus and trims it", () => {
    expect(parseCompactFocus("  keep the API decisions ")).toBe("keep the API decisions");
  });

  it("treats nothing as no focus", () => {
    expect(parseCompactFocus(undefined)).toBeUndefined();
    expect(parseCompactFocus("   ")).toBeUndefined();
  });

  it("refuses what is not a short string", () => {
    expect(parseCompactFocus(42)).toBeNull();
    expect(parseCompactFocus("x".repeat(501))).toBeNull();
  });
});

describe("how many of the user's turns a compaction kept", () => {
  const user = (text: string): Message => ({ role: "user", content: [{ type: "text", text }] });
  const assistant: Message = { role: "assistant", content: [{ type: "text", text: "ok" }] };
  const results: Message = { role: "user", content: [{ type: "tool-result", toolCallId: "a", content: "", isError: false }] };

  it("counts the user's own turns in the kept part, not tool results", () => {
    const history = [user("<conversation-summary>s</conversation-summary>"), assistant, user("two"), assistant, results, user("three")];
    expect(keptUserTurns(history, 4)).toBe(2);
    expect(keptUserTurns(history, 1)).toBe(1);
  });

  it("counts none when the kept part is steps inside one turn", () => {
    expect(keptUserTurns([user("summary"), assistant, results], 2)).toBe(0);
  });
});
