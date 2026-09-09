import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
const source = readFileSync(join(import.meta.dirname, "../../../apps/web/public/install.sh"), "utf8");
const checksum = source.slice(source.indexOf("# electron-builder publishes latest-linux.yml"), source.indexOf("# Everything somebody installing"));

describe.skipIf(!existsSync(bash))("Linux installer checksum verification", () => {
  function check(manifest: string, contents = "debian package") {
    const directory = mkdtempSync(join(tmpdir(), "adcode-checksum-"));
    writeFileSync(join(directory, "ADCode-amd64.deb"), contents);
    try {
      return spawnSync(bash, ["-c", `set -eu
fail() { printf '%s\\n' "$1" >&2; exit 1; }
say() { printf '%s\\n' "$1"; }
need() { command -v "$1" >/dev/null 2>&1 || fail "Missing $1"; }
curl() { printf '%s' "$TEST_MANIFEST"; }
YELLOW=''; RESET=''
${checksum}`], {
        encoding: "utf8",
        env: { ...process.env, WORKDIR: directory.replace(/\\/g, "/"), FILE: "ADCode-amd64.deb",
          RELEASE: JSON.stringify({ assets: [{ browser_download_url: "https://example.test/latest-linux.yml" }] }),
          TEST_MANIFEST: manifest },
      });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
  const digest = createHash("sha512").update("debian package").digest("base64");
  const manifest = `version: 1.0.0\nfiles:\n  - url: ADCode-x86_64.AppImage\n    sha512: OTHER\n  - url: ADCode-amd64.deb\n    sha512: ${digest}\n`;

  it("checks the selected Debian package instead of the first AppImage checksum", () => {
    const result = check(manifest);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Checksum verified.");
  });
  it("refuses a tampered package", () => { expect(check(manifest, "tampered").status).not.toBe(0); });
  it("refuses a manifest without a checksum for the selected file", () => {
    expect(check("version: 1.0.0\nfiles: []\n").status).not.toBe(0);
  });
});

describe.skipIf(process.platform !== "win32")("Windows installer checksum verification", () => {
  const windowsSource = readFileSync(join(import.meta.dirname, "../../../apps/web/public/install.ps1"), "utf8");
  const block = windowsSource.slice(windowsSource.indexOf("# Verify the selected asset"), windowsSource.indexOf('Write-Host "  Starting the installer..."'));
  function check(digest: string) {
    const directory = mkdtempSync(join(tmpdir(), "adcode-checksum-win-"));
    const target = join(directory, "installer.exe");
    writeFileSync(target, "installer fixture");
    try {
      return spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `$ErrorActionPreference = 'Stop'; function Fail($message) { throw $message }; $asset = @{ digest = $env:TEST_DIGEST }; $target = $env:TEST_TARGET; ${block}`],
      { encoding: "utf8", env: { ...process.env, TEST_DIGEST: digest, TEST_TARGET: target } });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
  it("verifies the selected asset's digest", () => {
    const digest = createHash("sha256").update("installer fixture").digest("hex");
    const result = check(`sha256:${digest}`);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Checksum verified.");
  });
  it("refuses an incorrect digest", () => { expect(check(`sha256:${"0".repeat(64)}`).status).not.toBe(0); });
  it("refuses a missing digest", () => { expect(check("").status).not.toBe(0); });
});
