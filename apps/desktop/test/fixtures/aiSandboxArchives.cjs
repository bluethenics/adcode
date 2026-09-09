const { app } = require("electron");
const fs = require("original-fs").promises;
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");
const assert = require("node:assert/strict");

app.whenReady().then(async () => {
  const scratch = await fs.mkdtemp(join(tmpdir(), "adcode-asar-test-"));
  try {
    const filename = resolve(__dirname, "../../src/main/aiSandbox.ts");
    const source = (await fs.readFile(filename, "utf8"))
      .replaceAll("import.meta.url", JSON.stringify(pathToFileURL(filename).href));
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    new Function("require", "exports", code)(require, exports);
    const workspace = join(scratch, "project");
    await fs.mkdir(join(workspace, "release", "win-unpacked", "resources"), { recursive: true });
    await fs.writeFile(join(workspace, "release", "win-unpacked", "resources", "app.asar"), "invalid package");
    await fs.writeFile(join(workspace, "fixture.asar"), "opaque bytes");
    await fs.writeFile(join(workspace, "index.ts"), "source");
    const base = await exports.captureAiSandboxBase({
      workspaceRoot: workspace, userDataDirectory: join(scratch, "data"), teamId: "team-archive",
    });
    const sandbox = await exports.createAiSandbox({
      workspaceRoot: workspace, userDataDirectory: join(scratch, "data"),
      taskId: "task-archive", now: 1, source: base.source,
    });
    assert.equal(await fs.readFile(join(sandbox.root, "fixture.asar"), "utf8"), "opaque bytes");
    assert.equal(await fs.readFile(join(sandbox.root, "index.ts"), "utf8"), "source");
    await assert.rejects(fs.stat(join(sandbox.root, "release")), { code: "ENOENT" });
    await sandbox.cleanup();
    await base.cleanup();
    console.log("ASAR_SANDBOX_OK");
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}).then(() => app.exit(0), (error) => { console.error(error); app.exit(1); });
