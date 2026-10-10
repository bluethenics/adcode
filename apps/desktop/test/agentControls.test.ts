import { describe, expect, it } from "vitest";
import { stopLabelFor } from "../src/renderer/liveAgents/chatLiveRoom.ts";
import { appearanceWrites } from "../src/renderer/ai/chatAppearanceDialog.ts";
import { chatAppearanceFrom } from "../src/renderer/ai/chatAppearance.ts";

describe("stopping agents from the chat", () => {
  it("stops a solo run or the chat alone, a Team as a whole, and leaves terminal panes to the terminal", () => {
    expect(stopLabelFor("solo")).toBe("Stop");
    expect(stopLabelFor("chat")).toBe("Stop");
    expect(stopLabelFor("team")).toBe("Stop team");
    expect(stopLabelFor("terminal")).toBeNull();
  });
});

describe("saving Customise chat", () => {
  it("writes only the rows that changed", () => {
    const before = chatAppearanceFrom({});
    expect(appearanceWrites(before, before)).toEqual([]);
    const after = { ...before, name: "Ada", look: { ...before.look, color: "teal" as const }, avatars: false };
    expect(appearanceWrites(before, after)).toEqual([
      ["adcode.appearance.assistantName", "Ada"],
      ["adcode.appearance.assistantColor", "teal"],
      ["adcode.appearance.agentAvatars", false],
    ]);
  });
});
