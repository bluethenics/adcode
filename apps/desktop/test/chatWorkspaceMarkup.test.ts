import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/renderer/ai/chatWidget.ts", import.meta.url),
  "utf8",
);
const connectSource = readFileSync(
  new URL("../src/renderer/ai/connectView.ts", import.meta.url),
  "utf8",
);

describe("AI Chat workspace", () => {
  it("renders history, conversation, and inspector regions", () => {
    expect(source).toContain('history.className = "chat-history"');
    expect(source).toContain('conversation.className = "chat-conversation"');
    expect(source).toContain('inspector.className = "chat-inspector"');
    expect(source).toContain("body.append(history, conversation, inspector)");
  });

  it("retires free-drag position persistence", () => {
    expect(source).not.toContain("positionKey");
    expect(source).not.toContain("savePosition");
    expect(source).not.toContain("chat-resize");
  });
});

describe("Connect dialog content", () => {
  it("leaves dismissal and focus restoration to the shared popup coordinator", () => {
    expect(connectSource).toContain("readonly element: HTMLElement");
    expect(connectSource).toContain("shown(): void");
    expect(connectSource).toContain("hidden(): void");
    expect(connectSource).not.toContain("settings-sheet");
    expect(connectSource).not.toContain("document.addEventListener(\"keydown\"");
    expect(connectSource).not.toContain("restoreFocus");
  });
});
