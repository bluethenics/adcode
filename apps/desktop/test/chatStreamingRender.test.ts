import { describe, expect, it } from "vitest";
import { renderChatBlocksHtml, renderChatMessageHtml, stableChatBoundary } from "../src/renderer/ai/chatMarkdown.ts";

/*
 * A streaming answer is drawn in two parts: its finished blocks, drawn once and kept, and the
 * unfinished tail, redrawn each frame. Nothing re-renders the whole answer when it ends, so the
 * two parts must always add up to exactly what rendering the whole text gives.
 */

const ANSWERS = [
  "Here is the plan.\n\n1. Read the file\n2. Change it\n\nDone.",
  "Intro paragraph with **bold** and `code`.\n\n```ts\nconst a = 1;\n\n\nconst b = 2;\n```\n\nAfter the fence.\n\n\n\nFour newlines above.",
  "Opening.\n```js\nno blank line before this fence\n```\nRight after.\n\nLast.",
  "| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two\n\n> quoted\n\nSee [the file](src/app.ts:12) and https://example.com",
  "```buttons\n[Open](https://example.com)\n```\n\n```mockup\n<div>hi</div>\n```\n\nText ``` with an inline fence\nand more\n\nEnd ```",
  "\n\nLeading blank lines\n\n\n\n```\nfence with no language\n\n```\n\n",
  "Unclosed fence at the end:\n\n```python\nprint('x')\n\nprint('y')",
  "Nested-looking ````md\n```inner```\n````\n\nafter",
  "Heading line\n## Title\n\nPara *emphasis* 2 * 3 * 4.\n\n- [x] task\n- [ ] other",
];

/** A seeded generator, so a failure is reproducible. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

function chunks(text: string, next: () => number): string[] {
  const out: string[] = [];
  let at = 0;
  while (at < text.length) {
    const size = 1 + Math.floor(next() * 12);
    out.push(text.slice(at, at + size));
    at += size;
  }
  return out;
}

describe("drawing a streaming answer a block at a time", () => {
  it("adds up to exactly the whole answer's HTML at every point of every stream", () => {
    for (const [index, answer] of ANSWERS.entries()) {
      for (let seed = 1; seed <= 25; seed += 1) {
        const next = random(seed * 97 + index);
        let text = "";
        let previous = 0;
        let settledHtml = "";
        for (const chunk of chunks(answer, next)) {
          text += chunk;
          const boundary = stableChatBoundary(text);
          // Settled blocks are only ever added to, never redrawn.
          expect(boundary).toBeGreaterThanOrEqual(previous);
          settledHtml += renderChatBlocksHtml(text.slice(previous, boundary));
          previous = boundary;
          const drawn = settledHtml + renderChatBlocksHtml(text.slice(boundary));
          expect(drawn || renderChatMessageHtml("")).toBe(renderChatMessageHtml(text));
        }
      }
    }
  });

  it("settles a paragraph once the blank line after it is followed by more", () => {
    expect(stableChatBoundary("One")).toBe(0);
    expect(stableChatBoundary("One\n\n")).toBe(0);
    expect(stableChatBoundary("One\n\nT")).toBe(5);
    expect(stableChatBoundary("One\n\n\n\nT")).toBe(7);
  });

  it("never settles inside an open code fence", () => {
    const open = "Before\n\n```ts\nconst a = 1;\n\nconst b = 2;";
    expect(stableChatBoundary(open)).toBe("Before\n\n".length);
    const closed = `${open}\n\`\`\`\n\nAfter`;
    expect(stableChatBoundary(closed)).toBe(closed.length - "After".length);
  });
});
