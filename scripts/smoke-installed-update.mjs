#!/usr/bin/env node
/**
 * A real installed v2.4.0 -> release-candidate update, on a disposable Windows runner.
 * Never run an installer or stop ADCode on a developer's computer. The guard is before
 * every mutation. This deliberately exercises the old /S --updated --force-run caller.
 * Canonical release assets stay untouched; only the baseline's owned feed is redirected.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer as createPortServer } from "node:net";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { verifyUpdateArtifacts } from "./release-artifacts.mjs";
import { startSmokeBackend } from "./smoke-backend.mjs";

if (process.argv.includes("--help")) {
  console.log("Usage: node scripts/smoke-installed-update.mjs <verified Windows asset directory>\nRequires an empty, GitHub-hosted Windows runner. Installs published v2.4.0 and updates it through the real updater.");
  process.exit(0);
}
if (process.platform !== "win32" || process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_ENVIRONMENT !== "github-hosted" || !process.env.RUNNER_TEMP) {
  throw new Error("Installed-update acceptance is restricted to disposable GitHub-hosted Windows runners. No changes made.");
}
const baselineVersion = "2.4.0";
const repo = resolve(import.meta.dirname, "..");
const version = JSON.parse(await readFile(join(repo, "package.json"), "utf8")).version;
if (version === baselineVersion) throw new Error("Prepare a newer release version before testing the v2.4.0 update.");
const assets = resolve(process.argv[2] ?? "dist");
await verifyUpdateArtifacts(assets, version, "windows");
const psQuote = value => `'${String(value).replaceAll("'", "''")}'`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run(executable, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, ...options });
    let output = "";
    child.stdout?.on("data", data => { output += data; });
    child.stderr?.on("data", data => { output += data; });
    child.once("error", reject);
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${basename(executable)} timed out`)); }, options.timeout ?? 180_000);
    child.once("close", code => { clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(new Error(`${basename(executable)} exited ${code}: ${output.slice(-4000)}`)); });
  });
}
async function powershell(source) {
  return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(`$ErrorActionPreference='Stop'\n${source}`, "utf16le").toString("base64")]);
}
// Default userData belongs to this ephemeral account. Using its normal location also
// tests a stock installer relaunch, which intentionally passes only --updated.
const profile = join(process.env.APPDATA ?? "", "ADCode");
if (!process.env.APPDATA || !process.env.LOCALAPPDATA) throw new Error("Runner profile locations unavailable.");
if (await powershell("@(Get-Process -Name ADCode -ErrorAction SilentlyContinue).Count") !== "0") throw new Error("ADCode already runs on this runner; refusing to install or stop it.");
if (await access(profile).then(() => true, () => false)) throw new Error("Runner already has an ADCode profile; refusing to use it.");
const existingInstallations = await powershell(`$keys=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'); @($keys | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { Get-ChildItem -LiteralPath $_ } | Get-ItemProperty | Where-Object { $_.DisplayName -match '^ADCode(?:\\s|$)' }).Count`);
if (existingInstallations !== "0") throw new Error("Runner already has an ADCode installation; refusing to replace it.");
const root = await mkdtemp(join(resolve(process.env.RUNNER_TEMP), "adcode-installed-update-"));
const install = join(root, "application");
const executable = join(install, "ADCode.exe");
const baseline = join(root, "baseline");
const cacheName = `adcode-ci-updater-${randomUUID()}`;
const cache = join(process.env.LOCALAPPDATA, cacheName);
const marker = `installed-update-${randomUUID()}`;
const firewallRule = `ADCode CI update ${marker}`;
await mkdir(baseline);
await mkdir(profile);
await writeFile(join(profile, "update-acceptance-marker.txt"), marker);
await writeFile(join(profile, "settings.json"), JSON.stringify({ version: 1, values: { "adcode.updates.auto": false, "adcode.updates.announce": true } }));
const log = join(profile, "logs", "debug.log");
let backend, feed, socket, child, watcher;
let firewallAdded = false;
let originalFirewallProfiles = null;
let firewallProfilesMayHaveChanged = false;
const checks = {};
// Windows VERSIONINFO can append a fourth zero to the three-part package version.
// The startup log independently confirms Electron's exact app.getVersion().
const matchesInstalledVersion = observed => [version, `${version}.0`].includes(observed?.split("+")[0]);
const report = (name, value) => { checks[name] = value; console.log(`${name}: ${JSON.stringify(value)}`); };
const watcherLog = join(root, "update-windows.jsonl");
const stopFile = join(root, "stop-watcher");
const requests = [];
try {
  await run("gh.exe", ["release", "download", `v${baselineVersion}`, "--repo", "bluethenics/adcode", "--dir", baseline, "--pattern", "latest.yml", "--pattern", "ADCode-Setup-x64.exe", "--pattern", "ADCode-Setup-x64.exe.blockmap"]);
  await verifyUpdateArtifacts(baseline, baselineVersion, "windows");
  // Block this owned app's non-loopback traffic even if Shell's relaunch drops the
  // mock-backend environment. This rule does not affect gh, Node or other runner tools.
  originalFirewallProfiles = JSON.parse(await powershell("@(Get-NetFirewallProfile | ForEach-Object { @{ Name=$_.Name; Enabled=$_.Enabled.ToString() } }) | ConvertTo-Json -Compress"));
  if (!Array.isArray(originalFirewallProfiles) || originalFirewallProfiles.length !== 3 || new Set(originalFirewallProfiles.map(item => item.Name)).size !== 3 || originalFirewallProfiles.some(item => !["Domain", "Private", "Public"].includes(item.Name) || !["True", "False"].includes(item.Enabled))) throw new Error("Unexpected runner firewall profile state; refusing to change it.");
  firewallAdded = true;
  await powershell(`New-NetFirewallRule -DisplayName ${psQuote(firewallRule)} -Direction Outbound -Action Block -Program ${psQuote(executable)} -RemoteAddress '0.0.0.0-126.255.255.255','128.0.0.0-255.255.255.255','::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff' -Profile Any | Out-Null`);
  // A hosted image may start with disabled profiles. Enable those for the lifetime
  // of this app-only rule, retaining their exact states for unconditional restoration.
  firewallProfilesMayHaveChanged = true;
  for (const profileState of originalFirewallProfiles.filter(item => item.Enabled === "False")) await powershell(`Set-NetFirewallProfile -Name ${psQuote(profileState.Name)} -Enabled True`);
  if (await powershell("@((Get-NetFirewallProfile) | Where-Object { $_.Enabled.ToString() -ne 'True' }).Count") !== "0" || await powershell("(Get-Service -Name MpsSvc).Status.ToString()") !== "Running") throw new Error("Runner firewall profiles/service are not active; refusing app startup.");
  await run(join(baseline, "ADCode-Setup-x64.exe"), ["/S", `/D=${install}`]);
  await access(executable);
  report("baselineInstalled", true);
  backend = await startSmokeBackend();
  const allowed = new Map(["latest.yml", "ADCode-Setup-x64.exe", "ADCode-Setup-x64.exe.blockmap"].map(name => [name, join(assets, name)]));
  feed = createServer(async (request, response) => {
    try {
      const name = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname.slice(1));
      const file = allowed.get(name);
      if (!file || !["GET", "HEAD"].includes(request.method)) { response.writeHead(404).end(); return; }
      const size = (await stat(file)).size;
      requests.push({ name, method: request.method, range: request.headers.range ?? null });
      const range = request.headers.range;
      if (range && !/^bytes=\d+-\d*$/.test(range)) { response.writeHead(416).end(); return; }
      let start = 0, end = size - 1;
      if (range) { const match = /^bytes=(\d+)-(\d*)$/.exec(range); start = Number(match[1]); end = match[2] ? Number(match[2]) : end; }
      if (start > end || end >= size) { response.writeHead(416).end(); return; }
      response.writeHead(range ? 206 : 200, { "Content-Length": end - start + 1, "Content-Type": name.endsWith(".yml") ? "text/yaml" : "application/octet-stream", "Accept-Ranges": "bytes", ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}) });
      if (request.method === "HEAD") response.end();
      else createReadStream(file, { start, end }).on("error", () => response.destroy()).pipe(response);
    } catch { response.writeHead(500).end(); }
  });
  await new Promise(resolve => feed.listen(0, "127.0.0.1", resolve));
  const updateConfig = join(install, "resources", "app-update.yml");
  let baselineConfig = await readFile(updateConfig, "utf8");
  if (!/^provider:\s*github\s*$/m.test(baselineConfig)) throw new Error("Unexpected baseline provider configuration.");
  // Retain publisherName/signature settings and every other guard from the real
  // installed baseline. Only its provider, URL and unique cache location change.
  baselineConfig = baselineConfig.replace(/^provider:.*$/m, "provider: generic").replace(/^url:.*\r?\n?/m, "").replace(/^updaterCacheDirName:.*\r?\n?/m, "");
  await writeFile(updateConfig, `${baselineConfig.trimEnd()}\nurl: http://127.0.0.1:${feed.address().port}\nupdaterCacheDirName: ${cacheName}\n`);
  const portServer = createPortServer();
  await new Promise(resolve => portServer.listen(0, "127.0.0.1", resolve));
  const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  const env = { ...process.env, ...backend.env, ADCODE_USER_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ADCODE_DISABLE_UPDATES;
  delete env.ADCODE_UPDATE_SIMULATE;
  delete env.PORTABLE_EXECUTABLE_DIR;
  child = spawn(executable, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--disable-renderer-backgrounding"], { env, cwd: repo, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let appOutput = "";
  child.stdout.on("data", chunk => { appOutput += chunk; });
  child.stderr.on("data", chunk => { appOutput += chunk; });
  let target;
  for (let attempt = 0; attempt < 120 && !target; attempt++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === "page" && item.webSocketDebuggerUrl); } catch { /* Startup. */ }
    if (!target) await sleep(500);
  }
  if (!target) throw new Error(`Baseline renderer unavailable: ${appOutput.slice(-2000)}`);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", event => { const message = JSON.parse(event.data); const accept = pending.get(message.id); if (accept) { pending.delete(message.id); accept(message); } });
  async function evaluate(expression) {
    const request = ++id;
    let timer;
    try {
      const result = await Promise.race([new Promise(resolve => { pending.set(request, resolve); socket.send(JSON.stringify({ id: request, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } })); }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Renderer evaluation timed out")), 15_000); })]);
      if (result.error || result.result?.exceptionDetails) throw new Error(JSON.stringify(result.error ?? result.result.exceptionDetails));
      return result.result?.result?.value;
    } finally { clearTimeout(timer); pending.delete(request); }
  }
  for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate("Boolean(window.adcode?.updates && document.body.dataset.sessionReady === 'true')")) break; await sleep(300); }
  const info = await evaluate("window.adcode.app.info()");
  report("actualBaselineVersion", info?.version === baselineVersion);
  if (!checks.actualBaselineVersion) throw new Error("The installed baseline version is wrong.");
  await evaluate("window.adcode.settings.write('adcode.updates.announce', false)");
  if (!(await readFile(log, "utf8")).includes(`Started ADCode ${baselineVersion}`)) throw new Error("Baseline did not use the isolated runner profile.");
  const beforeSettings = JSON.parse(await readFile(join(profile, "settings.json"), "utf8"));
  report("baselineProfileConfirmed", beforeSettings.values["adcode.updates.announce"] === false && backend.server.signUpCount() > 0);
  if (!checks.baselineProfileConfirmed) throw new Error("Baseline profile/backend isolation failed.");
  await evaluate("window.adcode.updates.check()");
  let state;
  for (let attempt = 0; attempt < 360; attempt++) {
    state = await evaluate("window.adcode.updates.status()");
    if (state?.state === "ready" || state?.state === "failed") break;
    await sleep(500);
  }
  report("realDownloadReady", state?.state === "ready" && state?.version === version);
  if (!checks.realDownloadReady) throw new Error(`Real updater did not download candidate: ${JSON.stringify(state)}\n${(await readFile(log, "utf8")).slice(-6000)}`);

  // Native observation is independent of the renderer that is about to close. It records
  // a visible NSIS progress control and the new installed app's visible main window.
  const monitor = join(root, "watch-update.ps1");
  await writeFile(monitor, `$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public class UpdateWindows {
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder b, int n);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static void Watch(string output, string stop, string install, string cache, int oldPid) {
    var seen = new HashSet<string>();
    var end = DateTime.UtcNow.AddMinutes(5);
    File.AppendAllText(output, "{\\"ready\\":true}\\n");
    while (!File.Exists(stop) && DateTime.UtcNow < end) {
      EnumWindows((h,p) => {
        if (!IsWindowVisible(h)) return true;
        uint pid; GetWindowThreadProcessId(h, out pid);
        try {
          var process = Process.GetProcessById((int)pid);
          string path = process.MainModule.FileName;
          bool progress = false; int position = -1;
          EnumChildWindows(h, (c,q) => { var name = new StringBuilder(256); GetClassName(c,name,256); if (name.ToString() == "msctls_progress32" && IsWindowVisible(c)) { progress = true; position = SendMessage(c,0x408,IntPtr.Zero,IntPtr.Zero).ToInt32(); } return true; }, IntPtr.Zero);
          if (path.StartsWith(cache + "\\\\", StringComparison.OrdinalIgnoreCase)) {
            string key = "installer:" + pid + ":" + position;
            if (progress && seen.Add(key)) File.AppendAllText(output, "{\\"installerPid\\":" + pid + ",\\"progressVisible\\":true,\\"position\\":" + position + "}\\n");
          } else if (progress && seen.Add("unowned-progress:" + pid)) {
            string encodedPath = Convert.ToBase64String(Encoding.UTF8.GetBytes(path));
            File.AppendAllText(output, "{\\"unownedProgressPid\\":" + pid + ",\\"pathBase64\\":\\"" + encodedPath + "\\"}\\n");
          }
          if (String.Equals(path,install,StringComparison.OrdinalIgnoreCase) && pid != oldPid) {
            string key = "app:" + pid;
            string version = process.MainModule.FileVersionInfo.ProductVersion;
            if (seen.Add(key)) File.AppendAllText(output, "{\\"newAppPid\\":" + pid + ",\\"version\\":\\"" + version + "\\",\\"windowVisible\\":true}\\n");
          }
        } catch { }
        return true;
      }, IntPtr.Zero);
      Thread.Sleep(25);
    }
  }
}
'@
[UpdateWindows]::Watch(${psQuote(watcherLog)},${psQuote(stopFile)},${psQuote(executable)},${psQuote(cache)},${child.pid})
`);
  watcher = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", monitor], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let watcherErrors = "";
  watcher.stderr.on("data", data => { watcherErrors += data; });
  for (let attempt = 0; attempt < 100; attempt++) { if (await access(watcherLog).then(() => true, () => false)) break; if (watcher.exitCode !== null) throw new Error(`Native watcher failed: ${watcherErrors}`); await sleep(100); }
  if (!(await readFile(watcherLog, "utf8")).includes('"ready":true')) throw new Error("Native watcher did not start.");
  // Same trusted preload method called by the real Update button; no updater simulation,
  // direct NSIS invocation, integrity bypass or production fuse changes.
  void evaluate("window.adcode.updates.install()").catch(() => {});
  const deadline = Date.now() + 240_000;
  let observations = [];
  let afterLog = "";
  while (Date.now() < deadline) {
    // File reads can race the native writer between bytes of its final line.
    observations = (await readFile(watcherLog, "utf8")).split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    afterLog = await readFile(log, "utf8").catch(() => "");
    if (child.exitCode !== null && observations.some(item => item.newAppPid && matchesInstalledVersion(item.version)) && afterLog.includes(`Started ADCode ${version}`)) break;
    await sleep(300);
  }
  report("oldAppExited", child.exitCode !== null);
  report("installerProgressVisible", observations.some(item => item.progressVisible));
  report("installerProgressAdvanced", observations.some(item => item.progressVisible && item.position > 0));
  report("oneVisibleInstallerObserved", new Set(observations.filter(item => item.installerPid).map(item => item.installerPid)).size === 1);
  report("updatedAppReopened", observations.some(item => item.newAppPid && item.windowVisible && matchesInstalledVersion(item.version)));
  report("updatedProfileStarted", afterLog.includes(`Started ADCode ${version}`));
  report("profileMarkerPreserved", (await readFile(join(profile, "update-acceptance-marker.txt"), "utf8")) === marker);
  report("savedPreferencePreserved", JSON.parse(await readFile(join(profile, "settings.json"), "utf8")).values["adcode.updates.announce"] === false);
  report("canonicalInstallerRequested", requests.some(item => item.name === "ADCode-Setup-x64.exe" && item.method === "GET"));
  await writeFile(join(root, "acceptance-result.json"), JSON.stringify({ version, baselineVersion, checks, observations, requests }, null, 2));
  console.log(`Acceptance evidence: ${join(root, "acceptance-result.json")}`);
  if (Object.values(checks).some(value => value !== true)) throw new Error("Installed update acceptance failed; inspect the checks and native observations.");
} catch (error) {
  console.error(`Installed-update failure: ${error.message}`);
  console.error(`Updater log tail:\n${(await readFile(log, "utf8").catch(() => "(not created)")).slice(-8000)}`);
  console.error(`Native observations:\n${(await readFile(watcherLog, "utf8").catch(() => "(not created)")).slice(-4000)}`);
  throw error;
} finally {
  const cleanupFailures = [];
  const cleanupFailure = message => { cleanupFailures.push(message); console.error(message); };
  socket?.close();
  await writeFile(stopFile, "stop").catch(() => {});
  // Kill only executables in the CI-owned install or unique updater cache; never names
  // alone. A separate preflight refused to touch any existing ADCode process/profile.
  await powershell(`$roots=@(${psQuote(install + "\\")},${psQuote(cache + "\\")}); $isOwned={ $p=$_.ExecutablePath; $p -and ($roots | Where-Object { $p.StartsWith($_,[StringComparison]::OrdinalIgnoreCase) }) }; $owned=@(Get-CimInstance Win32_Process | Where-Object $isOwned); foreach ($ownedProcess in $owned) { Stop-Process -Id $ownedProcess.ProcessId -Force -ErrorAction SilentlyContinue; Wait-Process -Id $ownedProcess.ProcessId -Timeout 15 -ErrorAction SilentlyContinue }; if (@(Get-CimInstance Win32_Process | Where-Object $isOwned).Count -ne 0) { throw 'A CI-owned app or installer did not stop' }`).catch(error => cleanupFailure(`Owned-process cleanup: ${error.message}`));
  watcher?.kill();
  if (firewallAdded) await powershell(`Get-NetFirewallRule -DisplayName ${psQuote(firewallRule)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule`).catch(error => cleanupFailure(`Firewall cleanup: ${error.message}`));
  if (firewallProfilesMayHaveChanged) {
    // Restore every profile independently even if enabling only partly succeeded or
    // another restoration fails. These are original captured enum values, not inputs.
    for (const profileState of originalFirewallProfiles) await powershell(`Set-NetFirewallProfile -Name ${psQuote(profileState.Name)} -Enabled ${profileState.Enabled}`).catch(error => cleanupFailure(`Restore ${profileState.Name} firewall profile: ${error.message}`));
    try {
      const restored = JSON.parse(await powershell("@(Get-NetFirewallProfile | ForEach-Object { @{ Name=$_.Name; Enabled=$_.Enabled.ToString() } }) | ConvertTo-Json -Compress"));
      if (!originalFirewallProfiles.every(before => restored.some(after => after.Name === before.Name && after.Enabled === before.Enabled))) throw new Error("Restored profile values differ from their original values");
    } catch (error) { cleanupFailure(`Verify firewall restoration: ${error.message}`); }
  }
  if (feed) await new Promise(resolve => feed.close(resolve));
  await backend?.server.close();
  // Evidence and the installed fixture remain on this disposable runner for diagnosis.
  // No recursive delete, real profile cleanup or unrelated registry operations.
  if (cleanupFailures.length) throw new Error(`Installed-update cleanup failed: ${cleanupFailures.join("; ")}`);
}
