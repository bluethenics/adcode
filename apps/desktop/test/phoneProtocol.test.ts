import { describe, expect, it } from "vitest";
import {
  MAX_PHONE_TEXT,
  applyPhoneEvent,
  describeUserAgent,
  parsePhoneRequest,
  phoneEventFor,
  phoneMessages,
  timelineFromChat,
  toolLabel,
  withUserMessage,
} from "../src/shared/phoneProtocol.ts";
import { parseBlocks, parseInline } from "../src/phone/markdown.ts";

describe("phone link protocol", () => {
  it("accepts only the requests a phone may make", () => {
    expect(parsePhoneRequest('{"t":"hello"}')).toEqual({ t: "hello" });
    expect(parsePhoneRequest({ t: "send", text: "  fix it  ", sessionId: null, nonce: "abc123" })).toEqual({ t: "send", text: "fix it", sessionId: null, nonce: "abc123" });
    expect(parsePhoneRequest({ t: "open", sessionId: "s1729_abc" })).toEqual({ t: "open", sessionId: "s1729_abc" });
    expect(parsePhoneRequest({ t: "power", action: "shutdown" })).toEqual({ t: "power", action: "shutdown", repeat: "once" });
  });

  it("refuses everything else", () => {
    expect(parsePhoneRequest("not json")).toBeNull();
    expect(parsePhoneRequest({ t: "terminal", command: "rm -rf /" })).toBeNull();
    expect(parsePhoneRequest({ t: "open", sessionId: "../../etc/passwd" })).toBeNull();
    expect(parsePhoneRequest({ t: "send", text: "   ", sessionId: null, nonce: "a" })).toBeNull();
    expect(parsePhoneRequest({ t: "send", text: "x".repeat(MAX_PHONE_TEXT + 1), sessionId: null, nonce: "a" })).toBeNull();
    expect(parsePhoneRequest({ t: "send", text: "hi", sessionId: null, nonce: "<script>" })).toBeNull();
    expect(parsePhoneRequest({ t: "power", action: "reboot" })).toBeNull();
    expect(parsePhoneRequest([1, 2])).toBeNull();
  });

  it("forwards what a phone can show, and nothing it cannot", () => {
    expect(phoneEventFor({ kind: "text", text: "Hi" })).toEqual({ k: "text", text: "Hi" });
    expect(phoneEventFor({ kind: "tool-call", call: { name: "write_file", input: { path: "src/app/page.tsx" } } })).toEqual({ k: "tool", label: "Editing page.tsx" });
    expect(phoneEventFor({ kind: "tool-call", call: { name: "ask_user", input: {} } })).toEqual({ k: "question" });
    expect(phoneEventFor({ kind: "run-ended", ended: "finished" })).toEqual({ k: "ended", ended: "finished" });
    expect(phoneEventFor({ kind: "tool-draft", append: "secret code" })).toBeNull();
    expect(phoneEventFor({ kind: "usage", input: 10 })).toBeNull();
    expect(toolLabel("run_command", { command: "npm test" })).toBe("Running npm test");
    expect(toolLabel("grep_search", {})).toBe("Searching the project");
  });

  it("joins a streamed reply into one bubble and closes it when a tool runs", () => {
    let timeline = withUserMessage(timelineFromChat([], false, []), "Make it blue");
    timeline = applyPhoneEvent(timeline, { k: "text", text: "On " });
    timeline = applyPhoneEvent(timeline, { k: "text", text: "it." });
    expect(timeline.items.at(-1)).toEqual({ kind: "assistant", text: "On it.", open: true });
    timeline = applyPhoneEvent(timeline, { k: "tool", label: "Editing a.css" });
    timeline = applyPhoneEvent(timeline, { k: "tool", label: "Editing a.css" });
    expect(timeline.items.filter((item) => item.kind === "tool")).toHaveLength(1);
    expect(timeline.items[1]).toEqual({ kind: "assistant", text: "On it." });
    timeline = applyPhoneEvent(timeline, { k: "ended", ended: "finished" });
    expect(timeline.running).toBe(false);
  });

  it("sends at most the recent part of a long conversation", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", text: `m${i}`, at: i }));
    const sent = phoneMessages([...many, { role: "system", text: "hidden", at: 1 }]);
    expect(sent).toHaveLength(60);
    expect(sent.at(-1)?.text).toBe("m99");
    expect(phoneMessages([{ role: "user", text: "x".repeat(7000), at: 0 }])[0]!.text.length).toBe(6001);
  });

  it("names the phone from its browser", () => {
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("iPhone · Safari");
    expect(describeUserAgent("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36")).toBe("Android phone · Chrome");
  });
});

