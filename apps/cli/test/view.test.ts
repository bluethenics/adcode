import { describe, expect, it } from "vitest";
import { buildChatFrame, type ChatState } from "../src/chat/view.ts";
import { createUI } from "../src/tui/ui.ts";
import { stripAnsi } from "../src/tui/ansi.ts";

/**
 * A slow model is still visible work. The header used to say "thinking · 0 chars" for as
 * long as a provider reasoned, which reads like nothing is happening; these pin the words
 * to the actual stream.
 */

function state(overrides: Partial<ChatState> = {}): ChatState {
  return {
    session: {
      id: "s-test-123456",
      title: "Test conversation",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      messages: [
        { role: "user", text: "hello", at: 1_700_000_000_000 },
        { role: "assistant", text: "hi", at: 1_700_000_001_000 },
      ],
      provider: "tagflow",
      model: "test-default",
    },
    model: {
      providerId: "tagflow",
      providerName: "Included AI",
      modelId: "test-default",
      modelName: "Test Default",
      ready: true,
      reason: null,
      choice: { provider: "tagflow", model: "test-default" },
      included: true,
    },
    input: [],
    cursor: 0,
    history: [],
    historyIndex: null,
    historyDraft: "",
    mode: "chat",
    streaming: false,
    thinking: false,
    stopping: false,
    streamStartedAt: 1_700_000_002_000,
    streamText: "",
    streamModelName: "Test Default",
    streamThought: "",
    streamThinkingStartedAt: 0,
    streamThinkingMs: 0,
    tokens: 0,
    thinkingChars: 0,
    scroll: 0,
    scrollMaximum: 0,
    notice: null,
    phase: 0.2,
    caretOn: true,
    pickerModels: [],
    pickerIndex: 0,
    pickerVisual: 0,
    pickerFilter: [],
    helpScroll: 0,
    helpMaximum: 0,
    saved: true,
    turnStartedAt: 1_700_000_002_000,
    slashOpen: false,
    slashIndex: 0,
    effort: "auto",
    cwd: "E:/adcode-sourcecode",
    ...overrides,
  };
}

function frame(overrides: Partial<ChatState>, width = 100, height = 30): string {
  const ui = createUI({ theme: "midnight", color: false, unicode: true, width, height });
  return buildChatFrame({ ui, state: state(overrides), ads: [], width, height }).join("\n");
}

describe("the chat header reports the work in progress", () => {
  it("says thinking, not zero characters, before the provider sends anything", () => {
    const text = frame({ streaming: true, thinking: true, tokens: 0, thinkingChars: 0 });
    expect(text).toContain("thinking");
    expect(text).not.toContain("0 chars");
  });

  it("counts reasoning while a model thinks", () => {
    const text = frame({ streaming: true, thinking: true, streamText: "", thinkingChars: 420 });
    expect(text).toContain("reasoning");
    expect(text).toContain("420 chars");
    expect(text).not.toContain("streaming");
  });

  it("switches to the reply count once text arrives", () => {
    const text = frame({ streaming: true, thinking: false, streamText: "hello", tokens: 5, thinkingChars: 420 });
    expect(text).toContain("streaming");
    expect(text).toContain("5 chars");
    expect(text).not.toContain("reasoning");
  });

  it("returns to the message count when the reply is done", () => {
    const text = frame({ streaming: false });
    expect(text).toContain("2 messages");
    expect(text).not.toContain("chars");
  });
});

describe("the opencode-shaped surfaces", () => {
  it("shows the wordmark and prompt on an empty conversation", () => {
    const text = frame({
      session: { ...state().session, messages: [] },
      saved: false,
    });
    expect(text).toContain("What are we building?");
    expect(text).toContain("Ask a question, paste code, or type /");
    expect(text).toContain("Test Default");
  });

  it("filters the slash palette as the query narrows", () => {
    const text = frame({ slashOpen: true, input: ["/s"], cursor: 2 });
    expect(text).toContain("/sessions");
    expect(text).toContain("/status");
    expect(text).not.toContain("/model");
    expect(text).toContain("esc close");
  });

  it("keeps a saved thought block above the answer", () => {
    const text = frame({
      session: {
        ...state().session,
        messages: [
          { role: "user", text: "where is auth?", at: 1_700_000_000_000 },
          {
            role: "assistant",
            text: "It lives in auth.ts.",
            at: 1_700_000_001_000,
            thinking: "Find the middleware first.",
            thinkingMs: 4_000,
          },
        ],
      },
    });
    expect(text).toContain("thought");
    expect(text).toContain("Find the middleware first.");
    expect(text).toContain("It lives in auth.ts.");
    expect(text).not.toContain("chars");
  });

  it("fits a narrow terminal without losing the composer", () => {
    const text = frame({}, 54, 20);
    for (const line of text.split("\n")) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(54);
    }
    expect(text).toContain("Ask a question");
  });
});
