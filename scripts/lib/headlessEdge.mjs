/*
 * A headless Edge (or Chromium) driven over the DevTools protocol, for checking web pages.
 *
 * The in-app browser pane stops painting while it is hidden, so screenshots time out and
 * observers never fire; a headless browser launched from Node shows what a visitor sees. Used by
 * `scripts/smoke-web.mjs`.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATES = [
  process.env["ADCODE_BROWSER"],
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter((path) => typeof path === "string" && path.length > 0);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Edge may put a sync/sign-in dialog ahead of the launched tab in its target list. */
export function selectPageTarget(targets) {
  return targets.find((target) => target.type === "page" && target.url === "about:blank")
    ?? targets.find((target) => target.type === "page" && /^https?:\/\//.test(target.url));
}

/** `args`: extra browser switches, e.g. `--host-resolver-rules=MAP host address` to reach a site before DNS has. */
export async function launchBrowser({ port = 9473, width = 1280, height = 820, args = [] } = {}) {
  const executable = CANDIDATES.find((path) => existsSync(path));
  if (executable === undefined) throw new Error("No Edge or Chromium found; set ADCODE_BROWSER");
  const profile = mkdtempSync(join(tmpdir(), "adcode-headless-"));
  const child = spawn(executable, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync", `--window-size=${width},${height}`,
    ...args,
    "about:blank",
  ], { stdio: "ignore" });

  let targets = [];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (selectPageTarget(targets) !== undefined) break;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  // Keep this tab's own socket: an internal dialog appearing later cannot retarget it.
  const page = selectPageTarget(targets);
  if (page === undefined) throw new Error("The headless browser did not open a page");

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== undefined) {
      const wait = pending.get(message.id);
      pending.delete(message.id);
      if (message.error !== undefined) wait?.reject(new Error(message.error.message));
      else wait?.resolve(message.result);
    } else {
      for (const listener of listeners) listener(message);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  const consoleErrors = [];
  listeners.add((message) => {
    if (message.method === "Runtime.exceptionThrown") consoleErrors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? "exception");
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
    }
  });
  await send("Runtime.enable");
  await send("Page.enable");

  return {
    send,
    consoleErrors,
    async goto(url) {
      await send("Page.navigate", { url });
      await send("Page.bringToFront");
      await sleep(500);
    },
    async evaluate(expression, { awaitPromise = true, timeoutMs = 20_000 } = {}) {
      const result = await Promise.race([
        send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true }),
        sleep(timeoutMs).then(() => ({ timeout: true })),
      ]);
      if (result.timeout) throw new Error(`evaluate timed out: ${expression.slice(0, 80)}`);
      if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    },
    async waitFor(expression, { timeoutMs = 30_000, intervalMs = 250 } = {}) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        try {
          // Awaited first: `Boolean(promise)` is true at once, so a check written as a promise
          // (`window.adcode.ai.runs().then(...)`) used to pass without ever being looked at.
          if (await this.evaluate(`Promise.resolve(${expression}).then(Boolean)`, { timeoutMs: 5_000 })) return true;
        } catch {
          // page not ready
        }
        await sleep(intervalMs);
      }
      return false;
    },
    async viewport(width, height, mobile = false) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
      await send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
      // Headless Edge can leave the resize event queued until its next rendered frame.
      // Force that frame before callers measure responsive controls or click them.
      await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    },
    /** Any DevTools protocol call, for what the helpers above do not cover. */
    async cdp(method, params = {}) {
      return send(method, params);
    },
    async screenshot(path) {
      await send("Page.bringToFront");
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(path, Buffer.from(data, "base64"));
      return path;
    },
    async close() {
      try {
        socket.close();
      } catch {
        // already closed
      }
      child.kill();
      await sleep(300);
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        // Edge may still hold a file for a moment; the temp folder is cleaned eventually
      }
    },
  };
}
