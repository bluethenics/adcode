import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { answerPreviewRequest, liveServerStatus, setPreviewAppOrigin, setPreviewReloadSink, startLiveServer, stopLiveServer, WEB_RELOAD_SCRIPT } from "../src/browserHost/liveServer.ts";
import { mkdirSync, writeFileSync } from "../src/browserHost/shims/vfs.ts";
import * as origin from "../src/web/previewOrigin.ts";

/*
 * The web version's live preview (2026-11-22): a Service Worker on `preview.<app host>` asks the
 * browser host for each file, which answers from memory (src/browserHost/liveServer.ts).
 */

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const ROOT = "/home/adcode/projects/bakery";

function project(): void {
  mkdirSync(`${ROOT}/css`, { recursive: true });
  mkdirSync(`${ROOT}/notes`, { recursive: true });
  writeFileSync(`${ROOT}/index.html`, "<html><body><h1>Bakery</h1></body></html>");
  writeFileSync(`${ROOT}/style.css`, "h1 { color: rgb(1, 2, 3); }");
  writeFileSync(`${ROOT}/css/site.css`, "body { margin: 0; }");
  writeFileSync(`${ROOT}/logo.png`, new Uint8Array([137, 80, 78, 71]));
  writeFileSync(`${ROOT}/notes/todo.txt`, "bake");
  writeFileSync(`${ROOT}/.env`, "SECRET=1");
}

afterEach(async () => {
  vi.useRealTimers();
  await stopLiveServer();
});

describe("the preview origin", () => {
  it("is preview.<the app's host>, and back", () => {
    expect(origin.previewOriginFor("https://web.bluethenics.com")).toBe("https://preview.web.bluethenics.com");
    expect(origin.previewOriginFor("http://localhost:5193")).toBe("http://preview.localhost:5193");
    expect(origin.appOriginFor("https://preview.web.bluethenics.com")).toBe("https://web.bluethenics.com");
    expect(origin.appOriginFor("http://preview.localhost:5193")).toBe("http://localhost:5193");
    expect(origin.appOriginFor("https://web.bluethenics.com")).toBeNull();
    expect(origin.previewUrlFor("https://web.bluethenics.com", "/home/adcode/projects/my site/")).toBe("https://preview.web.bluethenics.com/preview/my%20site/");
  });

  it("names the same paths and messages in the Service Worker and the bridge as previewOrigin.ts", () => {
    const worker = readFileSync(resolve(import.meta.dirname, "../src/web/preview/serviceWorker.ts"), "utf8");
    const bridge = readFileSync(resolve(import.meta.dirname, "../src/web/preview/bridge.ts"), "utf8");
    const restated = (source: string, name: string): string | undefined => new RegExp(`const ${name} = "([^"]+)"`).exec(source)?.[1];
    expect(restated(worker, "BRIDGE_PATH")).toBe(origin.PREVIEW_BRIDGE_PATH);
    expect(restated(worker, "WORKER_PATH")).toBe(origin.PREVIEW_WORKER_PATH);
    expect(restated(worker, "REQUEST")).toBe(origin.PREVIEW_REQUEST);
    expect(restated(bridge, "BRIDGE_PATH")).toBe(origin.PREVIEW_BRIDGE_PATH);
    expect(restated(bridge, "WORKER_PATH")).toBe(origin.PREVIEW_WORKER_PATH);
    expect(restated(bridge, "RELOAD_CHANNEL")).toBe(origin.PREVIEW_RELOAD_CHANNEL);
    expect(restated(bridge, "REQUEST")).toBe(origin.PREVIEW_REQUEST);
    expect(restated(bridge, "READY")).toBe(origin.PREVIEW_BRIDGE_READY);
    expect(restated(bridge, "RELOAD")).toBe(origin.PREVIEW_RELOAD);
    expect(origin.PREVIEW_BRIDGE_HTML).toContain(`src="${origin.PREVIEW_BRIDGE_SCRIPT_PATH}"`);
    // They are built as classic scripts: the one export is the line the build strips.
    for (const source of [worker, bridge]) {
      expect(source).not.toMatch(/^\s*import\b/m);
      expect(source.match(/^export\b.*$/gm)).toEqual(["export {};"]);
    }
  });
});

