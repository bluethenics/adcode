import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/renderer/ai/chatWidget.ts", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");
const connectSource = readFileSync(
  new URL("../src/renderer/ai/connectView.ts", import.meta.url),
  "utf8",
);
const mainSource = readFileSync(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");
const styles = readFileSync(
  new URL("../src/renderer/styles/ai.css", import.meta.url),
  "utf8",
);
const dockSource = readFileSync(
  new URL("../src/renderer/workbench/assistantDock.ts", import.meta.url),
  "utf8",
);
const sidebarSource = readFileSync(
  new URL("../src/renderer/workbench/vibeSidebar.ts", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");
const contextSource = readFileSync(
  new URL("../src/renderer/workbench/projectContext.ts", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");
const modeStyles = readFileSync(
  new URL("../src/renderer/styles/workspaceModes.css", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");
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

  it("keeps Vibe navigation attached to the shared conversation", () => {
    expect(sidebarSource).toContain("`vibe-nav-item ${className}`");
    expect(dockSource).toContain('(mode === "vibe" ? vibe : dock).append(chat.element)');
    // Conversations live in the Vibe sidebar at every width - docked or in the drawer.
    expect(dockSource).toContain('chat.setDocked(true, mode === "vibe" ? vibeSidebar?.historyHost : undefined)');
    expect(source).toContain('welcomeMark.classList.add("chat-welcome-mark")');
    expect(source).toContain('welcomeGreeting.textContent = hour < 5');
  });

  it("opens the full IDE beside Vibe instead of replacing it", () => {
    expect(sidebarSource).toContain("vibe-ide-button");
    expect(sidebarSource).toContain("Open IDE in a separate window");
    expect(sidebarSource).toContain('deps.run("workspace.openIde")');
    expect(mainSource).toContain('add("workspace.openIde"');
    expect(mainSource).toContain("window.adcode.window.openIde()");
    expect(mainSource).toContain('"#/ide"');
  });

  it("keeps Vibe requests in Vibe or hands them to the IDE intact", () => {
    // History in Vibe reveals the sidebar's list; it used to open the IDE window.
    expect(mainSource).toContain("revealHistory: () => assistantDock?.revealHistory()");
    expect(mainSource).not.toContain('revealHistory: () => showView("explorer")');
    // Files and search open the IDE on that view instead of whatever it last showed.
    expect(mainSource).toContain("void window.adcode.window.openIde(undefined, view);");
    // Ctrl+B hides the Vibe sidebar rather than opening the IDE.
    expect(mainSource).toContain('if (assistantDock?.mode() === "vibe") { assistantDock.toggleVibeSidebar(); return; }');
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

  it("renders Claude-style rich responses, actions, and connect guidance", () => {
    expect(source).toContain("renderChatMessageHtml");
    expect(source).toContain("chat-codeblock-copy");
    expect(source).toContain("chat-message-actions");
    expect(source).toContain("chat-connect-banner");
    expect(source).toContain("chat-conversation-title");
    expect(source).toContain("Chats and tasks");
    expect(source).toContain("chat-history-group");
    expect(source).toContain("chat-disclaimer");
    expect(connectSource).toContain("connect-steps");
    expect(styles).toContain(".chat-codeblock");
    expect(styles).toContain(".chat-message-actions");
    expect(styles).toContain(".chat-connect-banner");
    expect(styles).toContain(".connect-steps");
  });
});

describe("Context Changes tab", () => {
  it("reads Cursor-style: totals, branch, per-file counts, diff previews", () => {
    expect(contextSource).toContain("context-changes-head");
    expect(contextSource).toContain("Uncommitted");
    expect(contextSource).toContain("context-branch");
    expect(contextSource).toContain("context-change-new");
    expect(contextSource).toContain("context-change-diff");
    expect(contextSource).toContain("context-diff-text");
    expect(contextSource).toContain("fileIcon(entry.path)");
  });

  it("commits and pushes from beside the list, staged first", () => {
    expect(contextSource).toContain("context-commit-form");
    expect(contextSource).toContain("Commit & Push");
    expect(contextSource).toContain("window.adcode.git.commit(text)");
    expect(contextSource).toContain("window.adcode.git.push()");
    expect(contextSource).toContain("A commit needs a message.");
  });

  it("stays honest about what git cannot number", () => {
    expect(contextSource).toContain("New file — its contents join the commit when staged.");
    expect(contextSource).toContain("diff truncated — open in Source Control for the rest.");
  });

  it("carries the panel styling with reduced-motion cover", () => {
    expect(modeStyles).toContain(".context-change-totals");
    expect(modeStyles).toContain(".context-commit-send");
    expect(modeStyles).toContain(".context-diff-text");
    expect(modeStyles).toContain("prefers-reduced-motion");
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
    expect(smoke).toMatch(
      /checks\.chatConnectWorkspace\s*=[\s\S]*typeof checks\.chatDisclosureResponsiveEvidence === "object"[\s\S]*Object\.values\(checks\.chatDisclosureResponsiveEvidence\)\.every/,
    );
    expect(smoke).toContain("await setChatViewport(900)");
    expect(smoke).toContain("await setChatViewport(640)");
    expect(smoke).toContain("checks.chatSendHistoryEvidence");
    expect(smoke).toContain("const CHAT_SMOKE_SESSION");
    expect(smoke).toContain('createHash("sha256").update(REPO)');
    expect(smoke).toContain("await window.adcode.chat.sessions()");
    expect(smoke).toContain("chat-history-open");
    expect(smoke).toContain("const EVALUATE_TIMEOUT_MS");
    expect(smoke).toContain("Runtime.evaluate timed out");
    expect(smoke).not.toContain("ADCODE_SMOKE_CHAT_PROBE");
    expect(smoke).not.toContain("chatConnectProbeBefore");
    expect(smoke).not.toContain("composer.dispatchEvent(new Event('submit'");
    expect(smoke).toContain("checks.chatDependentPointerEvidence");
    expect(smoke).toContain("providerSelected,");
    expect(smoke).not.toContain("connect?.querySelectorAll('.connect-row').length === 0");
  });

  it("keeps a flush composer visibly bounded with one CSS pixel of rounding tolerance", () => {
    expect(smoke).toContain("const composerTolerance = 1;");
    expect(smoke).toContain(
      "const composerBottomLimit = Math.min(surfaceBox.bottom, innerHeight);",
    );
    expect(smoke).toContain("composerBox.width > 0 && composerBox.height > 0");
    expect(smoke).toContain("composerBox.top < composerBottomLimit");
    expect(smoke).toContain(
      "composerBox.bottom <= composerBottomLimit + composerTolerance",
    );
  });
});
