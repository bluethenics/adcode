import { describe, expect, it, vi } from "vitest";
import { runChatWidgetIntent } from "../src/renderer/ai/chatWidgetIntents.ts";

describe("Assistant feature intents", () => {
  it.each(["team", "schedule"] as const)("opens the Assistant before %s", (intent) => {
    const calls: string[] = [];
    const open = vi.fn(() => calls.push("open"));
    const showTeam = vi.fn(() => calls.push("team"));
    const showSchedule = vi.fn(() => calls.push("schedule"));

    runChatWidgetIntent(intent, { open, showTeam, showSchedule });

    expect(calls).toEqual(["open", intent]);
    expect(open).toHaveBeenCalledOnce();
  });
});
