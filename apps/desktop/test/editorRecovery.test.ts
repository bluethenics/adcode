import { readFileSync } from "node:fs";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

function loadRecovery(scope: Record<string, unknown>): () => Promise<number> {
  const source = ts.createSourceFile("main.ts", readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const statements = source.statements.filter((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && ["offerRecovery", "restoreRecoveryDraft"].includes(node.name?.text ?? ""),
  );
  const javascript = ts.transpileModule(statements.map((node) => node.getText(source)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(scope), `${javascript}\nreturn offerRecovery;`)(...Object.values(scope)) as () => Promise<number>;
}

interface Options {
  missing?: boolean;
  vibe?: boolean;
  web?: boolean;
  cancelled?: boolean;
  failed?: boolean;
  readOnly?: boolean;
  openFailed?: boolean;
  text?: string;
}

async function harness(options: Options = {}) {
  const draft = { path: "/old-project/file.ts", text: options.text ?? "recovered text", savedAt: "2026-10-21T00:00:00Z" };
  const state = { model: null as string | null, dirty: false, kept: true, status: "" };
  const copies: { text: string; name: string }[] = [];
  const opened: string[] = [];
  const notifications: { actions: { label: string; run(): void }[] }[] = [];
  const offer = loadRecovery({
    isIdeWindow: !options.vibe, isWebSurface: () => options.web === true,
    basename: (path: string) => path.split("/").at(-1),
    setStatus: (message: string) => { state.status = message; },
    notifications: { show: (notice: typeof notifications[number]) => notifications.push(notice) },
    // openFile deliberately resolves even when disk reads fail, matching the shell.
    openFile: async () => { if (!options.missing && !options.vibe) state.model = "on disk"; },
    openPickedFile: async (target: string) => { if (options.openFailed) throw new Error("folder unavailable"); opened.push(target); },
    editorHost: {
      text: () => state.model,
      isReadOnly: () => options.readOnly === true,
      replaceText: (_path: string, text: string) => {
        if (state.model !== null && !options.readOnly) { state.model = text; state.dirty = true; }
      },
    },
    window: { adcode: {
      files: {
        read: async () => { if (options.missing) throw new Error("ENOENT"); return { text: "on disk" }; },
        saveAs: async (text: string, name: string) => {
          copies.push({ text, name });
          if (options.failed) throw new Error("save dialog unavailable");
          return options.cancelled ? null : options.web ? "file.ts" : "/chosen-project/recovered.ts";
        },
      },
      history: { drafts: async () => [draft], clearDraft: () => { state.kept = false; } },
    } },
  });
  expect(await offer()).toBe(1);
  const restore = notifications[0]!.actions.find((action) => action.label === "Restore")!;
  restore.run();
  for (let step = 0; step < 12; step++) await Promise.resolve();
  return { state, copies, opened };
}

describe("restoring recovery drafts", () => {
  it("restores an existing editable IDE buffer and keeps it dirty until saved", async () => {
    const h = await harness();
    expect(h.state.model).toBe("recovered text");
    expect(h.state.dirty).toBe(true);
    expect(h.state.kept).toBe(true);
    expect(h.copies).toEqual([]);
  });

  it("offers Save As when the original file cannot be opened", async () => {
    const h = await harness({ missing: true });
    expect(h.copies).toEqual([{ text: "recovered text", name: "file.ts" }]);
    expect(h.opened).toEqual(["/chosen-project/recovered.ts"]);
    expect(h.state.kept).toBe(false);
    expect(h.state.status).not.toContain("Restored - save");
  });

  it("uses a recovered copy in Vibe instead of replacing a hidden editor buffer", async () => {
    const h = await harness({ vibe: true });
    expect(h.state.model).toBeNull();
    expect(h.copies).toEqual([{ text: "recovered text", name: "file.ts" }]);
    expect(h.opened).toEqual(["/chosen-project/recovered.ts"]);
  });

  it("keeps the original draft when Save As is cancelled", async () => {
    const h = await harness({ missing: true, cancelled: true });
    expect(h.state.kept).toBe(true);
    expect(h.opened).toEqual([]);
    expect(h.state.status).not.toContain("Restored");
    expect(h.state.status).not.toContain("saved");
  });

  it("keeps the original draft when Save As fails", async () => {
    const h = await harness({ missing: true, failed: true });
    expect(h.copies).toHaveLength(1);
    expect(h.state.kept).toBe(true);
    expect(h.opened).toEqual([]);
    expect(h.state.status).not.toContain("Restored");
  });

  it("preserves an empty recovered file", async () => {
    const h = await harness({ missing: true, text: "" });
    expect(h.copies).toEqual([{ text: "", name: "file.ts" }]);
  });

  it("retains the draft if the saved copy cannot be opened", async () => {
    const h = await harness({ missing: true, openFailed: true });
    expect(h.copies).toHaveLength(1);
    expect(h.state.kept).toBe(true);
    expect(h.opened).toEqual([]);
  });

  it("saves a copy instead of overwriting a read-only buffer", async () => {
    const h = await harness({ readOnly: true });
    expect(h.state.model).toBe("on disk");
    expect(h.copies).toHaveLength(1);
    expect(h.state.dirty).toBe(false);
  });

  it("keeps browser downloads separate from host paths and retains the recovery draft", async () => {
    const h = await harness({ missing: true, web: true });
    expect(h.copies).toEqual([{ text: "recovered text", name: "file.ts" }]);
    expect(h.opened).toEqual([]);
    expect(h.state.kept).toBe(true);
  });
});
