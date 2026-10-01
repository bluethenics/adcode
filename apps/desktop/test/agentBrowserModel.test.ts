/**
 * `view_page` without a browser: where the agent's browser may go, how a model's page names
 * resolve, what it accepts as actions, and the report it reads back.
 */
import { describe, expect, it } from "vitest";
import {
  formatPageReport,
  isLoopbackUrl,
  keyEvent,
  parseViewPageInput,
  resolvePreviewPage,
  type PageSnapshot,
} from "../src/main/agentBrowserModel.ts";
import { clipOutput, timeoutFrom } from "../src/main/aiCommands.ts";
import { decodeEntities, htmlToText, looksLikeHtml } from "../src/main/htmlText.ts";
import { pageViewCaption, planStepsFrom, planSummary } from "../src/renderer/ai/chatAgentCards.ts";

describe("where the agent's browser may go", () => {
  it("opens this machine's addresses and nothing else", () => {
    for (const url of ["http://localhost:5173/", "http://127.0.0.1:4000/about.html", "http://[::1]:3000/", "https://app.localhost/"]) {
      expect(isLoopbackUrl(url), url).toBe(true);
    }
    for (const url of ["https://example.com/", "http://192.168.1.5:3000/", "file:///etc/passwd", "http://user:pw@localhost:3000/", "javascript:alert(1)", "not a url"]) {
      expect(isLoopbackUrl(url), url).toBe(false);
    }
  });

  it("resolves every way a model names a page onto the preview's own server", () => {
    const base = "http://127.0.0.1:5500/";
    expect(resolvePreviewPage(base, "about.html")).toBe("http://127.0.0.1:5500/about.html");
    expect(resolvePreviewPage(base, "/about.html")).toBe("http://127.0.0.1:5500/about.html");
    expect(resolvePreviewPage(base, "./docs/")).toBe("http://127.0.0.1:5500/docs/");
    expect(resolvePreviewPage(base, "#pricing")).toBe("http://127.0.0.1:5500/#pricing");
    expect(resolvePreviewPage(base, "?tab=2")).toBe("http://127.0.0.1:5500/?tab=2");
    expect(resolvePreviewPage(base, "")).toBe(base);
    expect(resolvePreviewPage("http://localhost:3000/index.html", "pages\\contact.html")).toBe("http://localhost:3000/pages/contact.html");
    expect(resolvePreviewPage(base, "http://127.0.0.1:5500/blog/")).toBe("http://127.0.0.1:5500/blog/");
  });

  it("never lets a page name point somewhere else", () => {
    const base = "http://127.0.0.1:5500/";
    expect(resolvePreviewPage(base, "https://evil.example/")).toBeNull();
    expect(resolvePreviewPage(base, "//evil.example/x")).toBeNull();
    expect(resolvePreviewPage(base, "http://127.0.0.1:9999/")).toBeNull();
    expect(resolvePreviewPage(base, "javascript:alert(1)")).toBeNull();
  });
});

describe("view_page input", () => {
  it("defaults to the page already open, desktop size, with a screenshot", () => {
    expect(parseViewPageInput({})).toEqual({ target: { kind: "current" }, width: 1280, height: 800, actions: [], screenshot: true, fullPage: false });
  });

  it("takes a page of the preview or a local address, not both", () => {
    expect(parseViewPageInput({ path: "about.html" })).toMatchObject({ target: { kind: "preview", path: "about.html" } });
    expect(parseViewPageInput({ url: "http://localhost:5173/x" })).toMatchObject({ target: { kind: "url", url: "http://localhost:5173/x" } });
    expect(parseViewPageInput({ path: "a", url: "http://localhost:1/" })).toContain("not both");
    expect(parseViewPageInput({ url: "https://example.com" })).toContain("fetch_url");
  });

  it("checks the screen size and every action before anything runs", () => {
    expect(parseViewPageInput({ width: 100 })).toContain("240 to 3840");
    expect(parseViewPageInput({ actions: "click" })).toContain("list of steps");
    expect(parseViewPageInput({ actions: [{ type: "dance" }] })).toContain("click, type, press");
    expect(parseViewPageInput({ actions: [{ type: "type", selector: "#q" }] })).toContain("value to enter");
    expect(parseViewPageInput({ actions: [{ type: "press" }] })).toContain("key");
    expect(parseViewPageInput({ actions: Array.from({ length: 21 }, () => ({ type: "wait", ms: 1 })) })).toContain("at most 20");
    expect(parseViewPageInput({ actions: [{ type: "type", text: "Email", value: "a@b.c", submit: true }, { type: "press", key: "Tab" }, { type: "scroll", to: "bottom" }] }))
      .toMatchObject({ actions: [{ type: "type", text: "Email", value: "a@b.c", submit: true }, { type: "press", key: "Tab" }, { type: "scroll", to: "bottom" }] });
  });

  it("knows the keys a model names", () => {
    expect(keyEvent("Enter")).toMatchObject({ key: "Enter", keyCode: 13, text: "\r" });
    expect(keyEvent("arrow down")).toMatchObject({ key: "ArrowDown", keyCode: 40 });
    expect(keyEvent("a")).toMatchObject({ key: "a", code: "KeyA", text: "a" });
    expect(keyEvent("Hyper")).toBeNull();
  });
});

const snapshot = (overrides: Partial<PageSnapshot> = {}): PageSnapshot => ({
  url: "http://127.0.0.1:5500/",
  title: "Bakery",
  viewport: { width: 390, height: 844 },
  scroll: { width: 390, height: 2000, y: 0 },
  text: "Fresh bread\nOrder now",
  headings: ["h1: Fresh bread"],
  links: [{ text: "Menu", href: "menu.html" }],
  buttons: [{ text: "Order now", selector: "#order", disabled: false }],
  fields: [{ kind: "email", label: "Email", selector: "#email", value: "" }],
  brokenImages: [],
  imagesWithoutAlt: 0,
  overflowing: [],
  focused: null,
  ...overrides,
});

