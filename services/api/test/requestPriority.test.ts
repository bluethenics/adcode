import { expect, it, vi } from "vitest";
import { activeCap, priorityOrder, requestTier, releaseWithResponse, ticketsToAdmit } from "../src/requestPriority.ts";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { DEFAULT_TAGFLOW_CONFIG } from "../src/tagflowConfig.ts";

it("uses active plans and ages Free ahead of newly queued paid requests",()=>{
  expect(requestTier({plan:{id:"pro",source:"subscription",endsAt:100}},99)).toBe("pro");
  expect(requestTier({plan:{id:"pro",source:"subscription",endsAt:100}},100)).toBe("free");
  expect(priorityOrder(0,"free")).toBeLessThan(priorityOrder(10001,"unlimited"));
  expect(priorityOrder(0,"unlimited")).toBeLessThan(priorityOrder(0,"pro"));
});

it("holds a slot for an open response and releases it on cancellation",async()=>{
  const release=vi.fn(async()=>{});
  const response=await releaseWithResponse(new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode("data: hello\n\n"));}}),{headers:{"content-type":"text/event-stream"}}),{release});
  const reader=response.body!.getReader(); await reader.read(); expect(release).not.toHaveBeenCalled();
  await reader.cancel(); expect(release).toHaveBeenCalledTimes(1);
});

it("finishes a successful stream even when queue cleanup fails",async()=>{
  const release=vi.fn(async()=>{throw Error("network");});
  const response=await releaseWithResponse(new Response("data: [DONE]\n\n",{headers:{"content-type":"text/event-stream"}}),{release});
  expect(await response.text()).toContain("[DONE]"); expect(release).toHaveBeenCalledTimes(1);
});

it("uses the authenticated account's plan and refunds reservations when a queue is full",async()=>{
  const store=createMemoryStore(), now=Date.parse("2026-11-01T12:00:00Z");
  await store.putTagflowConfig({config:{...DEFAULT_TAGFLOW_CONFIG,enabled:true,baseUrl:"https://api.tagflow-ai.com/v1",defaultModel:"coder",models:[{id:"coder",name:"Coder",contextWindow:65536,maxOutput:4096,inputPrice:.1,outputPrice:.2}]},updatedAt:now,updatedBy:"admin"});
  await store.giftPlan("user","pro",1,"admin","test",now);
  const acquire=vi.fn(async()=>{throw Error("full");}), upstream=vi.fn<typeof fetch>();
  const handle=createFetchHandler({store,verifier:{verify:async()=>({uid:"user",claims:{email:"person@example.test",email_verified:true}})},clock:{now:()=>now},tagflow:{apiKey:"secret",fetchImpl:upstream,priority:{acquire}}});
  const response=await handle(new Request("https://api/v1/ai/tagflow/chat/completions",{method:"POST",headers:{authorization:"Bearer token","content-type":"application/json","x-adcode-plan":"unlimited"},body:JSON.stringify({model:"coder",messages:[{role:"user",content:"Hello"}],stream:true,max_tokens:100})}));
  expect(response.status).toBe(429); expect(upstream).not.toHaveBeenCalled();
  expect(acquire).toHaveBeenCalledWith(expect.objectContaining({uid:"user",plan:expect.objectContaining({id:"pro"})}));
  const usage=await store.getTagflowUsage("user","2026-11-01");
  expect(usage?.reservedTokens).toBe(0); expect(usage?.costMicros).toBe(0);
});

it("lets an account's extra requests wait in place instead of taking every slot or being refused",()=>{
  // Free runs four at once, matching the desktop's parallel chats; paid plans eight.
  expect(activeCap(0)).toBe(4); expect(activeCap(3)).toBe(8);
  const waiting=[1,2,3,4,5].map(n=>({id:`a${n}`,uid:"a",rank:0})).concat([{id:"b1",uid:"b",rank:0}]);
  // Account a already runs two: two more start, the fifth waits, and b still gets a slot.
  expect(ticketsToAdmit(waiting,new Map([["a",2]]),16)).toEqual(["a1","a2","b1"]);
  // Slots run out before the queue does.
  expect(ticketsToAdmit(waiting,new Map(),2)).toEqual(["a1","a2"]);
  expect(ticketsToAdmit(waiting,new Map(),0)).toEqual([]);
});
