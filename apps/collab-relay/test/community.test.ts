import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(protected ctx: unknown, protected env: unknown) {}
  },
}));

import { ArtifactVault, CommunityHub, communityRoute } from "../src/community.ts";
import { ArtifactRoom } from "../src/artifactRoom.ts";
import { blankManifest, decodeArtifactShare, diffSnapshots, type ArtifactFile } from "../../../packages/community/src/index.ts";

/** A Durable Object's SQL storage, backed by a real in-memory SQLite database. */
function state() {
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec(query: string, ...args: unknown[]) {
      const statement = db.prepare(query);
      const rows = /^\s*SELECT/i.test(query) ? statement.all(...(args as never[])).map((row) => ({ ...row })) : (statement.run(...(args as never[])), []);
      return { toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error(`Expected one row, got ${rows.length}`); return rows[0]; } };
    },
  };
  const transactionSync = <T>(run: () => T): T => {
    db.exec("SAVEPOINT tx");
    try { const result = run(); db.exec("RELEASE tx"); return result; } catch (error) { db.exec("ROLLBACK TO tx"); db.exec("RELEASE tx"); throw error; }
  };
  return { storage: { sql, transactionSync, deleteAll: async () => {} } };
}

/** The hub, wrapped so calls fail the way RPC makes them fail: the message carries the status. */
function world() {
  const vaults = new Map<string, ArtifactVault>();
  const env = {} as Record<string, unknown>;
  env["ARTIFACT_VAULTS"] = { getByName: (id: string) => { if (!vaults.has(id)) vaults.set(id, new ArtifactVault(state() as never, env as never)); return vaults.get(id)!; } };
  const rooms = new Map<string, ArtifactRoom>();
  env["ARTIFACT_ROOMS"] = { getByName: (id: string) => { if (!rooms.has(id)) rooms.set(id, new ArtifactRoom(state() as never, env as never)); return rooms.get(id)!; } };
  const hub = new CommunityHub(state() as never, env as never);
  env["COMMUNITY"] = { getByName: () => hub };
  return { hub, env };
}

const files: ArtifactFile[] = [
  { path: "README.md", content: "# Todo app\nA tiny todo list." },
  { path: "index.html", content: "<h1>Todos</h1>\n<ul id=list></ul>" },
  { path: "app.js", content: "const items = [];\nfunction add(item) { items.push(item); }" },
];

const plugin = (patch: Record<string, unknown> = {}) => ({ ...blankManifest("Explain simply"), ...patch });

let ctx: ReturnType<typeof world>;
beforeEach(() => { ctx = world(); });

describe("plugins", () => {
  it("publishes, lists, installs once per person and tells the creator", () => {
    const published = ctx.hub.publishPlugin("ana", "Ana", plugin(), "First release");
    expect(published).toMatchObject({ id: "explain-simply", version: "1.0.0", installs: 0, contributes: "1 AI action" });
    expect(ctx.hub.listPlugins("trending", "explain", null, 10, 0).map((one) => one.id)).toEqual(["explain-simply"]);
    expect(ctx.hub.listPlugins("trending", "nothing-like-this", null, 10, 0)).toEqual([]);

    expect(ctx.hub.install("ben", "explain-simply").id).toBe("explain-simply");
    ctx.hub.install("ben", "explain-simply");
    expect(ctx.hub.plugin("explain-simply", "ben")).toMatchObject({ installs: 1, installed: true });
    expect(ctx.hub.me("ana").activity.map((item) => item.kind)).toContain("plugin.installed");
  });

  it("protects an id and requires a newer version for updates, and notifies people who installed it", () => {
    ctx.hub.publishPlugin("ana", "Ana", plugin(), "");
    ctx.hub.install("ben", "explain-simply");
    expect(() => ctx.hub.publishPlugin("eve", "Eve", plugin({ version: "2.0.0" }), "")).toThrow(/\[409\].*another creator/);
    expect(() => ctx.hub.publishPlugin("ana", "Ana", plugin(), "")).toThrow(/\[409\].*not newer/);
    ctx.hub.publishPlugin("ana", "Ana", plugin({ version: "1.1.0" }), "Faster");
    expect(ctx.hub.me("ben").activity[0]).toMatchObject({ kind: "plugin.updated" });
    expect(ctx.hub.updates({ "explain-simply": "1.0.0", "missing-one": "1.0.0" })).toEqual({ "explain-simply": "1.1.0" });
  });

  it("refuses an invalid manifest with the validator's words", () => {
    expect(() => ctx.hub.publishPlugin("ana", "Ana", { id: "x" }, "")).toThrow(/\[400\]/);
    expect(() => ctx.hub.publishPlugin("ana", "Ana", plugin({ contributes: { settings: { "adcode.ads.enabled": false } } }), "")).toThrow(/stays in your hands/);
  });

  it("counts a remix for the original's creator", () => {
    ctx.hub.publishPlugin("ana", "Ana", plugin(), "");
    ctx.hub.publishPlugin("ben", "Ben", plugin({ id: "explain-simpler", remixOf: "plugin:explain-simply" }), "");
    expect(ctx.hub.plugin("explain-simply", null).remixes).toBe(1);
    expect(ctx.hub.me("ana").activity.map((item) => item.kind)).toContain("plugin.remixed");
  });

  it("stars toggle and hide after five reports", () => {
    ctx.hub.publishPlugin("ana", "Ana", plugin(), "");
    expect(ctx.hub.star("ben", "plugin", "explain-simply", true)).toEqual({ stars: 1, starred: true });
    expect(ctx.hub.star("ben", "plugin", "explain-simply", true).stars).toBe(1);
    expect(ctx.hub.star("ben", "plugin", "explain-simply", false).stars).toBe(0);
    for (const who of ["a", "b", "c", "d", "e"]) ctx.hub.report(who, "plugin", "explain-simply", "Spam listing");
    expect(() => ctx.hub.plugin("explain-simply", null)).toThrow(/\[404\]/);
  });
});

