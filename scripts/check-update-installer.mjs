// Run after Windows packaging has provisioned electron-builder's NSIS toolset.
// This compiles a tiny marker installer, never ADCode: no app registry keys,
// shortcuts, user profile, app process, or packaged release assets are changed.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

if (process.platform !== "win32") {
  throw new Error("check-update-installer.mjs requires Windows; it runs real NSIS progress windows.");
}

const require = createRequire(import.meta.url);
const { load } = require("js-yaml");
const { NsisScriptGenerator } = require("app-builder-lib/out/targets/nsis/nsisScriptGenerator.js");
const { nsisTemplatesDir } = require("app-builder-lib/out/targets/nsis/nsisUtil.js");
const { getMakeNsisPath, getNsisPluginsPath } = require("app-builder-lib/out/toolsets/windows.js");
const repo = resolve(import.meta.dirname, "..");
const config = load(await readFile(join(repo, "electron-builder.yml"), "utf8"));
// Use the same resolvers/options as packaging. This honours custom cache/toolset
// locations and avoids guessing versioned extraction-folder names in the cache.
const [compiler, plugins] = await Promise.all([
  getMakeNsisPath(config.toolsets?.nsis, config.nsis?.customNsisBinary),
  getNsisPluginsPath(config.toolsets?.nsis, config.nsis?.customNsisResources),
]);
const temporaryRoot = await realpath(tmpdir());
const prefix = "adcode-visible-update-probe-";
const directory = await mkdtemp(join(temporaryRoot, prefix));
const installer = join(directory, "installer.exe");
const marker = join(directory, "reopen.exe");
const launched = join(directory, "launched.txt");
const through = join(directory, "fell-through.txt");
const state = join(directory, "state.txt");
const scriptFile = join(directory, "probe.nsi");
const activeChildren = new Set();
let interrupted = false;
const nsisQuote = value => value.replaceAll("$", "$$").replaceAll('"', '$\\"');
const powershellQuote = value => "'" + value.replaceAll("'", "''") + "'";
const csharpQuote = value => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

function stopOwnedChildren() {
  // Only handles returned by this script's spawn call; no name-based process kill.
  for (const child of activeChildren) child.kill();
}
const interrupt = () => { interrupted = true; stopOwnedChildren(); process.exitCode = 1; };
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

async function runProbe(name, args) {
  if (interrupted) throw new Error("Update installer probe interrupted.");
  return new Promise((accept, reject) => {
    const child = spawn(installer, args, { stdio: "ignore", windowsHide: false });
    activeChildren.add(child);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 15_000);
    child.once("error", error => {
      clearTimeout(timer);
      activeChildren.delete(child);
      reject(error);
    });
    child.once("close", code => {
      clearTimeout(timer);
      activeChildren.delete(child);
      if (timedOut) reject(new Error(`${name}: installer needed an extra action or did not exit within 15 seconds.`));
      else accept(code);
    });
  });
}

async function expectMarker() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { return await readFile(launched, "utf8"); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      await new Promise(accept => setTimeout(accept, 50));
    }
  }
  throw new Error("The installer did not reopen the marker app.");
}

async function resetMarkers() {
  await Promise.all([launched, through, state].map(file => rm(file, { force: true })));
}

function compile() {
  if (interrupted) throw new Error("Update installer probe interrupted.");
  execFileSync(compiler.path, ["/V2", scriptFile], {
    env: { ...process.env, ...compiler.env },
    stdio: "pipe",
    windowsHide: true,
    timeout: 90_000,
  });
}

