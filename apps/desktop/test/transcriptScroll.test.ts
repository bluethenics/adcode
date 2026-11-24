import { describe, expect, it } from "vitest";
import { jumpToBottom, type ScrollTarget } from "../src/renderer/ai/transcriptScroll.ts";

/** A transcript that records the scroll behaviour in force when it was scrolled. */
function transcript(scrollHeight: number): ScrollTarget & { readonly scrolledWith: string[] } {
  const style = { scrollBehavior: "" };
  const scrolledWith: string[] = [];
  let top = 0;
  return {
    scrollHeight,
    style,
    scrolledWith,
    get scrollTop() { return top; },
    set scrollTop(value: number) { scrolledWith.push(style.scrollBehavior); top = value; },
  };
}

describe("opening a chat at its newest message", () => {
  it("jumps to the bottom with smooth scrolling off for that one scroll", () => {
    const element = transcript(48_000);
    jumpToBottom(element);
    expect(element.scrollTop).toBe(48_000);
    // "auto" when it moved: no glide past every message from the first prompt down.
    expect(element.scrolledWith).toEqual(["auto"]);
  });

  it("leaves the stylesheet's smoothness in place for replies and Jump to latest", () => {
    const element = transcript(900);
    element.style.scrollBehavior = "";
    jumpToBottom(element);
    expect(element.style.scrollBehavior).toBe("");
    element.style.scrollBehavior = "smooth";
    jumpToBottom(element);
    expect(element.style.scrollBehavior).toBe("smooth");
  });
});
