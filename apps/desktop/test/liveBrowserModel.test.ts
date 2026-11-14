/**
 * The shared browser without a browser: what an address bar entry becomes, which commands
 * the assistant may give, and how a page's accessibility tree turns into an outline with refs.
 */
import { describe, expect, it } from "vitest";
import {
  addressFromInput,
  buildRefSnapshot,
  FOCUS_IS_EDITABLE_SCRIPT,
  focusWebviewScript,
  formatRefSnapshot,
  insertTextInPageScript,
  isLiveBrowserUrl,
  isSecretField,
  keyCombo,
  liveKey,
  MAX_BATCH_STEPS,
  parseLiveBrowserInput,
  pointerPath,
  RETURN_FOCUS_SCRIPT,
  textLanded,
  webviewFocusedScript,
  type AxNode,
} from "../src/main/liveBrowserModel.ts";

describe("what is typed in the address bar", () => {
  it("keeps a full address, adds https to a host and http to this machine", () => {
    expect(addressFromInput("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(addressFromInput("example.com")).toBe("https://example.com/");
    expect(addressFromInput("localhost:5173/app")).toBe("http://localhost:5173/app");
    expect(addressFromInput("127.0.0.1:3000")).toBe("http://127.0.0.1:3000/");
  });

  it("searches for anything that is not an address", () => {
    expect(addressFromInput("how to centre a div")).toBe("https://www.google.com/search?q=how%20to%20centre%20a%20div");
    expect(addressFromInput("gmail")).toContain("google.com/search?q=gmail");
  });

  it("refuses everything that is not the web", () => {
    expect(addressFromInput("file:///C:/Windows/win.ini")).toBeNull();
    expect(addressFromInput("javascript://alert(1)")).toBeNull();
    expect(addressFromInput("   ")).toBeNull();
    expect(isLiveBrowserUrl("app://adcode/index.html")).toBe(false);
    expect(isLiveBrowserUrl("chrome://settings")).toBe(false);
    expect(isLiveBrowserUrl("https://example.com")).toBe(true);
    expect(isLiveBrowserUrl("about:blank")).toBe(true);
  });
});

describe("the assistant's browser commands", () => {
  it("reads each command with its own needs", () => {
    expect(parseLiveBrowserInput({ command: "open", url: "example.com" })).toEqual({ kind: "open", url: "https://example.com/", newTab: false });
    expect(parseLiveBrowserInput({ command: "new_tab" })).toEqual({ kind: "open", url: "about:blank", newTab: true });
    expect(parseLiveBrowserInput({ command: "click", ref: "@e12" })).toEqual({ kind: "click", at: { ref: "e12" }, button: "left", count: 1 });
    expect(parseLiveBrowserInput({ command: "fill", ref: "e3", text: "hello", submit: true })).toEqual({ kind: "fill", ref: "e3", text: "hello", submit: true, delay: 0 });
    expect(parseLiveBrowserInput({ command: "scroll", direction: "up", amount: 99_999 })).toEqual({ kind: "scroll", direction: "up", amount: 5000, at: null });
    expect(parseLiveBrowserInput({ command: "switch_tab", tab: 2 })).toEqual({ kind: "switch_tab", tab: 2 });
  });

  it("points wherever a person could: a ref, or x and y on the screenshot", () => {
    expect(parseLiveBrowserInput({ command: "click", x: 42, y: 80 })).toEqual({ kind: "click", at: { x: 42, y: 80 }, button: "left", count: 1 });
    expect(parseLiveBrowserInput({ command: "double_click", ref: "e2" })).toMatchObject({ kind: "click", at: { ref: "e2" }, count: 2 });
    expect(parseLiveBrowserInput({ command: "right_click", x: 10, y: 20 })).toMatchObject({ button: "right" });
    expect(parseLiveBrowserInput({ command: "hover", ref: "e9" })).toEqual({ kind: "hover", at: { ref: "e9" } });
    expect(parseLiveBrowserInput({ command: "hold", ref: "e4", ms: 99_999 })).toEqual({ kind: "hold", at: { ref: "e4" }, ms: 10_000 });
    expect(parseLiveBrowserInput({ command: "mouse_down", ref: "e1", button: "right" })).toEqual({ kind: "mouse_down", at: { ref: "e1" }, button: "right" });
    expect(parseLiveBrowserInput({ command: "mouse_up", x: 5, y: 6 })).toEqual({ kind: "mouse_up", at: { x: 5, y: 6 }, button: "left" });
    expect(parseLiveBrowserInput({ command: "key_down", key: "Shift" })).toEqual({ kind: "key_down", key: "Shift" });
    expect(parseLiveBrowserInput({ command: "drag", ref: "e1", to_x: 300, to_y: 400 })).toEqual({ kind: "drag", from: { ref: "e1" }, to: { x: 300, y: 400 } });
    expect(parseLiveBrowserInput({ command: "scroll", at: null, direction: "right", amount: 300 })).toEqual({ kind: "scroll", direction: "right", amount: 300, at: null });
  });

  it("runs several human steps in one call, and refuses a batch inside a batch", () => {
    const batch = parseLiveBrowserInput({
      command: "batch",
      actions: [
        { command: "click", ref: "e1" },
        { command: "type", text: "hello", delay: 40 },
        { command: "press", key: "Enter" },
      ],
    });
    expect(batch).toEqual({
      kind: "batch",
      steps: [
        { kind: "click", at: { ref: "e1" }, button: "left", count: 1 },
        { kind: "type", text: "hello", delay: 40 },
        { kind: "press", key: "Enter" },
      ],
    });
    expect(parseLiveBrowserInput({ command: "batch", actions: [{ command: "batch", actions: [] }] })).toContain("cannot hold another batch");
    expect(parseLiveBrowserInput({ command: "batch", actions: Array.from({ length: MAX_BATCH_STEPS + 1 }, () => ({ command: "wait", ms: 100 })) })).toContain("at most");
  });

  it("says what is missing instead of guessing", () => {
    expect(parseLiveBrowserInput({ command: "click", ref: "#submit" })).toContain("must be a ref");
    expect(parseLiveBrowserInput({ command: "fill", ref: "e1" })).toContain("needs text");
    expect(parseLiveBrowserInput({ command: "open", url: "file:///etc/passwd" })).toContain("needs url");
    expect(parseLiveBrowserInput({ command: "close_tab", tab: "1" })).toContain("needs tab");
    expect(parseLiveBrowserInput({ command: "download" })).toContain("Unknown browser command");
  });

  it("knows the keys it can press", () => {
    expect(liveKey("enter")).toMatchObject({ key: "Enter", keyCode: 13, text: "\r" });
    expect(liveKey("esc")).toMatchObject({ key: "Escape" });
    expect(liveKey("Space")).toMatchObject({ key: " ", text: " " });
    expect(liveKey("F13")).toBeNull();
  });

  it("sends combinations with the modifiers held around them", () => {
    const selectAll = keyCombo("Control+A");
    expect(selectAll).toMatchObject({ key: "A", code: "KeyA", keyCode: 65, modifiers: 2 });
    expect(selectAll?.text).toBeUndefined();
    expect(selectAll?.held.map((modifier) => modifier.key)).toEqual(["Control"]);
    expect(keyCombo("Shift+Tab")).toMatchObject({ key: "Tab", modifiers: 8 });
    expect(keyCombo("Page Down")).toMatchObject({ key: "PageDown", keyCode: 34 });
    expect(keyCombo("+")).toMatchObject({ key: "+", text: "+" });
    expect(keyCombo("Control+Control+A")).toBeNull();
    expect(keyCombo("F13")).toBeNull();
  });

  it("moves the pointer along a human curve that ends exactly where it should", () => {
    const path = pointerPath({ x: 0, y: 0 }, { x: 400, y: 300 }, 7);
    expect(path.length).toBeGreaterThan(3);
    expect(path.at(-1)).toEqual({ x: 400, y: 300 });
    expect(path.some((point) => point.x !== 0 && point.y !== 0)).toBe(true);
    expect(pointerPath({ x: 5, y: 5 }, { x: 5, y: 6 })).toEqual([{ x: 5, y: 6 }]);
  });

  it("checks that typed text really landed in the field", () => {
    expect(textLanded("hello world", "hello world")).toBe(true);
    expect(textLanded("hello  world\n", "hello world")).toBe(true);
    expect(textLanded("something else", "hello world")).toBe(false);
    expect(textLanded(null, "hello")).toBe(false);
  });

  it("gives the keyboard to the webview, not to ADCode's chat, and hands it back", () => {
    const focus = focusWebviewScript(42);
    // The bug: insertText followed the window's focus, which was the chat box.
    expect(focus).toContain("getWebContentsId() === 42");
    expect(focus).toContain("view.focus");
    expect(focus).toContain("__adcodeBrowserReturnFocus");
    expect(webviewFocusedScript(42)).toContain("getWebContentsId() === 42");
    expect(webviewFocusedScript(42)).toContain("document.activeElement === view");
    expect(RETURN_FOCUS_SCRIPT).toContain('document.activeElement.tagName !== "WEBVIEW"');
    // The hidden-panel fallback edits the page itself, so text cannot reach another window.
    expect(insertTextInPageScript('say "hi"')).toContain('execCommand("insertText"');
    expect(insertTextInPageScript('say "hi"')).toContain('\\"hi\\"');
    expect(FOCUS_IS_EDITABLE_SCRIPT).toContain("isContentEditable");
    // The "never type passwords or card numbers" promise is a rule, not a suggestion.
    expect(isSecretField({ type: "password" })).toBe(true);
    expect(isSecretField({ type: "text", autocomplete: "cc-number" })).toBe(true);
    expect(isSecretField({ type: "text", autocomplete: "current-password" })).toBe(true);
    expect(isSecretField({ type: "email", autocomplete: "email" })).toBe(false);
    expect(isSecretField({ type: "text" })).toBe(false);
  });
});

describe("a page as an outline with refs", () => {
  const nodes: AxNode[] = [
    { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Shop" }, childIds: ["2", "3", "6", "8"] },
    { nodeId: "2", role: { value: "heading" }, name: { value: "Welcome" }, properties: [{ name: "level", value: { value: 1 } }], backendDOMNodeId: 10, childIds: ["9"] },
    { nodeId: "9", role: { value: "StaticText" }, name: { value: "Welcome" } },
    { nodeId: "3", role: { value: "link" }, name: { value: "Sign in" }, backendDOMNodeId: 11, childIds: ["4"] },
    { nodeId: "4", role: { value: "StaticText" }, name: { value: "Sign in" } },
    { nodeId: "6", role: { value: "textbox" }, name: { value: "Email" }, value: { value: "a@b.c" }, properties: [{ name: "required", value: { value: true } }], backendDOMNodeId: 12 },
    { nodeId: "8", role: { value: "button" }, name: { value: "Hidden" }, ignored: true, backendDOMNodeId: 13 },
  ];

  it("gives every control a ref and does not repeat a control's own words", () => {
    const snapshot = buildRefSnapshot(nodes, false);
    expect(snapshot.lines).toEqual([
      '- heading "Welcome" [level=1]',
      '- link "Sign in" [ref=e1]',
      '- textbox "Email" [ref=e2] value="a@b.c" [required]',
    ]);
    expect([...snapshot.refs]).toEqual([["e1", 11], ["e2", 12]]);
    expect(snapshot.truncated).toBe(false);
  });

  it("lists controls only when asked, and ignored nodes never", () => {
    expect(buildRefSnapshot(nodes, true).lines).toEqual(['- link "Sign in" [ref=e1]', '- textbox "Email" [ref=e2] value="a@b.c" [required]']);
  });

  it("says when a page is long and when it is empty", () => {
    const many: AxNode[] = [{ nodeId: "r", role: { value: "RootWebArea" }, childIds: Array.from({ length: 400 }, (_value, index) => `b${index.toString()}`) },
      ...Array.from({ length: 400 }, (_value, index): AxNode => ({ nodeId: `b${index.toString()}`, role: { value: "button" }, name: { value: `B${index.toString()}` }, backendDOMNodeId: index }))];
    const long = buildRefSnapshot(many, true);
    expect(long.truncated).toBe(true);
    expect(long.lines.length).toBe(320);
    expect(formatRefSnapshot({ url: "https://x.test/", title: "X" }, long)).toContain("More below");
    expect(formatRefSnapshot({ url: "https://x.test/", title: "" }, buildRefSnapshot([], false))).toContain("nothing to list yet");
  });
});
