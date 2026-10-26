import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { parseUpdateManifest } from "../packages/release/src/updateManifest.ts";

const manifests = {
  windows: { name: "latest.yml", installer: "ADCode-Setup-x64.exe", blockmap: true },
  linux: { name: "latest-linux.yml", installer: "ADCode-x86_64.AppImage", blockmap: false },
};

/** Match metadata to the actual uploaded bytes, before drafting or publishing a release. */
export async function verifyUpdateArtifacts(directory, version, platform) {
  const checks = platform === "linux-deb" ? [] : platform ? [manifests[platform]].filter(Boolean) : Object.values(manifests);
  const root = await realpath(directory);
  const regular = async filename => {
    if (basename(filename) !== filename || /[\\/]/.test(filename)) throw new Error(`Update asset must be a local filename: ${filename}`);
    const path = join(root, filename);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || resolve(await realpath(path)) !== resolve(path)) throw new Error(`Update asset is not a regular file: ${filename}`);
    if (info.size >= 2 ** 31) throw new Error(`GitHub release assets must be smaller than 2 GiB: ${filename}`);
    return { path, info };
  };
  for (const check of checks) {
    const source = await regular(check.name);
    if (source.info.size > 128 * 1024) throw new Error(`${check.name} is too large.`);
    const manifest = parseUpdateManifest(await readFile(source.path, "utf8"));
    if (manifest.version !== version) throw new Error(`${check.name} version ${manifest.version} does not match release ${version}.`);
    if (!manifest.files.some(file => decodeURIComponent(file.url) === check.installer)) throw new Error(`${check.name} does not advertise ${check.installer}.`);
    for (const file of manifest.files) {
      const name = decodeURIComponent(file.url);
      const artifact = await regular(name);
      if (artifact.info.size !== file.size) throw new Error(`${name} size does not match ${check.name}.`);
      const hash = createHash("sha512");
      for await (const chunk of createReadStream(artifact.path)) hash.update(chunk);
      if (hash.digest("base64") !== file.sha512) throw new Error(`${name} SHA-512 does not match ${check.name}.`);
    }
    if (check.blockmap) {
      const map = await regular(`${check.installer}.blockmap`);
      if (map.info.size > 16 * 1024 * 1024) throw new Error("Windows blockmap is too large.");
      const decoded = gunzipSync(await readFile(map.path), { maxOutputLength: 64 * 1024 * 1024 });
      const blockmap = JSON.parse(decoded.toString("utf8"));
      if (blockmap.version !== "2" || !Array.isArray(blockmap.files) || blockmap.files.length !== 1) throw new Error("Windows blockmap needs one version-2 file.");
      let size = 0;
      for (const file of blockmap.files) {
        if (file.name !== "file" || file.offset !== 0 || !Array.isArray(file.sizes) || !Array.isArray(file.checksums) || file.sizes.length === 0 || file.sizes.length !== file.checksums.length || file.sizes.some(value => !Number.isSafeInteger(value) || value <= 0) || file.checksums.some(value => typeof value !== "string" || !/^[A-Za-z0-9+/]{24}$/.test(value))) throw new Error("Windows blockmap is malformed.");
        size += file.sizes.reduce((total, value) => total + value, 0);
      }
      if (size !== (await regular(check.installer)).info.size) throw new Error("Windows blockmap does not describe this installer.");
    }
  }
  return checks.map(check => check.name);
}