describe("the page report", () => {
  it("leads with problems, then what the page says and what can be used", () => {
    const report = formatPageReport({
      snapshot: snapshot({ brokenImages: ["img/hero.png"], overflowing: ["div.banner"], scroll: { width: 520, height: 2000, y: 0 } }),
      status: 200,
      actions: ["click \"Order now\" [#order] - done"],
      console: ["error: Uncaught TypeError: x is undefined (/app.js:3)", "log: loaded"],
      failedRequests: ["404 http://127.0.0.1:5500/img/hero.png"],
      screenshot: "attached",
      fullPage: false,
    });
    const problems = report.slice(report.indexOf("Problems:"), report.indexOf("Other console output:"));
    expect(problems).toContain("Console error: Uncaught TypeError");
    expect(problems).toContain("Request failed: 404");
    expect(problems).toContain("Broken image: img/hero.png");
    expect(problems).toContain("scrolls sideways at 390px wide (content is 520px)");
    expect(report.indexOf("Problems:")).toBeLessThan(report.indexOf("Visible text:"));
    expect(report).toContain("1. click \"Order now\"");
    expect(report).toContain("- log: loaded");
    expect(report).toContain("Order now [#order]");
    expect(report).toContain("email \"Email\" [#email]");
    expect(report).toContain("Menu -> menu.html");
    expect(report).toContain("Screenshot attached");
  });

  it("says so plainly when nothing is wrong", () => {
    const report = formatPageReport({ snapshot: snapshot(), status: 200, actions: [], console: [], failedRequests: [], screenshot: "skipped", fullPage: false });
    expect(report).toContain("- None found");
    expect(report).toContain("No screenshot was asked for.");
  });

  it("is summarised in the chat's card as the page and a problem count", () => {
    const clean = formatPageReport({ snapshot: snapshot(), status: 200, actions: [], console: [], failedRequests: [], screenshot: "attached", fullPage: false });
    expect(pageViewCaption(clean)).toEqual({ page: "Bakery", problems: 0, url: "http://127.0.0.1:5500/" });
    const broken = formatPageReport({ snapshot: snapshot(), status: 404, actions: [], console: ["error: boom"], failedRequests: [], screenshot: "attached", fullPage: false });
    expect(pageViewCaption(broken).problems).toBe(2);
  });
});

describe("plan cards", () => {
  it("read only well-formed steps", () => {
    expect(planStepsFrom({ steps: [{ step: " Add header ", status: "done" }, { step: "", status: "done" }, { step: "x", status: "maybe" }, "junk"] }))
      .toEqual([{ step: "Add header", status: "done" }]);
    expect(planStepsFrom(null)).toEqual([]);
  });

  it("summarise progress and the step under way", () => {
    expect(planSummary([{ step: "a", status: "done" }, { step: "b", status: "in_progress" }, { step: "c", status: "pending" }])).toBe("1 of 3 done · b");
    expect(planSummary([{ step: "a", status: "done" }])).toBe("All 1 steps done");
  });
});

describe("command output", () => {
  it("keeps the start and the end of long output", () => {
    const clipped = clipOutput(`START${"x".repeat(50_000)}END`, 1_000);
    expect(clipped.startsWith("START")).toBe(true);
    expect(clipped.endsWith("END")).toBe(true);
    expect(clipped).toContain("characters cut from the middle");
  });

  it("reads a timeout in seconds, within bounds", () => {
    expect(timeoutFrom(undefined)).toBe(120_000);
    expect(timeoutFrom(5)).toBe(5_000);
    expect(timeoutFrom(0)).toBeNull();
    expect(timeoutFrom(601)).toBeNull();
    expect(timeoutFrom("abc")).toBeNull();
  });
});

describe("web pages as text", () => {
  it("keeps the words, headings and links and drops the machinery", () => {
    const html = `<!doctype html><html><head><title>Docs &amp; Guides</title><style>.x{}</style><script>track()</script></head>
      <body><nav><a href="/">Home</a></nav><main><h1>Install</h1><p>Run <code>npm i</code> then&nbsp;start.</p>
      <ul><li>One</li><li>Two</li></ul><p>See <a href="/api">the API</a>.</p><pre>const a = 1;
const b = 2;</pre>${"<p>filler words for length</p>".repeat(20)}</main></body></html>`;
    const text = htmlToText(html, "https://docs.example.com/start");
    expect(text.startsWith("Docs & Guides")).toBe(true);
    expect(text).toContain("# Install");
    expect(text).toContain("Run npm i then start.");
    expect(text).toContain("- One");
    expect(text).toContain("the API (https://docs.example.com/api)");
    expect(text).toContain("const a = 1;\nconst b = 2;");
    expect(text).not.toContain("track()");
    expect(text).not.toContain("Home"); // the nav is outside <main>
  });

  it("knows an HTML page from JSON, and decodes entities", () => {
    expect(looksLikeHtml("text/html; charset=utf-8", "")).toBe(true);
    expect(looksLikeHtml(null, "  <!DOCTYPE html><p>x")).toBe(true);
    expect(looksLikeHtml("application/json", "{\"a\":1}")).toBe(false);
    expect(decodeEntities("&lt;div&gt; &#169; &#x1F600; &unknown;")).toBe("<div> © 😀 &unknown;");
  });
});