describe("phone markdown", () => {
  it("splits fences, lists, headings and paragraphs, keeping an unfinished fence open", () => {
    expect(parseBlocks("# Title\nSome text\n\n- a\n- b\n\n```ts\nconst x = 1;\n```")).toEqual([
      { kind: "heading", text: "Title" },
      { kind: "paragraph", text: "Some text" },
      { kind: "list", ordered: false, items: ["a", "b"] },
      { kind: "code", lang: "ts", text: "const x = 1;" },
    ]);
    expect(parseBlocks("```\nstill streaming")).toEqual([{ kind: "code", lang: "", text: "still streaming" }]);
  });

  it("links only https addresses", () => {
    expect(parseInline("see [docs](https://a.dev/x) and [bad](javascript:alert(1))")).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", text: "docs", href: "https://a.dev/x" },
      { kind: "text", text: " and [bad](javascript:alert(1))" },
    ]);
    expect(parseInline("**bold** and `code`")).toEqual([{ kind: "strong", text: "bold" }, { kind: "text", text: " and " }, { kind: "code", text: "code" }]);
  });
});

describe("the pairing link in the QR code", () => {
  const id = "0f8e2c1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
  it("points the phone page at one computer, and still fits a small QR code", async () => {
    const { phonePairUrl, pairedComputerFrom } = await import("../src/shared/phoneProtocol.ts");
    const { encodeQr } = await import("../src/shared/qrCode.ts");
    const url = phonePairUrl("https://web.bluethenics.com/phone/", id);
    expect(url).toBe(`https://web.bluethenics.com/phone/?pc=${id}`);
    expect(pairedComputerFrom(new URL(url).search)).toBe(id);
    expect(encodeQr(url)).not.toBeNull();
  });

  it("falls back to the plain page, and ignores anything that is not a computer id", async () => {
    const { phonePairUrl, pairedComputerFrom } = await import("../src/shared/phoneProtocol.ts");
    expect(phonePairUrl("https://web.bluethenics.com/phone/", null)).toBe("https://web.bluethenics.com/phone/");
    expect(phonePairUrl("https://web.bluethenics.com/phone/", "../../x")).toBe("https://web.bluethenics.com/phone/");
    expect(pairedComputerFrom("?pc=<script>")).toBeNull();
    expect(pairedComputerFrom("")).toBeNull();
  });
});

describe("switching the model from the phone", () => {
  const model = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id.toUpperCase(), toolCall: true, reasoning: false, ...extra });
  const provider = (id: string, models: ReturnType<typeof model>[], extra: Record<string, unknown> = {}) => ({
    id, displayName: `${id} (on this computer)`, models, hasKey: true, needsKey: true, transport: "native", doc: null, ...extra,
  });
  const status = (providers: unknown[], activeProvider: string, activeModel: string) => ({
    providers, activeProvider, activeModel, ready: true, customBaseUrl: "", catalogueTakenOn: "", catalogueIsLive: false,
  }) as never;

  it("offers only providers that would answer, the one in use first, with the model in use always listed", async () => {
    const { phoneModelChoices, MAX_PHONE_MODELS_PER_PROVIDER } = await import("../src/shared/phoneProtocol.ts");
    const many = Array.from({ length: 30 }, (_, i) => model(`m${i}`));
    const choices = phoneModelChoices(status([
      provider("openai", [model("gpt", { recommended: true })]),
      provider("nokey", [model("x")], { hasKey: false }),
      provider("dead", [model("y")], { transport: "unsupported" }),
      provider("anthropic", many),
    ], "anthropic", "custom-model"));
    expect(choices.current).toEqual({ provider: "anthropic", model: "custom-model" });
    expect(choices.models[0]).toMatchObject({ provider: "anthropic", id: "custom-model", providerName: "anthropic" });
    expect(choices.models.filter((one) => one.provider === "anthropic")).toHaveLength(MAX_PHONE_MODELS_PER_PROVIDER + 1);
    expect(choices.models.some((one) => one.provider === "nokey" || one.provider === "dead")).toBe(false);
    expect(choices.models.find((one) => one.id === "gpt")?.note).toBe("Recommended");
  });

  it("accepts only a model the computer offered, and refuses malformed requests", async () => {
    const { isOfferedModel, parsePhoneRequest, phoneModelChoices } = await import("../src/shared/phoneProtocol.ts");
    const choices = phoneModelChoices(status([provider("openai", [model("gpt")])], "openai", "gpt"));
    expect(isOfferedModel(choices, "openai", "gpt")).toBe(true);
    expect(isOfferedModel(choices, "openai", "gpt-secret")).toBe(false);
    expect(parsePhoneRequest({ t: "models" })).toEqual({ t: "models" });
    expect(parsePhoneRequest({ t: "model", provider: "openai", model: "gpt" })).toEqual({ t: "model", provider: "openai", model: "gpt" });
    expect(parsePhoneRequest({ t: "model", provider: "../x", model: "gpt" })).toBeNull();
    expect(parsePhoneRequest({ t: "model", provider: "openai", model: "" })).toBeNull();
    expect(parsePhoneRequest({ t: "model", provider: "openai", model: "a\nb" })).toBeNull();
  });
});
