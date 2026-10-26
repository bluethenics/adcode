import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import { launchBrowser } from "./lib/headlessEdge.mjs";

// Browser-only fixtures: every API request is intercepted before the UI mounts.
const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".tmp/ai-plans-check");
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "index.html"), '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>AI plans browser check</title></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>');
await writeFile(resolve(output, "main.tsx"), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthContext } from '/apps/web/src/components/AuthContext.tsx';
import AiTokens from '/apps/web/src/app/ai-tokens/AiTokens.tsx';
import { PlansAdmin } from '/apps/web/src/components/PlansAdmin.tsx';
import { AdNetworksAdmin } from '/apps/web/src/components/AdNetworksAdmin.tsx';
import { PLANS } from '/services/api/src/aiPlans.ts';
import '/apps/web/src/app/globals.css';
import '/apps/web/src/app/ai-tokens/ai-tokens.css';
import '/apps/web/src/components/adminModels.css';
import '/apps/web/src/components/adminTagflow.css';
window.fixtureWrites = []; window.fixturePaid = false; window.fixturePromoExpired = true;
window.fixtureNetworks = [];
const token = async () => 'synthetic-plan-token';
const tokens = () => ({ enabled:true,free:{limit:window.fixturePaid?150000000:10000000,used:0,held:0,remaining:window.fixturePaid?150000000:10000000,resetsAt:null},purchased:4000000,plan:window.fixturePaid?{id:'pro',source:'subscription',endsAt:Date.now()+86400000}:null });
const original = window.fetch;
window.fetch = async (input, init={}) => {
 const path = new URL(typeof input==='string'?input:input.url, location.href).pathname;
 if (!path.startsWith('/v1/')) return original(input,init);
 const body = init.body ? JSON.parse(init.body) : undefined;
 if (init.method && init.method !== 'GET') window.fixtureWrites.push({path,body});
 if(path==='/v1/admin/ad-networks' && init.method==='PUT') { const existing=window.fixtureNetworks.find(n=>n.id===body.id); window.fixtureNetworks=[...window.fixtureNetworks.filter(n=>n.id!==body.id),{...body,keyConfigured:existing?.keyConfigured??false,readiness:'disabled'}]; return Response.json({ok:true}); }
 if(path==='/v1/admin/ad-networks') return Response.json({networks:window.fixtureNetworks,credentialsManageable:true});
 if(path.startsWith('/v1/admin/ad-networks/') && path.endsWith('/key')) {const id=path.split('/')[4];window.fixtureNetworks=window.fixtureNetworks.map(n=>n.id===id?{...n,keyConfigured:body.key!==null}:n);return Response.json({ok:true,keyConfigured:body.key!==null});}
 if(path.startsWith('/v1/admin/ad-networks/') && path.endsWith('/test')) return Response.json({ok:true,advertisements:[{id:'sample',name:'Sponsor',headline:'Newsletter sponsor preview',text:'Sample newsletter advertisement',description:'Fixture'}]});
 if(path==='/v1/ai/tagflow/config') return Response.json({paid:{enabled:true,freeWeeklyTokens:10000000,plans:PLANS,packs:[{id:'50m',priceCents:1000,tokens:50000000}]}});
 if(path==='/v1/ai/tagflow/usage') return Response.json({tokens:tokens()});
 if(path==='/v1/ai/tokens/orders') return Response.json({tokens:tokens(),orders:[],ledger:[],subscription:window.fixturePaid?{plan:'pro',status:'active',periodEnd:Date.now()+86400000,active:true}:null});
 if(path==='/v1/ai/promo/redeem') return Response.json({result:window.fixturePromoExpired?'expired':'tokens'},{status:window.fixturePromoExpired?410:200});
 if(path==='/v1/ai/invites') return Response.json({code:'INVLOCAL12',uses:1,maxUses:2});
 return Response.json({error:'not-found'},{status:404});
};
const adminCall = async (path, body) => { if(body)window.fixtureWrites.push({path:'/v1'+path,body}); if(path.endsWith('/subscriptions'))return{plans:[{plan:'pro',active:3,mrrCents:5700}]};if(path.endsWith('/promo')&&!body)return{promos:[{code:'LAUNCH',kind:'tokens',tokens:50000000,maxRedemptions:100,redemptions:3,expiresAt:Date.now()+86400000}]};return{ok:true}; };
createRoot(document.getElementById('root')).render(<AuthContext.Provider value={{user:{uid:'fixture'},loading:false,configured:true,token,isAdmin:true,adminLoading:false,adminError:null,retryAdmin:()=>{}}}><main className="ai-tokens"><h1>AI plans</h1><aside aria-label="Local test controls"><button onClick={()=>window.fixturePaid=true}>Simulate confirmed subscription</button><button onClick={()=>window.fixturePromoExpired=false}>Allow test promo</button></aside><AiTokens/><div className="tagflow-admin"><PlansAdmin call={adminCall}/></div><AdNetworksAdmin/></main></AuthContext.Provider>);
`);
const server = await createServer({ root, cacheDir: resolve(output, "vite-cache"), optimizeDeps: { entries: [resolve(output, "index.html")] }, server: { host: "127.0.0.1", port: 5197, strictPort: true, watch: { ignored: ["**/apps/desktop/out/**", "**/release/**", "**/artifacts/**"] } }, esbuild: { jsx: "automatic" }, resolve: { alias: { "@/": `${resolve(root, "apps/web/src")}/`, "@adcode/api/": `${resolve(root, "services/api")}/` } }, define: { "process.env": JSON.stringify({ NODE_ENV: "development" }) } });
await server.listen();
if (process.argv.includes("--preview")) {
  console.log("Local fixture: http://127.0.0.1:5197/.tmp/ai-plans-check/index.html?plan=pro&order=aip_fixture");
  await new Promise(() => {});
}
let browser;
const checks = {};
try {
  browser = await launchBrowser({ port: 9497 });
  await browser.goto("http://127.0.0.1:5197/.tmp/ai-plans-check/index.html?plan=pro&order=aip_fixture");
  assert(await browser.waitFor("document.querySelector('.ai-plan-cards')", { timeoutMs: 60000 }), "plan cards render");
  assert(await browser.evaluate("document.body.textContent.includes('Checking your Pro subscription')"));
  assert(await browser.evaluate("!document.body.textContent.includes('Your Pro plan is active')"));
  await browser.evaluate("window.fixturePaid = true");
  assert(await browser.waitFor("document.body.textContent.includes('Your Pro plan is active')"), "webhook state confirms activation");
  assert(await browser.waitFor("document.querySelector('.ai-invite-copy input')?.value === 'INVLOCAL12'"));
  checks.webhookConfirmation = true;
  const fill = async (selector, value) => browser.evaluate(`(() => { const input=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await fill(".ai-code-form input", "EXPIRED");
  await browser.evaluate("document.querySelector('.ai-code-form').requestSubmit()");
  assert(await browser.waitFor("document.querySelector('.ai-token-code [role=alert]')?.textContent.includes('expired')"));
  await browser.evaluate("window.fixturePromoExpired = false");
  await fill(".ai-code-form input", "LAUNCH");
  await browser.evaluate("document.querySelector('.ai-code-form').requestSubmit()");
  assert(await browser.waitFor("document.body.textContent.includes('Your promo tokens have been added')"));
  checks.promoErrorAndRetry = true;
  await browser.evaluate(`(() => {const select=document.querySelector('form[aria-label="Plan allowance action"] select');select.value='gift';select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  assert(await browser.waitFor("document.body.textContent.includes('Gift days')"));
  await browser.evaluate(`(() => {const select=document.querySelectorAll('form[aria-label="Plan allowance action"] select')[1];select.value='everyone';select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  await browser.evaluate(`document.querySelector('form[aria-label="Plan allowance action"]').requestSubmit()`);
  assert(await browser.waitFor("window.fixtureWrites.some(write=>write.path==='/v1/admin/ai-plans/gift'&&write.body.uid==='*'&&write.body.plan==='monthly'&&write.body.days===7)"));
  checks.adminEveryoneGift = true;
  await browser.viewport(375, 812, true);
  checks.phoneWidth = await browser.evaluate("({viewport:window.innerWidth,page:document.documentElement.scrollWidth})");
  assert.equal(checks.phoneWidth.page, 375, "customer and admin content fit a 375px phone");
  await browser.screenshot(resolve(output, "phone.png"));
  await browser.viewport(1280, 900);
  await browser.screenshot(resolve(output, "desktop.png"));
  assert.equal(browser.consoleErrors.length, 0, browser.consoleErrors.join("\n"));
  console.log(JSON.stringify(checks, null, 2));
} finally { if (browser) await browser.close(); await server.close(); }
