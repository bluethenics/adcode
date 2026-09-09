import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/ai/automationHost.ts", () => ({
  aiAutomationTargets: () => [],
  onAiAutomationTargetsChanged: () => () => {},
}));

const chatWidget = await import("../src/renderer/ai/chatWidget.ts");

type DispatchChatSend = (
  text: string,
  deps: {
    readonly showUser: (text: string) => void;
    readonly aiSend: (text: string) => Promise<boolean>;
    readonly onFailure: () => void;
  },
) => boolean;

describe("Chat composer dispatch", () => {
  it("clears the busy state when the backend declines a send", async () => {
    const onFailure = vi.fn();
    chatWidget.dispatchChatSend("Explain this file", {
      showUser: vi.fn(), aiSend: async () => false, onFailure,
    });
    await Promise.resolve();
    expect(onFailure).toHaveBeenCalledOnce();
  });
  it("shows the user message before dispatching a successful AI send", () => {
    const events: string[] = [];
    const showUser = vi.fn();
    showUser.mockImplementation((text: string) => events.push(`show:${text}`));
    const aiSend = vi.fn(async (text: string) => {
      events.push(`send:${text}`);
      return true;
    });
    const onFailure = vi.fn();
    const dispatch = (chatWidget as { dispatchChatSend?: DispatchChatSend }).dispatchChatSend;

    expect(dispatch).toBeTypeOf("function");
    expect(dispatch?.("  Explain this change  ", { showUser, aiSend, onFailure })).toBe(true);
    expect(events).toEqual(["show:Explain this change", "send:Explain this change"]);
    expect(showUser).toHaveBeenCalledWith("Explain this change");
    expect(aiSend).toHaveBeenCalledWith("Explain this change");
    expect(onFailure).not.toHaveBeenCalled();
  });
});
