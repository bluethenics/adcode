import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { parseUpdateManifest } from "../src/updateManifest.ts";

const script = resolve(import.meta.dirname, "../../../scripts/check-release-assets.mjs");
const temporary: string[] = [];
afterEach(async () => { for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true }); });
const sha = (data: Uint8Array) => createHash("sha512").update(data).digest("base64");

async function artifacts() {
  const root = await mkdtemp(join(tmpdir(), "adcode-release-artifacts-")); temporary.push(root);
  const exe = Buffer.from("test installer bytes"), image = Buffer.from("test AppImage bytes");
  await writeFile(join(root, "ADCode-Setup-x64.exe"), exe);
  await writeFile(join(root, "ADCode-x86_64.AppImage"), image);
  await writeFile(join(root, "ADCode-amd64.deb"), "deb");
  await writeFile(join(root, "ADCode-Setup-x64.exe.blockmap"), gzipSync(JSON.stringify({ version: "2", files: [{ name: "file", offset: 0, sizes: [exe.length], checksums: ["abcdefghijklmnopqrstuvwx"] }] })));
  const manifest = (name: string, data: Uint8Array) => `version: 2.4.1\nfiles:\n  - url: ${name}\n    sha512: ${sha(data)}\n    size: ${data.length}\npath: ${name}\nsha512: ${sha(data)}\nreleaseDate: '2026-10-26T00:00:00.000Z'\n`;
  await writeFile(join(root, "latest.yml"), manifest("ADCode-Setup-x64.exe", exe));
  await writeFile(join(root, "latest-linux.yml"), manifest("ADCode-x86_64.AppImage", image));
  const run = (...args: string[]) => spawnSync(process.execPath, [script, "--version", "2.4.1", ...args, root], { encoding: "utf8", timeout: 15_000 });
  return { root, exe, run };
}

describe("release update manifests", () => {
  it("requires actual files and rejects incomplete, duplicate or unsupported metadata", () => {
    const hash = sha(Buffer.from("test"));
    expect(parseUpdateManifest(`version: "2.4.1"\nfiles:\n  - url: ADCode.exe\n    sha512: ${hash}\n    size: 4\n`).files).toHaveLength(1);
    for (const text of ["version: 2.4.1\n", "files: []\n", `version: 2.4.1\nfiles:\n  - url: ADCode.exe\n    size: 4\n`, `version: 2.4.1\nfiles:\n  - url: ADCode.exe\n    sha512: ${hash}\n    size: 0\n`]) expect(() => parseUpdateManifest(text)).toThrow();
  });

  it("validates a complete Windows/Linux release and accepts embedded Linux blockmaps", async () => {
    const { run } = await artifacts(); const result = run();
    expect(result.status, result.stderr).toBe(0); expect(result.stdout).toContain("latest.yml, latest-linux.yml verified");
  });

  it("refuses stale metadata and a tampered installer before it can be drafted", async () => {
    const { root, run } = await artifacts();
    const manifest = await readFile(join(root, "latest.yml"), "utf8");
    await writeFile(join(root, "latest.yml"), manifest.replace("2.4.1", "2.4.0"));
    expect(run("--platform", "windows").stderr).toContain("does not match release");
    await writeFile(join(root, "latest.yml"), manifest);
    await writeFile(join(root, "ADCode-Setup-x64.exe"), "bad installer bytes!");
    const result = run("--platform", "windows");
    expect(result.status).toBe(1); expect(result.stderr).toContain("SHA-512 does not match");
    await writeFile(join(root, "ADCode-Setup-x64.exe"), "too short");
    expect(run("--platform", "windows").stderr).toContain("size does not match");
  });

  it("refuses missing and mismatched differential blockmaps", async () => {
    const { root, exe, run } = await artifacts();
    await writeFile(join(root, "ADCode-Setup-x64.exe.blockmap"), gzipSync(JSON.stringify({ version: "2", files: [{ name: "file", offset: 0, sizes: [exe.length - 1], checksums: ["abcdefghijklmnopqrstuvwx"] }] })));
    expect(run("--platform", "windows").stderr).toContain("does not describe this installer");
    await rm(join(root, "ADCode-Setup-x64.exe.blockmap"));
    expect(run("--platform", "windows").status).toBe(1);
  });

  it("refuses manifests pointing outside the uploaded release assets", async () => {
    const { root, run } = await artifacts();
    const text = await readFile(join(root, "latest.yml"), "utf8");
    await writeFile(join(root, "latest.yml"), text.replace("ADCode-Setup-x64.exe", "../ADCode-Setup-x64.exe"));
    expect(run("--platform", "windows").status).toBe(1);
  });

  it("refuses ambiguous file fields instead of checking a different interpretation than the updater", () => {
    const entry = `version: 2.4.1\nfiles:\n  - url: ADCode.exe\n    sha512: ${sha(Buffer.from("test"))}\n    size: 4\n`;
    for (const extra of ["    url: other.exe\n", "    size: 8\n", "    <<: *defaults\n", "   path: other.exe\n", "files: []\n"]) {
      expect(() => parseUpdateManifest(entry + extra)).toThrow();
    }
  });

  it("validates artifacts with no installed npm dependencies, as in the final draft job", async () => {
    const { root } = await artifacts();
    const isolated = join(root, "checkout");
    await mkdir(join(isolated, "scripts"), { recursive: true });
    await mkdir(join(isolated, "packages/release/src"), { recursive: true });
    await writeFile(join(isolated, "package.json"), JSON.stringify({ type: "module", version: "2.4.1" }));
    for (const path of ["scripts/check-release-assets.mjs", "scripts/release-artifacts.mjs", "packages/release/src/updateManifest.ts", "packages/release/src/downloadAssets.ts"]) {
      await copyFile(resolve(import.meta.dirname, "../../..", path), join(isolated, path));
    }
    const result = spawnSync(process.execPath, [join(isolated, "scripts/check-release-assets.mjs"), root], { cwd: isolated, encoding: "utf8", timeout: 15_000 });
    expect(result.status, result.stderr).toBe(0);
  });
});