describe("artifacts and improvements", () => {
  it("runs the whole loop: publish, remix, improve, accept, credit", async () => {
    const artifact = await ctx.hub.publishArtifact("ana", { title: "Todo app", description: "A tiny todo list to learn with.", helpWanted: "Add a delete button", tags: ["beginner"], files, ownerName: "Ana" });
    expect(artifact).toMatchObject({ version: 1, fileCount: 3, readme: "# Todo app\nA tiny todo list." });
    expect(ctx.hub.listArtifacts("new", null, true, 10, 0).map((one) => one.id)).toEqual([artifact.id]);

    const remix = await ctx.hub.remix("ben", artifact.id);
    expect(remix.files).toHaveLength(3);
    expect(ctx.hub.artifact(artifact.id, null).remixes).toBe(1);

    const improved = remix.files.map((file) => file.path === "app.js" ? { ...file, content: `${file.content}\nfunction remove(i) { items.splice(i, 1); }` } : file);
    const sent = await ctx.hub.sendImprovement("ben", artifact.id, { baseVersion: 1, title: "Add delete", message: "Adds remove()", changes: diffSnapshots(remix.files, improved), authorName: "Ben" });
    expect(sent).toMatchObject({ status: "open", files: 1, artifactTitle: "Todo app" });
    expect(ctx.hub.me("ana").inbox.map((one) => one.id)).toEqual([sent.id]);
    await expect(ctx.hub.improvement("eve", sent.id)).rejects.toThrow(/\[403\]/);

    const decided = await ctx.hub.decide("ana", sent.id, true, "Thanks!", false);
    expect(decided).toMatchObject({ status: "accepted", mergedVersion: 2 });
    const latest = await ctx.hub.files(artifact.id, null);
    expect(latest.version).toBe(2);
    expect(latest.files.find((file) => file.path === "app.js")!.content).toContain("remove(i)");
    const ben = ctx.hub.me("ben");
    expect(ben.profile.totals.acceptedImprovements).toBe(1);
    expect(ben.profile.badges.find((badge) => badge.id === "helper")!.earned).toBe(true);
    expect(ben.activity.map((item) => item.kind)).toEqual(expect.arrayContaining(["improvement.accepted", "badge.earned"]));
    expect(ctx.hub.artifact(artifact.id, null)).toMatchObject({ contributors: 1, contributorNames: ["Ben"] });
  });

  it("refuses a conflicting improvement until the owner chooses theirs", async () => {
    const artifact = await ctx.hub.publishArtifact("ana", { title: "Todo app", description: "A tiny todo list to learn with.", files, ownerName: "Ana" });
    const edited = files.map((file) => file.path === "index.html" ? { ...file, content: "<h1>My todos</h1>" } : file);
    const sent = await ctx.hub.sendImprovement("ben", artifact.id, { baseVersion: 1, title: "Better heading", changes: diffSnapshots(files, edited), authorName: "Ben" });
    await ctx.hub.publishArtifact("ana", { id: artifact.id, title: "Todo app", description: "A tiny todo list to learn with.", files: files.map((file) => file.path === "index.html" ? { ...file, content: "<h1>Todo!</h1>" } : file), ownerName: "Ana" });
    expect((await ctx.hub.improvement("ana", sent.id)).conflicts).toEqual(["index.html"]);
    await expect(ctx.hub.decide("ana", sent.id, true, "", false)).rejects.toThrow(/\[409\].*index\.html/);
    expect((await ctx.hub.decide("ana", sent.id, true, "", true)).mergedVersion).toBe(3);
  });

  it("will not publish a key", async () => {
    await expect(ctx.hub.publishArtifact("ana", { title: "Leaky", description: "This has a key in it.", files: [{ path: "a.js", content: "const k = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123';" }], ownerName: "Ana" })).rejects.toThrow(/\[400\].*\.env/);
  });

  it("lets only the owner publish versions, and not improve their own work", async () => {
    const artifact = await ctx.hub.publishArtifact("ana", { title: "Todo app", description: "A tiny todo list to learn with.", files, ownerName: "Ana" });
    await expect(ctx.hub.publishArtifact("eve", { id: artifact.id, title: "Mine now", description: "Taking this over.", files, ownerName: "Eve" })).rejects.toThrow(/\[403\]/);
    await expect(ctx.hub.sendImprovement("ana", artifact.id, { baseVersion: 1, title: "Self", changes: [], authorName: "Ana" })).rejects.toThrow(/\[409\]/);
  });

  it("keeps a private artifact out of Discover until its share code is presented", async () => {
    const artifact = await ctx.hub.publishArtifact("ana", { title: "Secret app", description: "Only for the people I invite.", files, ownerName: "Ana", visibility: "private" });
    expect(artifact).toMatchObject({ visibility: "private", shareCode: expect.stringMatching(/^adartifact:/) });
    expect(ctx.hub.listArtifacts("new", null, false, 10, 0)).toEqual([]);
    expect(ctx.hub.home(null).totals.artifacts).toBe(0);
    expect(() => ctx.hub.artifact(artifact.id, null)).toThrow(/\[404\]/);
    expect(() => ctx.hub.artifact(artifact.id, "ben", "f".repeat(32))).toThrow(/\[404\]/);

    const share = ctx.hub.share("ana", artifact.id);
    expect(share.visibility).toBe("private");
    const code = decodeArtifactShare(share.shareCode)!;
    expect(ctx.hub.shared("ben", share.shareCode)).toMatchObject({ id: artifact.id, visibility: "private" });
    expect((await ctx.hub.files(artifact.id, null, "ben", code.key)).files).toHaveLength(3);
    const remix = await ctx.hub.remix("ben", artifact.id, code.key);
    expect(remix.files).toHaveLength(3);
    const sent = await ctx.hub.sendImprovement("ben", artifact.id, { baseVersion: 1, title: "Private fix", changes: diffSnapshots(remix.files, remix.files.map((file) => file.path === "app.js" ? { ...file, content: `${file.content}\n// fixed` } : file)), authorName: "Ben" }, code.key);
    expect(sent.artifactTitle).toBe("Secret app");
    expect(ctx.hub.me("ana").artifacts[0]!.shareCode).toBe(share.shareCode);

    const rotated = ctx.hub.rotateShare("ana", artifact.id);
    expect(rotated.shareCode).not.toBe(share.shareCode);
    expect(() => ctx.hub.artifact(artifact.id, "ben", code.key)).toThrow(/\[404\]/);
    expect(ctx.hub.artifact(artifact.id, "ben", decodeArtifactShare(rotated.shareCode)!.key).visibility).toBe("private");

    ctx.hub.setVisibility("ana", artifact.id, "public");
    expect(ctx.hub.listArtifacts("new", null, false, 10, 0).map((one) => one.id)).toEqual([artifact.id]);
    expect(ctx.hub.artifact(artifact.id, null).visibility).toBe("public");
  });
});

