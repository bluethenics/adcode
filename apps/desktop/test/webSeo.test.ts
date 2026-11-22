import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { IndexHtmlTransformContext, Plugin, UserConfigFnObject } from "vite";
import webConfig from "../vite.web.config.ts";
import { WEB_APP_SCHEMA } from "../src/web/seo.ts";
import { WEB_APP_SCHEMA_CSP } from "../../cloud/src/seo.ts";

async function launchHtml(): Promise<string> {
  const config = (webConfig as UserConfigFnObject)({ mode: "production", command: "build" });
  const plugin = config.plugins?.find((candidate) => candidate !== null && typeof candidate === "object" && "name" in candidate && candidate.name === "adcode-web-entry") as Plugin;
  const hook = plugin.transformIndexHtml;
  if (hook === undefined || typeof hook === "function") throw new Error("Web entry transform missing");
  const html = readFileSync(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const transform = hook.handler as (html: string, context: IndexHtmlTransformContext) => unknown;
  const result = await transform(html, {} as IndexHtmlTransformContext);
  if (typeof result !== "string") throw new Error("Expected the browser HTML");
  return result;
}

describe("browser launch HTML", () => {
  // Live from 2026-11-22: production ships the app, running in the person's tab.
  it("ships the web app, with its introduction visible before any JavaScript runs", async () => {
    const html = await launchHtml();
    expect(html).toContain('<script type="module" src="/@web/boot.ts"></script>');
    expect(html).toContain("<h1>Build apps with AI in your browser</h1>");
    expect(html).toContain("Open a GitHub repository and the same assistant as the desktop app works on it right in this tab.");
    expect(html).not.toContain("The web version is paused");
    expect(html).not.toMatch(/cloud workspace/i);
  });

  it("describes the app for search and sharing, leaving the Worker to open the public root", async () => {
    const html = await launchHtml();
    expect(html).toContain("<title>ADCode Web — AI Code Editor in Your Browser</title>");
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" data-adcode-public-launch />');
    expect(html).toContain('<meta name="description" content="The ADCode assistant in your browser: open a GitHub repository');
    expect(html).toContain('<meta property="og:url" content="https://web.bluethenics.com/" />');
    expect(html).toContain('id="adcode-web-app-schema"');
  });

  it("allows exactly the published structured data under the app's strict CSP", () => {
    const digest = createHash("sha256").update(WEB_APP_SCHEMA).digest("base64");
    expect(WEB_APP_SCHEMA_CSP).toBe(`'sha256-${digest}'`);
  });

  it("retains useful public copy and the guide link after the real signed-out gate replaces the splash", () => {
    const require = createRequire(import.meta.url);
    const env = { ...process.env };
    delete env["ELECTRON_RUN_AS_NODE"];
    const run = spawnSync(require("electron") as string, [fileURLToPath(new URL("./fixtures/webLaunch.cjs", import.meta.url))], { env, encoding: "utf8", timeout: 30000, windowsHide: true });
    expect(run.status, run.stdout + run.stderr || String(run.error)).toBe(0);
    const line = run.stdout.split(/\r?\n/).find((entry) => entry.startsWith("WEB_LAUNCH_RESULTS="));
    expect(line, run.stdout).toBeDefined();
    const results = JSON.parse(line!.slice("WEB_LAUNCH_RESULTS=".length)) as Record<string, boolean>;
    expect(Object.keys(results)).toHaveLength(9);
    expect(Object.values(results).every(Boolean)).toBe(true);
  }, 35000);
});
