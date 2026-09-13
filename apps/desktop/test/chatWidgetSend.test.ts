import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/ai/automationHost.ts", () => ({
  aiAutomationTargets: () => [],
  onAiAutomationTargetsChanged: () => () => {},
}));

const chatWidget = await import("../src/renderer/ai/chatWidget.ts");

type DispatchChatSend = (
  text: string,
  deps: {
    readonly showUser: (text: string, attachments?: readonly unknown[]) => void;
    readonly aiSend: (text: string, attachments?: readonly unknown[]) => Promise<boolean>;
    readonly onFailure: () => void;
  },
  attachments?: readonly unknown[],
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
    expect(showUser).toHaveBeenCalledWith("Explain this change", []);
    expect(aiSend).toHaveBeenCalledWith("Explain this change");
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("sends attachments with an empty message, and nothing without either", () => {
    const showUser = vi.fn();
    const aiSend = vi.fn(async () => true);
    const onFailure = vi.fn();
    const dispatch = (chatWidget as { dispatchChatSend?: DispatchChatSend }).dispatchChatSend;
    const shot = { name: "shot.png", kind: "image", mediaType: "image/png", data: "aGVsbG8=" };

    expect(dispatch?.("   ", { showUser, aiSend, onFailure }, [shot])).toBe(true);
    expect(showUser).toHaveBeenCalledWith("", [shot]);
    expect(aiSend).toHaveBeenCalledWith("", [shot]);

    expect(dispatch?.("   ", { showUser, aiSend, onFailure })).toBe(false);
    expect(dispatch?.("   ", { showUser, aiSend, onFailure }, [])).toBe(false);
    expect(onFailure).not.toHaveBeenCalled();
  });
});
