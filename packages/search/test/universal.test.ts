import { describe, expect, it } from "vitest";
import {
  rankUniversalItems,
  type UniversalSearchItem,
} from "../src/universal.ts";

const item = (
  kind: UniversalSearchItem["kind"],
  id: string,
  title: string,
  detail?: string,
): UniversalSearchItem => ({
  id: `${kind}:${id}`,
  kind,
  title,
  ...(detail === undefined ? {} : { detail }),
});

describe("universal search ranking", () => {
  it("orders equal matches by useful result kind", () => {
    const fixture = [
      item("recent", "team", "Team"),
      item("file", "team.ts", "Team"),
      item("symbol", "Team", "Team"),
      item("command", "ai.team", "Team"),
      item("feature", "ai.team", "Team"),
    ];

    expect(rankUniversalItems("team", fixture).map((result) => result.id)).toEqual([
      "feature:ai.team",
      "command:ai.team",
      "file:team.ts",
      "symbol:Team",
      "recent:team",
    ]);
  });

  it("prefers exact and prefix text over a fuzzy subsequence", () => {
    const fixture = [
      item("feature", "scattered", "Set team concurrency"),
      item("command", "prefix", "Team setup"),
      item("file", "exact", "team"),
    ];

    expect(rankUniversalItems("team", fixture).map((result) => result.id)).toEqual([
      "file:exact",
      "command:prefix",
      "feature:scattered",
    ]);
  });

  it("matches detail, keywords, and stable ids", () => {
    const fixture: UniversalSearchItem[] = [
      { ...item("feature", "schedule", "Scheduled messages"), keywords: ["send later"] },
      item("file", "docs", "guide.md", "docs/features/complete-feature-guide.md"),
    ];

    expect(rankUniversalItems("send later", fixture)[0]?.id).toBe("feature:schedule");
    expect(rankUniversalItems("complete-feature", fixture)[0]?.id).toBe("file:docs");
  });

  it("deduplicates ids and applies per-source and total caps", () => {
    const fixture = [
      ...Array.from({ length: 8 }, (_, at) => item("feature", String(at), `Match ${at}`)),
      item("feature", "0", "Duplicate"),
      ...Array.from({ length: 8 }, (_, at) => item("command", String(at), `Match ${at}`)),
    ];

    const ranked = rankUniversalItems("match", fixture, { perKind: 3, total: 5 });
    expect(ranked).toHaveLength(5);
    expect(ranked.filter((result) => result.kind === "feature")).toHaveLength(3);
    expect(new Set(ranked.map((result) => result.id)).size).toBe(ranked.length);
  });

  it("shows a balanced stable set for an empty query", () => {
    const fixture = [
      ...Array.from({ length: 5 }, (_, at) => item("feature", String(at), `Feature ${at}`)),
      ...Array.from({ length: 5 }, (_, at) => item("command", String(at), `Command ${at}`)),
      ...Array.from({ length: 5 }, (_, at) => item("recent", String(at), `Recent ${at}`)),
    ];

    expect(rankUniversalItems("", fixture, { perKind: 2, total: 6 }).map((result) => result.id)).toEqual([
      "feature:0",
      "feature:1",
      "command:0",
      "command:1",
      "recent:0",
      "recent:1",
    ]);
  });

  it("uses a leading greater-than sign as a command-only filter", () => {
    const fixture = [
      item("feature", "assistant", "Assistant"),
      item("command", "ai.toggle", "Assistant"),
      item("file", "assistant.ts", "assistant.ts"),
    ];

    expect(rankUniversalItems("> assistant", fixture).map((result) => result.id)).toEqual([
      "command:ai.toggle",
    ]);
  });
});
