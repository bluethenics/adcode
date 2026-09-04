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
const mainSource = readFileSync(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../src/renderer/styles/ai.css", import.meta.url),
  "utf8",
);
const smoke = readFileSync(
  new URL("../../../scripts/smoke.mjs", import.meta.url),
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

  it("reclaims conversation width for every disclosure combination", () => {
    expect(styles).toContain(
      '.chat-card[data-history-open="false"][data-inspector-open="true"] .chat-body',
    );
    expect(styles).toContain(
      '.chat-card[data-history-open="true"][data-inspector-open="false"] .chat-body',
    );
    expect(styles).toContain(
      '.chat-card[data-history-open="false"][data-inspector-open="false"] .chat-body',
    );
    expect(styles).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(styles).toContain("@media (max-width: 980px)");
    expect(styles).toContain("@media (max-width: 720px)");
    expect(styles).toMatch(
      /@media \(max-width: 980px\)[\s\S]*data-history-open="false"\]\[data-inspector-open="true"\] .chat-body/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*\.chat-card\[data-history-open\]\[data-inspector-open\] .chat-body/,
    );
  });

  it("keeps background Team paints from reopening a collapsed inspector", () => {
    const suggestion = source.slice(
      source.indexOf("function paintTeamSuggestion"),
      source.indexOf("function paintTeam(team"),
    );
    const team = source.slice(
      source.indexOf("function paintTeam(team"),
      source.indexOf("async function refreshTeam"),
    );

    expect(suggestion).not.toContain("revealInspector()");
    expect(team).not.toContain("revealInspector()");
  });

  it("opens the inspector from explicit Team and Schedule actions", () => {
    expect(source).toContain("function revealInspector(): void");
    expect(source).toContain(
      "function showScheduleComposer(): void {\n    revealInspector();",
    );
    expect(source).toContain(
      "showTeam: () => {\n          revealInspector();",
    );
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

describe("Chat Connect ownership", () => {
  it("keeps the dependent Connect surface inside coordinator dismissal bounds", () => {
    expect(mainSource).toContain("dependent?.shell.surface.contains(event.target as Node)");
    expect(mainSource).toContain(
      "if (popupLayerState.dependent !== null) {\n      closeDependentPopup(popupLayerState.dependent);\n      return;\n    }",
    );
    expect(mainSource).toContain(
      'openDependentPopup("connect", connectShell, chat.connectButton, "chat", "pointer")',
    );
  });

  it("keeps collapsed disclosure and send-history smoke evidence explicit", () => {
    expect(smoke).toContain("checks.chatDisclosureGeometry");
    expect(smoke).toContain("checks.chatDisclosureResponsiveEvidence");
    expect(smoke).toContain("await setChatViewport(900)");
    expect(smoke).toContain("await setChatViewport(640)");
    expect(smoke).toContain("checks.chatSendHistoryEvidence");
    expect(smoke).toContain("const CHAT_SMOKE_SESSION");
    expect(smoke).toContain('createHash("sha256").update(REPO)');
    expect(smoke).toContain("await window.adcode.chat.sessions()");
    expect(smoke).toContain("chat-history-open");
    expect(smoke).toContain("const EVALUATE_TIMEOUT_MS");
    expect(smoke).toContain("Runtime.evaluate timed out");
    expect(smoke).not.toContain("composer.dispatchEvent(new Event('submit'");
    expect(smoke).toContain("checks.chatDependentPointerEvidence");
    expect(smoke).toContain("providerSelected,");
    expect(smoke).not.toContain("connect?.querySelectorAll('.connect-row').length === 0");
  });
});
