/**
 * The shared browser without a browser: what an address bar entry becomes, which commands
 * the assistant may give, and how a page's accessibility tree turns into an outline with refs.
 */
import { describe, expect, it } from "vitest";
import { addressFromInput, buildRefSnapshot, formatRefSnapshot, isLiveBrowserUrl, liveKey, parseLiveBrowserInput, type AxNode } from "../src/main/liveBrowserModel.ts";

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
    expect(parseLiveBrowserInput({ command: "click", ref: "@e12" })).toEqual({ kind: "click", ref: "e12" });
    expect(parseLiveBrowserInput({ command: "fill", ref: "e3", text: "hello", submit: true })).toEqual({ kind: "fill", ref: "e3", text: "hello", submit: true });
    expect(parseLiveBrowserInput({ command: "scroll", direction: "up", amount: 99_999 })).toEqual({ kind: "scroll", direction: "up", amount: 5000 });
    expect(parseLiveBrowserInput({ command: "switch_tab", tab: 2 })).toEqual({ kind: "switch_tab", tab: 2 });
  });

  it("says what is missing instead of guessing", () => {
    expect(parseLiveBrowserInput({ command: "click", ref: "#submit" })).toContain("needs ref");
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
