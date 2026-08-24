import { describe, expect, it } from "vitest";
import {
  handleDraftRelease,
  handleListReleases,
  handleSaveRelease,
  parseRelease,
} from "../src/admin.ts";
import { createMemoryStore } from "../src/memoryStore.ts";

const deps = () => {
  let now = 1_000;
  return {
    store: createMemoryStore(),
    clock: { now: () => (now += 1) },
  };
};

const input = (over: Record<string, unknown> = {}) => ({
  version: "1.2.0",
  title: "Faster search",
  body: "## What changed\n\nSearch is quicker.",
  highlights: ["Search is quicker"],
  announce: true,
  critical: false,
  status: "published" as const,
  ...over,
});

describe("parseRelease", () => {
  it("reads a well-formed release", () => {
    const read = parseRelease(input());
    expect(read?.version).toBe("1.2.0");
    expect(read?.announce).toBe(true);
  });

  /*
   * The safe default for "interrupt everybody" is no. A malformed body must not be able to
   * turn a silent patch into a popup for every user.
   */
  it("defaults the interrupting fields to false", () => {
    const read = parseRelease({ version: "1.0.0", title: "x", body: "" });
    expect(read?.announce).toBe(false);
    expect(read?.critical).toBe(false);
  });

  it("defaults to a draft", () => {
    expect(parseRelease({ version: "1.0.0", title: "x", body: "" })?.status).toBe("draft");
  });

  it("refuses a version that is not one", () => {
    // It becomes a document id and a key in the client's dismissed-versions file.
    expect(parseRelease(input({ version: "../../etc/passwd" }))).toBeNull();
    expect(parseRelease(input({ version: "" }))).toBeNull();
    expect(parseRelease(input({ version: "x".repeat(64) }))).toBeNull();
  });

  it("refuses a missing title", () => {
    expect(parseRelease(input({ title: "" }))).toBeNull();
    expect(parseRelease(input({ title: 7 }))).toBeNull();
  });

  it("caps the highlights", () => {
    const many = parseRelease(input({ highlights: Array.from({ length: 20 }, (_, i) => `h${String(i)}`) }));
    expect(many?.highlights.length).toBeLessThanOrEqual(6);
  });

  it("drops highlights that are not strings", () => {
    expect(parseRelease(input({ highlights: ["ok", 3, null] }))?.highlights).toEqual(["ok"]);
  });

  it("survives nonsense", () => {
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease("no")).toBeNull();
  });
});

describe("handleSaveRelease", () => {
  it("stores a release and lists it", async () => {
    const d = deps();
    await handleSaveRelease(d, "admin-1", input());

    const all = await handleListReleases(d, "admin-1");
    expect(all.map((one) => one.version)).toEqual(["1.2.0"]);
  });

  /*
   * A release's date is when it shipped, not the last time somebody fixed a typo in the
   * note - so re-saving a published release keeps the original date.
   */
  it("keeps the original publication date when re-saved", async () => {
    const d = deps();
    const first = await handleSaveRelease(d, "admin-1", input());
    const second = await handleSaveRelease(d, "admin-1", input({ title: "Fixed typo" }));

    expect(second.publishedAt).toBe(first.publishedAt);
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
  });

  it("does not stamp a date on a draft", async () => {
    const d = deps();
    const draft = await handleSaveRelease(d, "admin-1", input({ status: "draft" }));
    expect(draft.publishedAt).toBeNull();
  });

  it("keeps the first author when someone else edits it", async () => {
    const d = deps();
    await handleSaveRelease(d, "admin-1", input());
    const edited = await handleSaveRelease(d, "admin-2", input({ title: "Edited" }));
    expect(edited.authorUid).toBe("admin-1");
  });

  it("writes an audit row", async () => {
    const d = deps();
    await handleSaveRelease(d, "admin-1", input());
    const audit = await d.store.listAudit();
    expect(audit.some((row) => row.action.includes("release:published:1.2.0"))).toBe(true);
  });

  it("keeps drafts out of the published list", async () => {
    const d = deps();
    await handleSaveRelease(d, "admin-1", input({ status: "draft" }));
    expect(await d.store.listReleases({ publishedOnly: true })).toEqual([]);
  });
});

describe("handleDraftRelease", () => {
  /*
   * The rule the whole agent path exists to enforce: a note written by a tool reaches
   * nobody until a person publishes it. An AI-written note that went straight to every
   * user could not be unsaid.
   */
  it("is always a draft, even when asked to publish", async () => {
    const d = deps();
    const written = await handleDraftRelease(d, input({ status: "published" }));

    expect(written.status).toBe("draft");
    expect(await d.store.listReleases({ publishedOnly: true })).toEqual([]);
  });

  it("marks it as written by an agent", async () => {
    const d = deps();
    expect((await handleDraftRelease(d, input())).authoredBy).toBe("agent");
  });

  it("keeps the agent marking after a human edits it", async () => {
    // So the admin list can go on saying where the words came from.
    const d = deps();
    await handleDraftRelease(d, input());
    const edited = await handleSaveRelease(d, "admin-1", input({ title: "Reworded" }));
    expect(edited.authoredBy).toBe("agent");
  });
});
