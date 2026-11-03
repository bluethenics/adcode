/**
 * Exercises the actual admin preview component and official Imprezia SDK in a browser.
 * Set IMPREZIA_API_KEY to a sandbox publisher key, then run node scripts/demo-imprezia.mjs.
 * The key stays in the local API server. No handwritten provider ad or impression calls.
 * Set IMPREZIA_SDK_FIXTURE=1 for a deterministic local renderer check with labelled test data.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { createRequestHandler } from "../services/api/src/server.ts";
import { createMemoryStore } from "../services/api/src/memoryStore.ts";
import { encryptAdNetworkKey } from "../services/api/src/adNetworkCrypto.ts";
import { handleAdNetworkAdmin } from "../services/api/src/adNetworks.ts";

const fixture = process.env.IMPREZIA_SDK_FIXTURE === "1";
const key = process.env.IMPREZIA_API_KEY ?? (fixture ? "api_pub_sandbox_fixture" : undefined);
if (!key?.startsWith("api_pub_sandbox_")) throw new Error("Set IMPREZIA_API_KEY to a sandbox publisher key for this smoke test.");
const repo = resolve(import.meta.dirname, "..");
const require = createRequire(join(repo, "package.json"));
const { build } = require("esbuild");
const out = join(repo, "output", `imprezia-sdk-${new Date().toISOString().slice(0, 10)}${fixture ? "-fixture" : ""}`);
await mkdir(out, { recursive: true });
const store = createMemoryStore(), encryption = randomBytes(32).toString("base64");
// Previewing a disabled connection must not enable user traffic.
await store.adNetworks.put({ id: "imprezia", name: "Imprezia", provider: "imprezia", enabled: false, priority: 10,
  viewPayoutMicros: "0", clickPayoutMicros: "0", imprezia: { kind: "chat", id: "" } }, "demo", Date.now());
await store.adNetworks.putKey("imprezia", encryptAdNetworkKey("imprezia", key, encryption));
const calls = [];
const fetchImpl = async (input, init) => {
  const url = new URL(String(input));
  // An invariant, checked before any network request is allowed to leave this process.
  if (!/^\/v1\/(monetize|events)\//.test(url.pathname)) throw new Error("Only SDK routes are allowed in this test.");
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
  const response = fixture
    ? url.pathname === "/v1/monetize/append" ? Response.json({
      originalResponse: body.response, monetizedResponse: "${card-0}",
      linkData: { "card-0": { string_link_word: "SDK preview fixture", hyperlink: "https://imprezia.ai/", trackingId: "fixture-card",
        metadata: { brandCategory: "software", placementType: "uicard", impressionUuid: "fixture-impression",
          cardMetadata: { title: "SDK preview fixture", description: "Local rendering test data. No advertiser is billed.", brandName: "ADCode test", ctaText: "Learn more", adFormat: "UICARD_VERTICAL" } } } },
      metadata: { sessionId: body.sessionId, timestamp: new Date().toISOString(), requestId: "fixture", processingTime: 0 },
    }) : new Response(null, { status: 204 })
    : await fetch(input, init);
  let summary;
  if (url.pathname === "/v1/monetize/append") {
    const value = await response.clone().json();
    summary = { linkCount: Object.keys(value.linkData ?? {}).length, cardCount: Object.keys(value.linkData ?? {}).filter(key => key.startsWith("card-")).length };
  }
  calls.push({ method: init?.method, path: url.pathname, status: response.status,
    ...(body.sessionId ? { sessionId: body.sessionId, capabilities: body.sdkCapabilities } : {}), ...(summary ? { response: summary } : {}) });
  return response;
};
const runtime = { fetchImpl, encryptionKeys: () => [encryption] };
const prepared = await handleAdNetworkAdmin({ store, ...runtime, clock: { now: () => Date.now() }, ids: { next: () => "demo" } },
  "demo", "/v1/admin/ad-networks/imprezia/test", "POST", {});
if (prepared.status !== 200 || !prepared.body.sdk) throw new Error("Could not prepare the SDK preview.");

await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import Preview from './apps/web/src/components/ImpreziaSdkPreview.tsx';
    createRoot(document.getElementById('preview')).render(<React.StrictMode><Preview {...${JSON.stringify(prepared.body.sdk)}} /></React.StrictMode>);`,
    loader: "tsx", resolveDir: repo, sourcefile: "imprezia-sdk-preview.tsx" },
  bundle: true, platform: "browser", format: "iife", outfile: join(out, "preview.js"),
  alias: { react: join(repo, "node_modules/react"), "react-dom": join(repo, "node_modules/react-dom") },
  nodePaths: [join(repo, "apps/web/node_modules"), join(repo, "node_modules")],
  define: { "process.env.NODE_ENV": '"development"' },
});

const handle = createRequestHandler({ store, verifier: { async verify() { return null; } }, adNetworks: runtime });
const server = createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/preview.css"></head><body style="background:#15130f;color:#f5f0df;font-family:system-ui;padding:32px"><h1>Imprezia SDK preview</h1><div id="preview"></div><script src="/preview.js"></script></body></html>');
  } else if (req.url === "/preview.js" || req.url === "/preview.css") {
    void readFile(join(out, req.url.slice(1))).then(bytes => {
      res.writeHead(200, { "content-type": req.url.endsWith(".css") ? "text/css" : "application/javascript" }); res.end(bytes);
    }, () => { res.writeHead(404); res.end(); });
  } else if (req.url === "/favicon.ico") { res.writeHead(204); res.end(); }
  else void handle(req, res);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browserScript = join(out, "browser.cjs");
await writeFile(browserScript, `const {app,BrowserWindow,protocol,net}=require('electron');
const fs=require('node:fs/promises');
process.on('uncaughtException',e=>{console.error(e.message);app.exit(1);});
setTimeout(()=>{console.error('SDK browser smoke test timed out');app.exit(1);},60000);
app.whenReady().then(async()=>{
  // Map our own production origin to the local test server so the SDK sees the same
  // source URL as the shipped frame. All other HTTPS assets use their real origins.
  await protocol.handle('https',request=>{
    const url=new URL(request.url);
    if(url.origin==='https://adcode.bluethenics.com'){
      return net.fetch(process.env.ADCODE_IMPREZIA_PREVIEW_URL.slice(0,-1)+url.pathname+url.search,{method:request.method,headers:request.headers,body:request.method==='POST'?request.body:undefined,duplex:'half'});
    }
    return net.fetch(request,{bypassCustomProtocolHandlers:true});
  });
  const win=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{backgroundThrottling:false}});
  try {
    await win.loadURL('https://adcode.bluethenics.com/');
    const start=Date.now();let state='loading';
    while(Date.now()-start<45000){
      state=await win.webContents.executeJavaScript("document.getElementById('preview').innerText");
      if(state.includes('SDK returned a sponsored card')||state.includes('SDK returned no ad')||state.includes('could not load'))break;
      await new Promise(r=>setTimeout(r,250));
    }
    const rendered=state.includes('SDK returned a sponsored card');
    const completed=rendered||state.includes('SDK returned no ad');
    if(completed){await new Promise(r=>setTimeout(r,2000));await fs.writeFile(process.env.ADCODE_IMPREZIA_SMOKE_OUT,(await win.webContents.capturePage()).toPNG());}
    console.log(JSON.stringify({rendered,state:state.slice(0,500)}));app.exit(completed?0:1);
  }catch(e){console.error(e.message);app.exit(1);}
});`, "utf8");
const env = { ...process.env, IMPREZIA_API_KEY: "", ADCODE_IMPREZIA_PREVIEW_URL: `http://127.0.0.1:${server.address().port}/`, ADCODE_IMPREZIA_SMOKE_OUT: join(out, "sdk-preview.png") };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require("electron"), [browserScript], { cwd: repo, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", chunk => { output += chunk; });
child.stderr.on("data", chunk => { output += chunk; });
try {
  const code = await new Promise((resolve, reject) => { child.on("exit", resolve); child.on("error", reject); });
  const monetizeCalls = calls.filter(call => call.path === "/v1/monetize/append");
  const browser = output.split(/\r?\n/).map(line => { try { return JSON.parse(line); } catch { return null; } }).find(value => typeof value?.rendered === "boolean");
  const result = { ok: code === 0 && monetizeCalls.length === 1 && monetizeCalls[0].status === 200 && (!fixture || browser?.rendered === true),
    fixture, rendered: browser?.rendered ?? false, noFill: browser?.rendered === false && code === 0, calls, screenshot: code === 0 ? join(out, "sdk-preview.png") : null };
  await writeFile(join(out, "sdk-verification.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) console.error(output.slice(-4000));
  process.exitCode = result.ok ? 0 : 1;
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
