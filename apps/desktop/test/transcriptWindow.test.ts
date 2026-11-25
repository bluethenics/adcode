import { describe, expect, it } from "vitest";
import {
  createTranscriptWindow,
  earlierBatch,
  editSlots,
  restoreStart,
  type WindowBarState,
  type WindowHost,
  type WindowNode,
} from "../src/renderer/ai/transcriptWindow.ts";

/** A transcript stand-in: an ordered list of named nodes, 10px tall each. */
class FakeHost {
  nodes: FakeNode[] = [];
  scrollTop = 0;
  get children(): FakeNode[] { return this.nodes; }
  get scrollHeight(): number { return this.nodes.length * 10; }
  insertBefore(node: FakeNode, reference: FakeNode | null): void {
    this.detach(node);
    const at = reference === null ? this.nodes.length : this.nodes.indexOf(reference);
    this.nodes.splice(at === -1 ? this.nodes.length : at, 0, node);
    node.host = this;
  }
  prepend(node: FakeNode): void { this.insertBefore(node, this.nodes[0] ?? null); }
  append(node: FakeNode): void { this.insertBefore(node, null); }
  detach(node: FakeNode): void {
    const at = this.nodes.indexOf(node);
    if (at !== -1) this.nodes.splice(at, 1);
  }
  names(): string[] { return this.nodes.map((node) => node.name); }
}

class FakeNode {
  host: FakeHost | null = null;
  readonly name: string;
  constructor(name: string) { this.name = name; }
  remove(): void { this.host?.detach(this); this.host = null; }
}

function setup(count: number, options: { max?: number; keep?: number; batch?: number; hold?: number; openAll?: () => void; protect?: (name: string) => boolean; atBottom?: boolean } = {}) {
  const host = new FakeHost();
  for (let index = 0; index < count; index += 1) host.append(new FakeNode(`n${String(index)}`));
  host.scrollTop = host.scrollHeight;
  let counted: WindowBarState | null = null;
  let barActions: { readonly show: () => void; readonly openAll: () => void } | null = null;
  const bar = new FakeNode("bar");
  const window = createTranscriptWindow(host as unknown as WindowHost, {
    protect: (node) => options.protect?.((node as unknown as FakeNode).name) ?? false,
    atBottom: () => options.atBottom ?? true,
    bar: (actions) => { barActions = actions; return { element: bar as unknown as WindowNode, paint: (state) => { counted = state; } }; },
    max: options.max ?? 10,
    keep: options.keep ?? 6,
    batch: options.batch ?? 3,
    ...(options.hold === undefined ? {} : { hold: options.hold }),
    ...(options.openAll === undefined ? {} : { openAll: options.openAll }),
  });
  return { host, window, counted: () => counted, actions: () => barActions };
}

describe("where a reopened conversation starts", () => {
  it("draws everything when it is short", () => {
    expect(restoreStart(["user", "assistant"], 5)).toBe(0);
  });

  it("draws the newest messages, starting at the person's own message", () => {
    const roles = ["user", "assistant", "user", "assistant", "assistant", "user", "assistant"];
    expect(restoreStart(roles, 3)).toBe(2);
    expect(restoreStart(roles, 2)).toBe(5);
  });

  it("finds the batch above, rounded back to a user message", () => {
    const roles = ["user", "assistant", "assistant", "user", "assistant", "user", "assistant"];
    expect(earlierBatch(roles, 5, 1)).toEqual({ from: 3, to: 5 });
    expect(earlierBatch(roles, 3, 10)).toEqual({ from: 0, to: 3 });
  });

  it("puts each edit before the first newer message, or at the end", () => {
    expect(editSlots([5, 15, 99], [10, 20, 30])).toEqual([0, 1, 3]);
  });
});