try {
  const source = `using System; using System.IO; public class Probe { [STAThread] public static void Main(string[] args) { File.WriteAllText("${csharpQuote(launched)}", string.Join("|", args)); } }`;
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `Add-Type -TypeDefinition ${powershellQuote(source)} -OutputAssembly ${powershellQuote(marker)} -OutputType WindowsApplication`],
  { stdio: "pipe", windowsHide: true, timeout: 90_000 });

  const header = new NsisScriptGenerator();
  header.addIncludeDir(nsisTemplatesDir);
  header.addIncludeDir(join(nsisTemplatesDir, "include"));
  header.addPluginDir("x86-unicode", join(plugins, "x86-unicode"));
  header.include(join(nsisTemplatesDir, "include", "StdUtils.nsh"));
  header.flags(["updated", "force-run", "allusers", "currentuser"]);
  const stockMode = await readFile(join(nsisTemplatesDir, "multiUserUi.nsh"), "utf8");
  const langNames = [...new Set([...stockMode.matchAll(/\$\(([\w]+)\)/g)].map(match => match[1]))];
  const makeScript = withMode => [
    "Unicode true", "RequestExecutionLevel user", `OutFile "${nsisQuote(installer)}"`,
    `InstallDir "${nsisQuote(join(directory, "installed"))}"`,
    '!define PRODUCT_NAME "ADCode update probe"', '!define PRODUCT_FILENAME "Probe"', '!define VERSION "0.0.0"',
    header.build(), '!include "common.nsh"', '!include "MUI2.nsh"', "Var launchLink",
    "Var installMode", "Var hasPerUserInstallation", "Var hasPerMachineInstallation",
    "Var perUserInstallationFolder", "Var perMachineInstallationFolder",
    // Scope setters intentionally contain no real registry or installation work.
    "!macro setInstallModePerUser", ' StrCpy $installMode "CurrentUser"', "!macroend",
    "!macro setInstallModePerAllUsers", ' StrCpy $installMode "all"', "!macroend",
    `!include "${nsisQuote(join(repo, "build", "update-installer.nsh"))}"`,
    ...(withMode ? [] : ["!define INSTALL_MODE_PER_ALL_USERS"]),
    // Include the real assisted finish function/page rather than a standalone
    // StartApp macro. Production also expands the same-named stock macro below.
    '!include "assistedInstaller.nsh"', '!insertmacro MUI_LANGUAGE "English"',
    ...langNames.map(name => `LangString ${name} \${LANG_ENGLISH} "${name}"`),
    "Function .onInit", ' StrCpy $installMode "CurrentUser"', ' StrCpy $hasPerUserInstallation "1"',
    ' StrCpy $hasPerMachineInstallation "0"', " !insertmacro customInit", "FunctionEnd",
    "Section", ` StrCpy $launchLink "${nsisQuote(marker)}"`, ' SetOutPath "$INSTDIR"',
    ' System::Call "user32::IsWindowVisible(p $HWNDPARENT) i.r0"',
    ` FileOpen $1 "${nsisQuote(state)}" w`, ' FileWrite $1 "$0|$installMode"', " FileClose $1",
    " Sleep 350", " !insertmacro customInstall",
    ` FileOpen $0 "${nsisQuote(through)}" w`, ' FileWrite $0 "fell through"', " FileClose $0",
    " !insertmacro quitSuccess", "SectionEnd",
    // Compile the production stock silent-finish path as well. It need not run
    // in this marker fixture, but its macro expansion must coexist with our hook.
    // Inserting StartApp in the hook used to declare startAppArgs twice here.
    "Function ProbeStockSilentFinish", " ${if} ${isForceRun}", " ${andIf} ${Silent}",
    "  HideWindow", "  !insertmacro StartApp", " ${endif}", "FunctionEnd",
  ].join("\n");
  const results = [];
  await writeFile(scriptFile, makeScript(false));
  compile();
  for (const [name, args, expectLaunch, visible] of [
    ["explicit-visible", ["--updated", "--force-run"], true, true],
    ["automatic-silent", ["--updated", "/S"], false, false],
    ["updated-visible-without-force", ["--updated"], false, true],
    ["fresh-visible", [], false, true],
    ["force-visible-without-update", ["--force-run"], false, true],
    ["older-version-explicit-silent", ["--updated", "--force-run", "/S"], true, true],
    ["fresh-silent", ["/S"], false, false],
    ["force-silent-without-update", ["--force-run", "/S"], false, false],
  ]) {
    await resetMarkers();
    assert.equal(await runProbe(name, args), 0, name);
    if (expectLaunch) {
      assert.equal(await expectMarker(), "--updated", name);
      await assert.rejects(readFile(through), { code: "ENOENT" });
    } else {
      assert.equal(await readFile(through, "utf8"), "fell through", name);
      await assert.rejects(readFile(launched), { code: "ENOENT" });
    }
    assert.equal(await readFile(state, "utf8"), `${visible ? 1 : 0}|CurrentUser`, name);
    results.push({ name, launches: expectLaunch, visible, passed: true });
  }

  // Compile the actual stock assisted installation-mode page too. Explicit
  // updates must pass it without presenting an extra setup choice.
  await writeFile(scriptFile, makeScript(true));
  compile();
  for (const args of [["--updated", "--force-run"], ["--updated", "--force-run", "/S"]]) {
    const name = `stock-mode-page-${args.includes("/S") ? "older-silent" : "visible"}`;
    await resetMarkers();
    assert.equal(await runProbe(name, args), 0, name);
    assert.equal(await readFile(state, "utf8"), "1|CurrentUser", name);
    assert.equal(await expectMarker(), "--updated", name);
    results.push({ name, launches: true, visible: true, passed: true });
  }
  assert.equal(activeChildren.size, 0);
  // Verify the final absolute deletion target is exactly this mkdtemp child.
  const cleanupTarget = await realpath(directory);
  assert.equal(dirname(cleanupTarget), temporaryRoot);
  assert.ok(basename(cleanupTarget).startsWith(prefix));
  assert.equal(cleanupTarget, directory);
  await rm(cleanupTarget, { recursive: true, maxRetries: 3, retryDelay: 250 });
  console.log(JSON.stringify({ compiler: compiler.path, results, temporaryFilesRemoved: true }, null, 2));
} catch (error) {
  stopOwnedChildren();
  console.error(`Update installer probe failed; its isolated diagnostics remain in ${directory}`);
  throw error;
} finally {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
