import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCheckpointStore, planUndo } from "../src/main/aiCheckpoints.ts";

let project: string;
let store: string;
const exists = (path: string) => readFile(path, "utf8").then(() => true, () => false);

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "adcode-cp-project-"));
  store = await mkdtemp(join(tmpdir(), "adcode-cp-store-"));
});
afterEach(async () => {
  await rm(project, { recursive: true, force: true });
  await rm(store, { recursive: true, force: true });
});

const checkpoints = (keep?: number) => createCheckpointStore({
  directory: () => store,
  resolve: async (root, path) => join(root, path),
  ...(keep === undefined ? {} : { keep }),
});

/** Stand-in for the assistant's direct write: change the file, then record it. */
async function assistantWrites(cp: ReturnType<typeof checkpoints>, path: string, contents: string): Promise<void> {
  const target = join(project, path);
  const before = await readFile(target, "utf8").catch(() => null);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, contents);
  cp.record(path, before, contents);
}

describe("undo checkpoints for applied edits", () => {
  it("puts edited files back and removes files the turn created", async () => {
    await writeFile(join(project, "index.html"), "<h1>old</h1>");
    const cp = checkpoints();
    cp.begin(project);
    await assistantWrites(cp, "index.html", "<h1>draft</h1>");
    await assistantWrites(cp, "index.html", "<h1>new</h1>");
    await assistantWrites(cp, "css/site.css", "body{}");
    const saved = await cp.finish();
    expect(saved?.files).toEqual([
      { path: "index.html", before: "<h1>old</h1>", after: "<h1>new</h1>" },
      { path: "css/site.css", before: null, after: "body{}" },
    ]);

    const result = await cp.undo(saved!.id, project, false);
    expect(result).toMatchObject({ ok: true, restored: ["index.html", "css/site.css"] });
    expect(await readFile(join(project, "index.html"), "utf8")).toBe("<h1>old</h1>");
    expect(await exists(join(project, "css/site.css"))).toBe(false);
    expect(await cp.undo(saved!.id, project, false)).toMatchObject({ ok: false, message: "Already undone." });
  });

  it("refuses to overwrite the user's later edits unless told to", async () => {
    await writeFile(join(project, "app.js"), "v1");
    const cp = checkpoints();
    cp.begin(project);
    await assistantWrites(cp, "app.js", "v2-ai");
    const saved = await cp.finish();
    await writeFile(join(project, "app.js"), "v3-mine");

    const refused = await cp.undo(saved!.id, project, false);
    expect(refused).toMatchObject({ ok: false, conflicts: ["app.js"] });
    expect(await readFile(join(project, "app.js"), "utf8")).toBe("v3-mine");

    expect(await cp.undo(saved!.id, project, true)).toMatchObject({ ok: true });
    expect(await readFile(join(project, "app.js"), "utf8")).toBe("v1");
  });

  it("saves nothing for a turn that changed nothing, and only undoes in its own project", async () => {
    const cp = checkpoints();
    cp.begin(project);
    expect(await cp.finish()).toBeNull();

    cp.begin(project);
    await assistantWrites(cp, "a.txt", "x");
    const saved = await cp.finish();
    expect(await cp.undo(saved!.id, join(project, "other"), false)).toMatchObject({ ok: false, message: "Open the project this change was made in to undo it." });
    expect(await cp.undo("not-an-id", project, false)).toMatchObject({ ok: false });
  });

  it("keeps only the most recent checkpoints on disk", async () => {
    let clock = 0;
    const cp = createCheckpointStore({ directory: () => store, resolve: async (root, path) => join(root, path), keep: 2, now: () => ++clock });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      cp.begin(project);
      await assistantWrites(cp, `f${i}.txt`, "x");
      ids.push((await cp.finish())!.id);
    }
    expect(await cp.undo(ids[0]!, project, false)).toMatchObject({ ok: false, message: expect.stringContaining("checkpoint is gone") });
    expect(await cp.undo(ids[2]!, project, false)).toMatchObject({ ok: true });
  });
});

describe("planning an undo", () => {
  it("flags only files that no longer hold what the turn wrote", () => {
    const plan = planUndo(
      { files: [{ path: "a", before: "1", after: "2" }, { path: "b", before: null, after: "new" }] },
      new Map([["a", "2"], ["b", null]]),
    );
    expect(plan.conflicts).toEqual(["b"]);
  });
});