describe("the live transcript window", () => {
  it("leaves a short transcript alone", () => {
    const { host, window } = setup(8);
    window.trim();
    expect(host.nodes).toHaveLength(8);
    expect(window.hidden()).toBe(0);
  });

  it("sets the oldest elements aside past the limit and keeps the newest", () => {
    const { host, window, counted } = setup(12);
    window.trim();
    expect(host.names()).toEqual(["bar", "n6", "n7", "n8", "n9", "n10", "n11"]);
    expect(window.hidden()).toBe(6);
    expect(counted()).toEqual({ more: 6, canShowMore: true, beyond: false });
  });

  it("stops at a protected element and never moves it", () => {
    const { host, window } = setup(12, { protect: (name) => name === "n2" });
    window.trim();
    expect(host.names().slice(0, 3)).toEqual(["bar", "n2", "n3"]);
    expect(window.hidden()).toBe(2);
  });

  it("does not trim while the person reads further up", () => {
    const { host, window } = setup(12, { atBottom: false });
    window.trim();
    expect(host.nodes).toHaveLength(12);
  });

  it("brings set-aside elements back in order, a batch at a time, and keeps the view anchored", () => {
    const { host, window } = setup(12);
    window.trim();
    host.scrollTop = 30;
    const fromBottom = host.scrollHeight - host.scrollTop;
    window.showEarlier();
    expect(host.names()).toEqual(["bar", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10", "n11"]);
    expect(host.scrollHeight - host.scrollTop).toBe(fromBottom);
    window.showEarlier();
    expect(host.names()[0]).toBe("n0");
    expect(window.hidden()).toBe(0);
  });

  it("draws a reopened conversation's older messages on request and moves them above", () => {
    const { host, window, counted } = setup(4);
    let undrawn = 5;
    window.setUndrawn(5, (count) => {
      const drawn = Math.min(count, undrawn);
      const nodes = Array.from({ length: drawn }, (_, index) => new FakeNode(`old${String(undrawn - drawn + index)}`));
      for (const node of nodes) host.append(node);
      undrawn -= drawn;
      return { nodes: nodes as unknown as WindowNode[], drawn };
    });
    expect(counted()).toEqual({ more: 5, canShowMore: true, beyond: false });
    window.showEarlier();
    expect(host.names()).toEqual(["bar", "old2", "old3", "old4", "n0", "n1", "n2", "n3"]);
    window.showEarlier();
    expect(host.names()).toEqual(["old0", "old1", "old2", "old3", "old4", "n0", "n1", "n2", "n3"]);
    expect(window.hidden()).toBe(0);
  });

  it("forgets everything when another chat opens", () => {
    const { host, window } = setup(12);
    window.trim();
    window.reset();
    expect(window.hidden()).toBe(0);
    expect(host.names()).not.toContain("bar");
  });
});

describe("holding at most so much of a day-long chat", () => {
  it("lets go of the oldest set-aside elements past the limit and offers the whole conversation", () => {
    const opened: string[] = [];
    const { host, window, counted, actions } = setup(30, { max: 10, keep: 6, hold: 12, openAll: () => opened.push("all") });
    window.trim();
    expect(host.nodes).toHaveLength(7);
    // 6 on screen and 6 set aside: the 18 oldest were let go.
    expect(window.hidden()).toBe(6);
    expect(counted()).toEqual({ more: 6, canShowMore: true, beyond: true });
    actions()?.openAll();
    expect(opened).toEqual(["all"]);
  });

  it("stops drawing older messages at the limit and offers the whole conversation instead", () => {
    const { host, window, counted } = setup(4, { batch: 3, hold: 8, openAll: () => undefined });
    let undrawn = 10;
    window.setUndrawn(10, (count) => {
      const drawn = Math.min(count, undrawn);
      const nodes = Array.from({ length: drawn }, (_, index) => new FakeNode(`old${String(undrawn - drawn + index)}`));
      for (const node of nodes) host.append(node);
      undrawn -= drawn;
      return { nodes: nodes as unknown as WindowNode[], drawn };
    });
    window.showEarlier();
    window.showEarlier();
    expect(undrawn).toBe(4);
    window.showEarlier();
    expect(undrawn).toBe(4);
    expect(counted()).toEqual({ more: 0, canShowMore: false, beyond: true });
  });

  it("keeps everything when there is no whole conversation to offer", () => {
    const { window } = setup(30, { max: 10, keep: 6, hold: 12 });
    window.trim();
    expect(window.hidden()).toBe(24);
  });
});
