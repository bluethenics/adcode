import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
const source = readFileSync(new URL("../../../apps/web/public/install.sh", import.meta.url), "utf8");
const installation = source.slice(source.indexOf("guidance() {"));
const shellPath = (path: string): string => process.platform === "win32"
  ? path.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_match, drive: string) => `/${drive.toLowerCase()}`) : path;

describe.skipIf(!existsSync(bash))("packaged Linux installer guidance", () => {
  function install(kind: "deb" | "appimage", onPath = true, spaces = false) {
    const directory = mkdtempSync(join(tmpdir(), "adcode-guidance-"));
    const home = join(directory, spaces ? "home with spaces" : "home");
    const download = join(directory, "download");
    mkdirSync(home);
    mkdirSync(download);
    const file = kind === "deb" ? "ADCode-amd64.deb" : "ADCode-x86_64.AppImage";
    writeFileSync(join(download, file), "#!/bin/sh\nprintf 'PACKAGED_LAUNCH_OK\\n'\n");
    try {
      return spawnSync(bash, ["-c", `set -eu
fail() { printf '%s\\n' "$1" >&2; exit 1; }
say() { printf '%s\\n' "$1"; }
sudo() { [ "$1" = dpkg ] && [ "$2" = -i ] && [ "$3" = "$WORKDIR/$FILE" ]; }
# Functions enforce Linux's case sensitivity even when this test runs on Windows.
${kind === "deb" ? "ADCode() { printf 'PACKAGED_LAUNCH_OK\\n'; }; adcode() { fail 'No lowercase Debian launcher'; }" : ""}
BOLD=''; DIM=''; GREEN=''; YELLOW=''; RESET=''; SITE='https://example.test'
${onPath ? 'PATH="$HOME/.local/bin:$PATH"' : ""}
output="$(
${installation}
)"
printf '%s\\n' "$output"
launch="$(printf '%s\\n' "$output" | sed -n 's/^    Launch            //p')"
[ -n "$launch" ] || fail 'No launcher was printed'
eval "$launch"
`], { encoding: "utf8", env: { ...process.env, HOME: shellPath(home), WORKDIR: shellPath(download), FILE: file } });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  function expectWorkingGuidance(result: ReturnType<typeof install>) {
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PACKAGED_LAUNCH_OK");
    expect(result.stdout).toContain("File > Open Folder");
    expect(result.stdout).toContain("Command Palette (Ctrl+Shift+P)");
    expect(result.stdout).not.toContain("adcode open .");
    expect(result.stdout).not.toContain("adcode help");
  }

  it("prints the installed Debian executable's actual name", () => {
    const result = install("deb");
    expectWorkingGuidance(result);
    expect(result.stdout).toContain("Launch            ADCode\n");
  });

  it("launches the installed AppImage when its destination is on PATH", () => {
    const result = install("appimage");
    expectWorkingGuidance(result);
    expect(result.stdout).toContain("Launch            adcode\n");
  });

  it("prints a working absolute AppImage command when the home path contains spaces", () => {
    const result = install("appimage", false, true);
    expectWorkingGuidance(result);
    expect(result.stdout).toMatch(/Launch\s+"[^"\n]*home with spaces\/\.local\/bin\/adcode"/);
  });
});

describe.skipIf(process.platform !== "win32")("packaged Windows installer guidance", () => {
  it("points to the installed Start menu entry and app actions", () => {
    const windows = readFileSync(new URL("../../../apps/web/public/install.ps1", import.meta.url), "utf8");
    const guidance = windows.slice(windows.indexOf('Write-Host "  Next"'));
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$Site = 'https://example.test'; ${guidance}`], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Start menu > ADCode");
    expect(result.stdout).toContain("File > Open Folder");
    expect(result.stdout).toContain("Command Palette (Ctrl+Shift+P)");
    expect(result.stdout).not.toContain("adcode open .");
    expect(result.stdout).not.toContain("adcode help");
  });
});
