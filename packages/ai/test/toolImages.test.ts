/**
 * Pictures from tools: a screenshot of the running app, an image file the model asked for.
 * They reach the model after the step that took them, labelled, and only that once - and a
 * model that cannot read images gets the text report instead of a failed turn.
 */
import { describe, expect, it } from "vitest";
import { createAgent, isImageUnsupported, retireToolImages, stripImages } from "../src/agent.ts";
import type { AgentEvent, ImageBlock, Message, Provider, ProviderEvent, ProviderRequest, ToolDefinition } from "../src/types.ts";

const shot: ImageBlock = { type: "image", mediaType: "image/jpeg", data: "AAAA" };

const lookTool: ToolDefinition = {
  name: "view_page",
  description: "Look at a page",
  inputSchema: { type: "object", properties: {} },
  mutating: false,
};

/** Replays turns and keeps every request it was sent; a turn may throw instead. */
function recordingProvider(turns: (ProviderEvent[] | Error)[]): Provider & { requests: ProviderRequest[] } {
  let index = 0;
  const requests: ProviderRequest[] = [];
  return {
    id: "anthropic",
    displayName: "Recording",
    models: ["m"],
    requests,
    async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      requests.push(JSON.parse(JSON.stringify(request)) as ProviderRequest);
      const turn = turns[index++] ?? [{ kind: "stop", reason: "end-turn" }];
      if (turn instanceof Error) throw turn;
      for (const event of turn) yield event;
    },
  };
}

const look = (id: string): ProviderEvent[] => [
  { kind: "tool-call", call: { type: "tool-call", id, name: "view_page", input: {} } },
  { kind: "stop", reason: "tool-use" },
];

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const imagesIn = (message: Message | undefined): number => message?.content.filter((block) => block.type === "image").length ?? 0;

describe("pictures a tool returns", () => {
  it("follow the tool results, labelled, and are shown to the conversation", async () => {
    const provider = recordingProvider([look("look-1"), [{ kind: "text", text: "Looks right." }, { kind: "stop", reason: "end-turn" }]]);
    const agent = createAgent({
      provider,
      model: "m",
      tools: [lookTool],
      runner: { run: async () => ({ content: "report", isError: false, images: [shot] }) },
    });
    const events = await collect(agent.send("check the page"));

    const results = provider.requests[1]!.messages.at(-1)!;
    expect(results.content.map((block) => block.type)).toEqual(["tool-result", "text", "image"]);
    expect(results.content[1]).toEqual({ type: "text", text: "Picture from view_page (look-1):" });
    const event = events.find((item) => item.kind === "tool-result");
    expect(event).toMatchObject({ kind: "tool-result", images: [shot] });
  });

  it("only ride along with the step that took them", async () => {
    const provider = recordingProvider([look("look-1"), look("look-2"), [{ kind: "stop", reason: "end-turn" }]]);
    const agent = createAgent({
      provider,
      model: "m",
      tools: [lookTool],
      runner: { run: async () => ({ content: "report", isError: false, images: [shot] }) },
    });
    await collect(agent.send("check twice"));

    const third = provider.requests[2]!.messages;
    expect(third.map(imagesIn)).toEqual([0, 0, 0, 0, 1]);
    expect(JSON.stringify(third[2])).toContain("Call that tool again to see the current state");
  });

  it("are described in words when the model cannot read images, and the turn carries on", async () => {
    const provider = recordingProvider([
      look("look-1"),
      new Error("Invalid content type. image_url is only supported by certain models."),
      [{ kind: "text", text: "Read the report instead." }, { kind: "stop", reason: "end-turn" }],
      look("look-2"),
      [{ kind: "stop", reason: "end-turn" }],
    ]);
    const agent = createAgent({
      provider,
      model: "m",
      tools: [lookTool],
      runner: { run: async () => ({ content: "report", isError: false, images: [shot] }) },
    });
    const events = await collect(agent.send("check"));

    expect(events.map((event) => event.kind)).toContain("turn-end");
    expect(events).toContainEqual({ kind: "status", text: "This model cannot read images - carrying on with the text alone" });
    expect(provider.requests[2]!.messages.map(imagesIn)).toEqual([0, 0, 0]);
    expect(JSON.stringify(provider.requests[2]!.messages)).toContain("this model cannot read images");

    // Later pictures are not sent at all.
    await collect(agent.send("check again"));
    const later = provider.requests.at(-1)!.messages;
    expect(later.map(imagesIn).every((count) => count === 0)).toBe(true);
    expect(JSON.stringify(later.at(-1))).toContain("the picture was left out");
  });

  it("do not trigger the image fallback for an unrelated failure", async () => {
    const provider = recordingProvider([look("look-1"), new Error("HTTP 500 server exploded")]);
    const agent = createAgent({
      provider,
      model: "m",
      tools: [lookTool],
      runner: { run: async () => ({ content: "report", isError: false, images: [shot] }) },
    });
    const events = await collect(agent.send("check"));
    expect(events.at(-1)).toEqual({ kind: "error", detail: "HTTP 500 server exploded" });
  });
});

describe("image helpers", () => {
  it("recognises each provider's way of refusing an image", () => {
    for (const detail of [
      "Invalid content type. image_url is only supported by certain models.",
      "unknown variant `image_url`, expected `text`",
      "messages[3].content must be a string",
      "No endpoints found that support image input",
      "this model does not support images",
      "Image input is not supported for this model",
    ]) expect(isImageUnsupported(detail), detail).toBe(true);
    expect(isImageUnsupported("Rate limit reached for requests")).toBe(false);
    expect(isImageUnsupported("HTTP 401 Unauthorized")).toBe(false);
  });

  it("retires tool pictures but keeps the ones a person attached", () => {
    const messages: Message[] = [
      { role: "user", content: [shot, { type: "text", text: "make it look like this" }] },
      { role: "user", content: [{ type: "tool-result", toolCallId: "a", content: "r", isError: false }, shot] },
    ];
    retireToolImages(messages);
    expect(imagesIn(messages[0])).toBe(1);
    expect(imagesIn(messages[1])).toBe(0);
  });

  it("strips every picture, and says whether there was one", () => {
    const messages: Message[] = [{ role: "user", content: [shot] }];
    expect(stripImages(messages)).toBe(true);
    expect(stripImages(messages)).toBe(false);
  });
});