describe("serving a project from the browser host's files", () => {
  it("starts on the preview origin and answers with the project's files", async () => {
    setPreviewAppOrigin("https://web.bluethenics.com");
    project();
    const status = await startLiveServer(ROOT);
    expect(status).toMatchObject({ running: true, mode: "static", root: ROOT, url: "https://preview.web.bluethenics.com/preview/bakery/", error: null });
    expect(liveServerStatus().running).toBe(true);

    const page = answerPreviewRequest("/preview/bakery/");
    expect(page).toMatchObject({ status: 200, contentType: "text/html; charset=utf-8", active: true });
    expect(decode(page.body)).toContain("<h1>Bakery</h1>");
    // The reload rides a BroadcastChannel, not the desktop's EventSource to a server.
    expect(decode(page.body)).toContain(WEB_RELOAD_SCRIPT);
    expect(decode(page.body)).not.toContain("EventSource");

    expect(answerPreviewRequest("/preview/bakery/css/site.css?v=2")).toMatchObject({ status: 200, contentType: "text/css; charset=utf-8" });
    expect([...answerPreviewRequest("/preview/bakery/logo.png").body]).toEqual([137, 80, 78, 71]);
    // A root-relative link resolves against the project, as on the desktop's server.
    expect(decode(answerPreviewRequest("/style.css").body)).toContain("rgb(1, 2, 3)");
  });

  it("redirects folders to their slash, lists a folder with no index, and refuses what is not the page's", async () => {
    project();
    await startLiveServer(ROOT);
    expect(answerPreviewRequest("/preview/bakery")).toMatchObject({ status: 301, location: "/preview/bakery/" });
    expect(answerPreviewRequest("/preview/bakery/notes")).toMatchObject({ status: 301, location: "/preview/bakery/notes/" });
    expect(decode(answerPreviewRequest("/preview/bakery/notes/").body)).toContain("todo.txt");
    expect(answerPreviewRequest("/preview/bakery/missing.js")).toMatchObject({ status: 404, active: true });
    expect(answerPreviewRequest("/preview/bakery/.env")).toMatchObject({ status: 404 });
    expect(decode(answerPreviewRequest("/preview/bakery/").body)).toContain("Bakery");
    expect(answerPreviewRequest("/preview/bakery/%2e%2e/%2e%2e/.adcode/settings.json")).toMatchObject({ status: 404 });
    expect(answerPreviewRequest("/preview/bakery/..%2F..%2Fsecret")).toMatchObject({ status: 403 });
    expect(answerPreviewRequest("/preview/other/")).toMatchObject({ status: 404, active: false });
    expect(answerPreviewRequest("/preview/bakery/%E0%A4%A")).toMatchObject({ status: 400 });
  });

  it("answers nothing once stopped", async () => {
    project();
    await startLiveServer(ROOT);
    await stopLiveServer();
    expect(answerPreviewRequest("/preview/bakery/")).toMatchObject({ status: 404, active: false });
    expect((await startLiveServer(null)).error).toContain("Open a folder first");
  });

  it("asks for one reload per burst of changes inside the project, and none for files elsewhere", async () => {
    vi.useFakeTimers();
    project();
    const reloads: string[] = [];
    setPreviewReloadSink((root) => reloads.push(root));
    await startLiveServer(ROOT);
    writeFileSync(`${ROOT}/index.html`, "<h1>Sourdough</h1>");
    writeFileSync(`${ROOT}/style.css`, "h1 { color: red; }");
    vi.advanceTimersByTime(200);
    expect(reloads).toEqual([ROOT]);
    mkdirSync("/home/adcode/projects/elsewhere", { recursive: true });
    writeFileSync("/home/adcode/projects/elsewhere/index.html", "x");
    vi.advanceTimersByTime(200);
    expect(reloads).toEqual([ROOT]);
    await stopLiveServer();
    writeFileSync(`${ROOT}/index.html`, "<h1>Rye</h1>");
    vi.advanceTimersByTime(200);
    expect(reloads).toEqual([ROOT]);
  });
});
