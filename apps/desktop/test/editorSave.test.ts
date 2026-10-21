import { readFileSync } from "node:fs";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

// Exercise the shell's actual orchestration without booting Monaco, Electron, and every
// workbench panel. Only the editor model and asynchronous IPC boundary are controlled here.
function loadSavePath(scope: Record<string, unknown>): (path: string) => Promise<void> {
  const source = ts.createSourceFile("main.ts", readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const names = new Set(["savePath", "savePathNow", "fileSaveQueues"]);
  const statements = source.statements.filter((node) =>
    ts.isFunctionDeclaration(node) ? node.name !== undefined && names.has(node.name.text)
      : ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && names.has(declaration.name.text)),
  );
  const javascript = ts.transpileModule(statements.map((node) => node.getText(source)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(scope), `${javascript}\nreturn savePath;`)(...Object.values(scope)) as (path: string) => Promise<void>;
}

function harness() {
  const path = "/project/file.ts";
  const state: { text: string | null; saved: string | null; disk: string; draft: string; status: string } = { text: "version A", saved: "initial", disk: "initial", draft: "version A", status: "" };
  const writes: { path: string; text: string; finish(ok?: boolean): void; fail(): void }[] = [];
  const editorHost = {
    text: () => state.text,
    isDirty: () => state.text !== state.saved,
    isReadOnly: () => false,
    organizeImports: () => false,
    formatDocument: async () => undefined,
    captureSave: () => {
      const text = state.text;
      return text === null ? null : {
        text,
        markSaved: () => { if (state.text !== null) state.saved = text; },
      };
    },
  };
  const save = loadSavePath({
    editorHost, isImagePath: () => false, settingsValues: {}, activePath: path,
    setStatus: (message: string) => { state.status = message; },
    refreshGitOverlay: async () => undefined, sourceControl: { refresh: async () => undefined },
    window: { adcode: {
      files: { write: (target: string, text: string) => new Promise((resolve, reject) => {
        writes.push({ path: target, text, finish: (ok = true) => {
          if (ok) { state.disk = text; state.draft = ""; }
          resolve({ ok, mtimeMs: 1, ...(ok ? {} : { reason: "disk full" }) });
        }, fail: () => reject(new Error("bridge disconnected")) });
      }) },
      history: { draft: (_target: string, text: string) => { state.draft = text; } },
    } },
  });
  return { path, state, writes, save, dirty: editorHost.isDirty };
}

async function flush(): Promise<void> {
  for (let step = 0; step < 10; step++) await Promise.resolve();
}

describe("saving an editor buffer", () => {
  it("marks the unchanged buffer saved after a successful write", async () => {
    const h = harness();
    const saving = h.save(h.path);
    await flush();
    h.writes[0]!.finish();
    await saving;
    expect(h.state.disk).toBe("version A");
    expect(h.dirty()).toBe(false);
  });

  it("keeps text typed during I/O dirty and recoverable, then saves it on the next request", async () => {
    const h = harness();
    const first = h.save(h.path);
    await flush();
    h.state.text = "version B";
    h.writes[0]!.finish();
    await first;
    expect(h.state.disk).toBe("version A");
    expect(h.dirty()).toBe(true);
    expect(h.state.draft).toBe("version B");

    const second = h.save(h.path);
    await flush();
    expect(h.writes[1]!.text).toBe("version B");
    h.writes[1]!.finish();
    await second;
    expect(h.state.disk).toBe("version B");
    expect(h.dirty()).toBe(false);
  });

  it("serializes saves of the same path so an older write cannot overwrite a newer save", async () => {
    const h = harness();
    const first = h.save(h.path);
    await flush();
    h.state.text = "version B";
    const second = h.save(h.path);
    await flush();
    expect(h.writes).toHaveLength(1);
    h.writes[0]!.finish();
    await first;
    await flush();
    expect(h.writes[1]!.text).toBe("version B");
    h.writes[1]!.finish();
    await second;
    expect(h.state.disk).toBe("version B");
    expect(h.dirty()).toBe(false);
  });

  it("keeps an undo to the previous saved text dirty when a newer snapshot reaches disk", async () => {
    const h = harness();
    const saving = h.save(h.path);
    await flush();
    h.state.text = "initial";
    expect(h.dirty()).toBe(false);
    h.writes[0]!.finish();
    await saving;
    expect(h.state.disk).toBe("version A");
    expect(h.dirty()).toBe(true);
    expect(h.state.draft).toBe("initial");
  });

  it("does not serialize unrelated files behind a slow save", async () => {
    const h = harness();
    const first = h.save(h.path);
    const second = h.save("/project/other.ts");
    await flush();
    expect(h.writes.map((write) => write.path)).toEqual([h.path, "/project/other.ts"]);
    for (const write of h.writes) write.finish();
    await Promise.all([first, second]);
  });

  it("keeps failed writes dirty with their recovery draft", async () => {
    const h = harness();
    const saving = h.save(h.path);
    await flush();
    h.writes[0]!.finish(false);
    await saving;
    expect(h.state.disk).toBe("initial");
    expect(h.dirty()).toBe(true);
    expect(h.state.draft).toBe("version A");
  });

  it("does not create a draft for a buffer closed during the save", async () => {
    const h = harness();
    const saving = h.save(h.path);
    await flush();
    h.state.text = null;
    h.writes[0]!.finish();
    await saving;
    expect(h.state.draft).toBe("");
    expect(h.state.saved).toBe("initial");
  });

  it("allows a later save after an IPC rejection", async () => {
    const h = harness();
    const first = h.save(h.path);
    const rejection = expect(first).rejects.toThrow("bridge disconnected");
    await flush();
    h.state.text = "version B";
    const retry = h.save(h.path);
    h.writes[0]!.fail();
    await rejection;
    await flush();
    expect(h.writes[1]!.text).toBe("version B");
    h.writes[1]!.finish();
    await retry;
    expect(h.state.disk).toBe("version B");
    expect(h.dirty()).toBe(false);
  });
});

describe("editor save snapshots", () => {
  function fixture() {
    const source = ts.createSourceFile("editorHost.ts", readFileSync(new URL("../src/renderer/editor/editorHost.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
    let method: ts.MethodDeclaration | undefined;
    function visit(node: ts.Node): void {
      if (ts.isMethodDeclaration(node) && node.name.getText(source) === "captureSave") method = node;
      ts.forEachChild(node, visit);
    }
    visit(source);
    if (method === undefined) throw new Error("captureSave implementation missing");
    const javascript = ts.transpileModule(`const host = { ${method.getText(source)} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const state = { text: "version A", version: 2 };
    const entry = { savedVersionId: 1, model: { getValue: () => state.text, getAlternativeVersionId: () => state.version } };
    const models = new Map([["file.ts", entry]]);
    const changes: boolean[] = [];
    const captureSave = new Function("models", "notifyDirty", `${javascript}\nreturn host.captureSave;`)(models, () => changes.push(state.version !== entry.savedVersionId)) as (path: string) => { text: string; markSaved(): void } | null;
    return { state, entry, models, changes, captureSave };
  }

  it("records the submitted Monaco version instead of newer edits", () => {
    const h = fixture();
    const snapshot = h.captureSave("file.ts")!;
    h.state.text = "version B";
    h.state.version = 3;
    snapshot.markSaved();
    expect(snapshot.text).toBe("version A");
    expect(h.entry.savedVersionId).toBe(2);
    expect(h.changes).toEqual([true]);
  });

  it("marks an undo to the old baseline dirty after the submitted version is saved", () => {
    const h = fixture();
    const snapshot = h.captureSave("file.ts")!;
    h.state.text = "initial";
    h.state.version = 1;
    snapshot.markSaved();
    expect(h.entry.savedVersionId).toBe(2);
    expect(h.changes).toEqual([true]);
  });

  it("does not mark a closed model saved", () => {
    const h = fixture();
    const snapshot = h.captureSave("file.ts")!;
    h.models.delete("file.ts");
    snapshot.markSaved();
    expect(h.entry.savedVersionId).toBe(1);
    expect(h.changes).toEqual([]);
  });

  it("keeps a reopened buffer dirty when it read the disk before the pending write", () => {
    const h = fixture();
    const snapshot = h.captureSave("file.ts")!;
    const replacement = { savedVersionId: 7, model: { getValue: () => "initial", getAlternativeVersionId: () => 7 } };
    h.models.set("file.ts", replacement);
    snapshot.markSaved();
    expect(replacement.savedVersionId).not.toBe(7);
    expect(h.entry.savedVersionId).toBe(1);
  });

  it("recognizes a replacement model whose contents match the completed write", () => {
    const h = fixture();
    const snapshot = h.captureSave("file.ts")!;
    const replacement = { savedVersionId: 6, model: { getValue: () => "version A", getAlternativeVersionId: () => 7 } };
    h.models.set("file.ts", replacement);
    snapshot.markSaved();
    expect(replacement.savedVersionId).toBe(7);
  });

  it("returns no snapshot for an absent model", () => {
    expect(fixture().captureSave("missing.ts")).toBeNull();
  });
});
