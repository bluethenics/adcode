import { createHash as nodeHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Buffer as ShimBuffer } from "../src/browserHost/shims/buffer.ts";
import { createHash } from "../src/browserHost/shims/crypto.ts";
import * as fs from "../src/browserHost/shims/fs.ts";
import * as fsp from "../src/browserHost/shims/fsPromises.ts";
import { promisify } from "../src/browserHost/shims/util.ts";
import { execFile } from "../src/browserHost/shims/childProcess.ts";

/*
 * The browser host runs the desktop's main process on these stand-ins for Node's modules
 * (src/browserHost/shims). Each is checked against what Node itself does.
 */

describe("Node's modules in the browser host", () => {
  it("hashes with SHA-256 exactly as Node does", () => {
    for (const input of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(1000), "héllo ✓"]) {
      expect(createHash("sha256").update(input).digest("hex")).toBe(nodeHash("sha256").update(input).digest("hex"));
    }
    expect(createHash("sha256").update("ab").update("c").digest("base64")).toBe(nodeHash("sha256").update("abc").digest("base64"));
    expect(() => createHash("md5")).toThrow("not available");
  });

  it("converts Buffers like Node", () => {
    const text = "Ünïcødé ✓ bytes";
    const shim = ShimBuffer.from(text);
    expect(shim.toString("base64")).toBe(Buffer.from(text).toString("base64"));
    expect(shim.toString("hex")).toBe(Buffer.from(text).toString("hex"));
    expect(shim.toString("base64url")).toBe(Buffer.from(text).toString("base64url"));
    expect(ShimBuffer.from(Buffer.from(text).toString("base64url"), "base64url").toString()).toBe(text);
    expect(ShimBuffer.byteLength(text)).toBe(Buffer.byteLength(text));
    expect(ShimBuffer.concat([ShimBuffer.from("ab"), ShimBuffer.from("cd")]).toString()).toBe("abcd");
    expect(ShimBuffer.isBuffer(shim.subarray(1, 3))).toBe(true);
  });

  it("keeps files with Node's error codes, in the sync and promise forms", async () => {
    const root = `/home/adcode/shim-test-${Date.now()}`;
    await expect(fsp.readFile(`${root}/missing.txt`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(() => fs.writeFileSync(`${root}/a/b.txt`, "x")).toThrow(expect.objectContaining({ code: "ENOENT" }));
    await fsp.mkdir(`${root}/a`, { recursive: true });
    await fsp.writeFile(`${root}/a/b.txt`, "hello");
    await fsp.appendFile(`${root}/a/b.txt`, " world");
    expect(await fsp.readFile(`${root}/a/b.txt`, "utf8")).toBe("hello world");
    expect((await fsp.readdir(`${root}/a`, { withFileTypes: true })).map((entry) => [entry.name, entry.isFile()])).toEqual([["b.txt", true]]);
    await fsp.rename(`${root}/a`, `${root}/c`);
    expect(fs.existsSync(`${root}/c/b.txt`)).toBe(true);
    expect(fs.existsSync(`${root}/a`)).toBe(false);
    await expect(fsp.rm(`${root}/c`)).rejects.toMatchObject({ code: "ENOTEMPTY" });
    await fsp.rm(`${root}/c`, { recursive: true });
    expect((await fsp.stat(root)).isDirectory()).toBe(true);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("fails a program run the way a missing program fails", async () => {
    await expect(promisify(execFile)("git", ["status"])).rejects.toMatchObject({ code: "ENOENT" });
    const error = await new Promise<Error>((resolve) => execFile("node", ["-v"], (failure: Error | null) => resolve(failure!)));
    expect(error.message).toContain("desktop app");
  });
});
