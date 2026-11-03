import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "../src/memoryStore.ts";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { DEFAULT_TAGFLOW_CONFIG } from "../src/tagflowConfig.ts";
import { DEFAULT_PAID_CONFIG } from "../src/paidTokens.ts";
import { walletCharge, walletRates } from "../src/modelWallet.ts";
import type { TagflowConfig } from "../src/tagflowTypes.ts";

const NOW=Date.parse("2026-10-29T12:00:00Z");
const config:TagflowConfig={...DEFAULT_TAGFLOW_CONFIG,enabled:true,baseUrl:"https://api.tagflow-ai.com/v1",defaultModel:"free",models:[{id:"free",name:"Free",contextWindow:32768,maxOutput:4096,inputPrice:0,outputPrice:0},{id:"paid",name:"Paid",provider:"openrouter",upstreamModel:"test/model",billing:"wallet",contextWindow:32768,maxOutput:4096,inputPrice:1,outputPrice:5,cacheInputPrice:0.1}],paid:{...DEFAULT_PAID_CONFIG,enabled:true}};
describe("paid model dollar wallet",()=>{
 let store:ReturnType<typeof createMemoryStore>;
 let fetcher:ReturnType<typeof vi.fn<typeof fetch>>;
 let handle:ReturnType<typeof createFetchHandler>;
 const call=(path:string,body?:unknown,headers:Record<string,string>={})=>handle(new Request(`https://test/v1${path}`,{method:body===undefined?"GET":"POST",headers:{authorization:"Bearer user","content-type":"application/json","x-adcode-paid-credits":"1",...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}));
 const chat=(headers:Record<string,string>={})=>call('/ai/tagflow/chat/completions',{model:"paid",messages:[{role:"user",content:"Hello"}],max_tokens:100,stream:false},headers);
 const fund=async()=>{
  await store.createWalletOrder({orderId:"aiw_test",uid:"u",priceCents:1000,createdAt:NOW}); await store.completeWalletOrder("aiw_test","cks_test");
  return store.applyWalletEvent({type:"purchase",webhookId:"wh_test",orderId:"aiw_test",paymentId:"p_test",sessionId:"cks_test",amountMicros:10_000_000n,now:NOW});
 };
 beforeEach(async()=>{
  vi.stubEnv("INCLUDED_AI_OPENROUTER_API_KEY","server-provider-key");store=createMemoryStore();
  await store.putTagflowConfig({config,updatedAt:NOW,updatedBy:"setup"});
  await store.putUser({uid:"u",status:"active",createdAt:NOW,email:"u@test.com",emailVerified:true});
  fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({choices:[{message:{content:"OK"},finish_reason:"stop"}],usage:{prompt_tokens:100,completion_tokens:10,prompt_tokens_details:{cached_tokens:80},cost:0.0002}}));
  handle=createFetchHandler({store,clock:{now:()=>NOW},verifier:{async verify(){return {uid:"u",claims:{email:"u@test.com",email_verified:true}};}},payments:{canCreateCheckout:()=>true,async createCheckout(){return {sessionId:"cks_new",checkoutUrl:"https://checkout.dodopayments.com/session/cks_new"};}},tagflow:{apiKey:"free-key",fetchImpl:fetcher,rateLimitWaitsMs:[]}});
 });
 afterEach(()=>vi.unstubAllEnvs());
 it("applies 35% once and discounts cache hits",()=>{
  expect(walletCharge({inputPrice:1,outputPrice:5,cacheInputPrice:0.1},1000,200,800)).toBe(1728);
  expect(walletCharge({inputPrice:1,outputPrice:5},1000,200,0,0.002)).toBe(2700);
 });
 it("partitions cache writes from reads and applies the long-context price tier",()=>{
  const model={provider:"openai",upstreamModel:"gpt-6-luna",inputPrice:0.1,outputPrice:0.5,cacheInputPrice:0.01};
  const short=walletRates(model,NOW,272_000);
  const long=walletRates(model,NOW,272_001);
  expect(short).toMatchObject({inputPrice:0.1,outputPrice:0.5,cacheWritePrice:0.125});
  expect(long).toMatchObject({inputPrice:0.2,outputPrice:0.75,cacheInputPrice:0.02,cacheWritePrice:0.25});
  expect(walletCharge(short,1000,200,400,undefined,200)).toBe(229);
 });
 it("rejects extra provider tool fees and custom cache settings before sending",async()=>{
  await fund();
  const request={model:"paid",messages:[{role:"user",content:"Hello"}],max_tokens:100,stream:false};
  expect((await call('/ai/tagflow/chat/completions',{...request,tools:[{type:"web_search"}]})).status).toBe(400);
  expect((await call('/ai/tagflow/chat/completions',{...request,messages:[{role:"user",content:"Hello",cache_control:{type:"ephemeral",ttl:"1h"}}]})).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
  expect((await call('/ai/tagflow/chat/completions',{...request,tools:[{type:"function",function:{name:"read_file",parameters:{type:"object",properties:{}}}}]})).status).toBe(200);
 });
 it("does not send a paid request without dollars, including on unlimited Pro",async()=>{
  await store.applySubscriptionEvent({webhookId:"sub",type:"active",subscriptionId:"sub1",uid:"u",plan:"pro",customerId:"cus",status:"active",periodEnd:NOW+86400000,cancelAtPeriodEnd:false,now:NOW});
  const response=await chat();expect(response.status).toBe(402);expect(await response.json()).toMatchObject({error:{code:"wallet-balance"}});expect(fetcher).not.toHaveBeenCalled();
 });
 it("refuses older clients before charging a misleading free-model view",async()=>{
  await fund();expect((await chat({"x-adcode-paid-credits":""})).status).toBe(402);expect(fetcher).not.toHaveBeenCalled();expect((await store.getModelWallet("u",NOW)).balanceMicros).toBe(10_000_000);
 });
 it("charges provider-reported cost, returns unused hold, and preserves included tokens",async()=>{
  await fund();await store.grantTokens("u",1000,"admin","test",NOW);
  expect((await chat()).status).toBe(200);
  const wallet=await store.getModelWallet("u",NOW);expect(wallet.balanceMicros).toBe(9_999_730);expect(wallet.reservedMicros).toBe(0);expect(wallet.activity[0]).toMatchObject({kind:"usage",estimated:false,deltaMicros:-270});
  expect((await store.getPaidTokens("u")).balance.purchased).toBe(1000);
  expect((await store.getPaidTokens("u")).free).toBe(null);
  const sent=JSON.parse(fetcher.mock.calls[0]![1]!.body as string);expect(sent.provider).toEqual({require_parameters:true,max_price:{prompt:1,completion:5}});
 });
 it("settles streamed provider cost exactly once after the usage event",async()=>{
  await fund();
  const event=(value:unknown)=>`data: ${JSON.stringify(value)}\n\n`;
  fetcher.mockResolvedValue(new Response(event({choices:[{delta:{content:"OK"},finish_reason:"stop"}]})+event({choices:[],usage:{prompt_tokens:100,completion_tokens:10,cost:0.0002}})+"data: [DONE]\n\n",{headers:{"content-type":"text/event-stream"}}));
  const response=await call('/ai/tagflow/chat/completions',{model:"paid",messages:[{role:"user",content:"Hello"}],max_tokens:100,stream:true});
  expect(await response.text()).toContain('[DONE]');
  const wallet=await store.getModelWallet("u",NOW);
  expect(wallet).toMatchObject({balanceMicros:9_999_730,reservedMicros:0});
  expect(wallet.activity.filter(a=>a.kind==="usage")).toHaveLength(1);
 });
 it("marks interrupted paid streams as estimated and never retries their billable work",async()=>{
  await fund();
  fetcher.mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"Partial answer"}}]}\n\n',{headers:{"content-type":"text/event-stream"}}));
  const response=await call('/ai/tagflow/chat/completions',{model:"paid",messages:[{role:"user",content:"Hello"}],max_tokens:100,stream:true});
  expect(await response.text()).toContain('stream-interrupted');
  const wallet=await store.getModelWallet("u",NOW);
  expect(wallet.reservedMicros).toBe(0);expect(wallet.activity[0]).toMatchObject({kind:"usage",estimated:true});
  expect(wallet.activity[0]!.deltaMicros).toBeGreaterThan(-500);
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it("charges direct token rates with cache discount when no provider cost is present",async()=>{
  await fund();fetcher.mockResolvedValue(Response.json({choices:[{message:{content:"OK"},finish_reason:"stop"}],usage:{prompt_tokens:1000,completion_tokens:200,prompt_tokens_details:{cached_tokens:800}}}));
  // The final charge remains capped by this request's conservative maximum quote.
  const r=await chat();expect(r.status).toBe(200);const w=await store.getModelWallet("u",NOW);expect(w.activity[0]!.deltaMicros).toBeGreaterThanOrEqual(-1728);expect(w.reservedMicros).toBe(0);
 });
 it("releases the full hold on a provider refusal and never changes models",async()=>{
  await fund();fetcher.mockResolvedValue(new Response("busy",{status:429}));expect((await chat()).status).toBe(429);expect(fetcher).toHaveBeenCalledTimes(1);const w=await store.getModelWallet("u",NOW);expect(w.balanceMicros).toBe(10_000_000);expect(w.reservedMicros).toBe(0);
 });
 it("does not charge a connection failure",async()=>{
  await fund();fetcher.mockRejectedValue(new Error("Network unavailable"));expect((await chat()).status).toBe(502);expect((await store.getModelWallet("u",NOW)).balanceMicros).toBe(10_000_000);
 });
 it("reserves concurrent requests atomically, settles once, and caps overruns",async()=>{
  await fund();const results=await Promise.all([store.reserveModelWallet("one","u","paid",7_000_000,NOW),store.reserveModelWallet("two","u","paid",7_000_000,NOW)]);expect(results).toEqual([true,false]);
  await store.settleModelWallet("one",20_000_000,false,NOW);await store.settleModelWallet("one",20_000_000,false,NOW);expect((await store.getModelWallet("u",NOW)).balanceMicros).toBe(3_000_000);
 });
 it("checkout creates a pending order, never spendable credits",async()=>{
  const response=await call('/ai/wallet/checkout',{priceCents:2000,billingCountry:"US"});expect(response.status).toBe(200);expect((await store.getModelWallet("u",NOW)).balanceMicros).toBe(0);expect((await store.getModelWallet("u",NOW)).orders[0]).toMatchObject({priceCents:2000,status:"pending"});
 });
 it("does not sell credits while models are paused or the account is blocked",async()=>{
  await store.putTagflowConfig({config:{...config,enabled:false},updatedAt:NOW,updatedBy:"admin"});
  expect(await (await call('/ai/wallet')).json()).toMatchObject({checkoutEnabled:false});
  expect((await call('/ai/wallet/checkout',{priceCents:1000,billingCountry:"US"})).status).toBe(503);
  await store.putTagflowConfig({config,updatedAt:NOW,updatedBy:"admin"});
  await store.putTagflowPolicy("u",{blocked:true,limits:null,updatedAt:NOW,updatedBy:"admin"});
  expect((await call('/ai/wallet/checkout',{priceCents:1000,billingCountry:"US"})).status).toBe(403);
  expect((await store.getModelWallet("u",NOW)).orders).toHaveLength(0);
 });
 it("publishes explicit prices and keeps other accounts' balances private",async()=>{
  await fund();const response=await call('/ai/wallet');expect(await response.json()).toMatchObject({availableMicros:10_000_000,markupPercent:35,models:[{id:"paid",inputPrice:1.35,outputPrice:6.75}]});expect((await store.getModelWallet("another",NOW)).balanceMicros).toBe(0);
 });
});