describe("monetization waitlist", () => {
  it("records a place and a price", () => {
    expect(ctx.hub.joinWaitlist("ana", true, 4, "Pro prompts")).toEqual({ joined: true, price: 4, position: 1, waiting: 1 });
    expect(ctx.hub.joinWaitlist("ben", true, null, "")).toMatchObject({ position: 2, waiting: 2 });
    expect(() => ctx.hub.joinWaitlist("eve", true, 9999, "")).toThrow(/\[400\]/);
    expect(ctx.hub.joinWaitlist("ana", false, null, "")).toMatchObject({ joined: false, waiting: 1 });
  });
});

describe("HTTP", () => {
  const call = (path: string, who: { uid: string; email?: string | null } | null, body?: unknown) =>
    communityRoute(new Request(`https://projects.example${path}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }), ctx.env as never, who);

  it("serves listings to anybody and writes only for verified accounts", async () => {
    expect((await call("/community/home", null)).status).toBe(200);
    expect((await call("/community/plugins/publish", null, { manifest: plugin(), ownerName: "Ana" })).status).toBe(401);
    expect((await call("/community/plugins/publish", { uid: "ana", email: null }, { manifest: plugin(), ownerName: "Ana" })).status).toBe(403);
    const ok = await call("/community/plugins/publish", { uid: "ana", email: "a@example.com" }, { manifest: plugin(), ownerName: "Ana" });
    expect(ok.status).toBe(200);
    const missing = await call("/community/plugins/not-here", null);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "That plugin is not in the directory." });
  });

  it("serves a private artifact only through its share code and opens its live room", async () => {
    const ana = { uid: "ana", email: "a@example.com" };
    const ben = { uid: "ben", email: "b@example.com" };
    const published = await call("/community/artifacts/publish", ana, { title: "Secret app", description: "Only for the people I invite.", files, ownerName: "Ana", visibility: "private" });
    const artifact = await published.json() as { id: string; shareCode: string; visibility: string };
    expect(artifact).toMatchObject({ visibility: "private", shareCode: expect.stringMatching(/^adartifact:/) });
    expect((await call(`/community/artifacts/${artifact.id}`, null)).status).toBe(404);
    const code = decodeArtifactShare(artifact.shareCode)!;
    expect((await call(`/community/artifacts/${artifact.id}?key=${code.key}`, ben)).status).toBe(200);
    expect((await call(`/community/artifacts/${artifact.id}/room`, ben)).status).toBe(404);

    const opened = await call(`/community/artifacts/${artifact.id}/room/open`, ana, { name: "Ana" });
    expect(opened.status).toBe(200);
    expect(await opened.json()).toMatchObject({ artifactId: artifact.id, open: true, self: { role: "owner" } });
    const joined = await call(`/community/artifacts/${artifact.id}/room/join?key=${code.key}`, ben, { name: "Ben" });
    expect(await joined.json()).toMatchObject({ open: true, self: { uid: "ben", role: "editor" } });
    const after = await call(`/community/artifacts/${artifact.id}/room/action?key=${code.key}`, ben, { action: "post", text: "Ready when you are." });
    expect((await after.json() as { messages: unknown[] }).messages).toHaveLength(1);
    const planned = await call(`/community/artifacts/${artifact.id}/room/action?key=${code.key}`, ben, { action: "plan", operation: "add", title: "Ship the live room" });
    const step = (await planned.json() as { plan: { id: string; status: string }[] }).plan[0]!;
    const moved = await call(`/community/artifacts/${artifact.id}/room/action?key=${code.key}`, ben, { action: "plan", operation: "move", id: step.id, status: "doing" });
    expect((await moved.json() as { plan: { status: string }[] }).plan[0]!.status).toBe("doing");
    const locked = await call(`/community/artifacts/${artifact.id}/room/action?key=${code.key}`, ben, { action: "lock", operation: "lock", path: "app.js" });
    expect((await locked.json() as { locks: { path: string }[] }).locks).toMatchObject([{ path: "app.js" }]);
    expect((await call(`/community/artifacts/${artifact.id}/room/join`, { uid: "eve", email: "e@example.com" }, { name: "Eve" })).status).toBe(404);
  });
});

describe("plugin versions", () => {
  it("keeps every version installable and installs the one asked for", () => {
    ctx.hub.publishPlugin("ana", "Ana", plugin(), "First");
    ctx.hub.publishPlugin("ana", "Ana", plugin({ version: "1.1.0", description: "The second version of this plugin." }), "Second");
    const detail = ctx.hub.plugin("explain-simply", "ben");
    expect(detail.versions.map((one) => [one.version, one.available])).toEqual([["1.1.0", true], ["1.0.0", true]]);
    expect(ctx.hub.install("ben", "explain-simply", "1.0.0").version).toBe("1.0.0");
    expect(ctx.hub.install("eve", "explain-simply").description).toBe("The second version of this plugin.");
    expect(() => ctx.hub.install("eve", "explain-simply", "9.9.9")).toThrow(/\[404\]/);
    expect(ctx.hub.plugin("explain-simply", null).installs).toBe(2);
  });
});
