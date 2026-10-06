import { describe, expect, it } from "vitest";
import { createChatQueue } from "../src/renderer/ai/chatQueue.ts";

/**
 * Follow-ups typed while the assistant works.
 *
 * Enter used to stop the running turn whenever anything was typed, so a follow-up written
 * mid-build - "and make it dark" - cancelled the build it was about. Claude Code and Cursor
 * queue it instead; so does ADCode now. These are the queue's rules.
 */
describe("the chat queue", () => {
  it("sends what was queued in the order it was typed", () => {
    const queue = createChatQueue<string>();
    queue.add("first", []);
    queue.add("second", ["shot.png"]);

    expect(queue.next()).toMatchObject({ text: "first", attachments: [] });
    expect(queue.next()).toMatchObject({ text: "second", attachments: ["shot.png"] });
    expect(queue.next()).toBeUndefined();
  });

  it("ignores an empty message with nothing attached", () => {
    const queue = createChatQueue<string>();
    expect(queue.add("   ", [])).toBeNull();
    expect(queue.items()).toEqual([]);
  });

  it("removes one queued message, leaving the rest in order", () => {
    const queue = createChatQueue<string>();
    const a = queue.add("a", [])!;
    queue.add("b", []);
    queue.add("c", []);

    queue.remove(a.id);

    expect(queue.items().map((item) => item.text)).toEqual(["b", "c"]);
  });

  it("takes one message out of turn, for Send now", () => {
    const queue = createChatQueue<string>();
    queue.add("a", []);
    const b = queue.add("b", [])!;

    expect(queue.take(b.id)?.text).toBe("b");
    expect(queue.items().map((item) => item.text)).toEqual(["a"]);
    expect(queue.take(b.id)).toBeUndefined();
  });

  it("tells its listeners whenever it changes", () => {
    const queue = createChatQueue<string>();
    const sizes: number[] = [];
    queue.onChange((items) => sizes.push(items.length));

    const a = queue.add("a", [])!;
    queue.add("b", []);
    queue.remove(a.id);
    queue.next();
    queue.clear();

    expect(sizes).toEqual([1, 2, 1, 0, 0]);
  });

  it("keeps no more than ten waiting messages", () => {
    const queue = createChatQueue<string>();
    for (let index = 0; index < 12; index++) queue.add(`m${String(index)}`, []);
    expect(queue.items()).toHaveLength(10);
    expect(queue.items()[0]?.text).toBe("m0");
  });
});
