/** Client/service contract integration belongs at the app boundary, not inside the API. */
import { expect, it, vi } from "vitest";
import { createOpenAiCompatibleProvider } from "../../../packages/ai/src/providers/openaiCompatible.ts";
import { createAgent } from "../../../packages/ai/src/agent.ts";
import type { ProviderRequest } from "../../../packages/ai/src/types.ts";
import { createFetchHandler } from "../../../services/api/src/fetchHandler.ts";
import { createMemoryStore } from "../../../services/api/src/memoryStore.ts";
import { DEFAULT_TAGFLOW_CONFIG } from "../../../services/api/src/tagflowConfig.ts";
import { recoverIncludedLimits } from "../../../packages/ai/src/includedLimitRecovery.ts";

it("continues the tool loop past historical credit caps without waiting or repeating completed tools",async()=>{
  vi.useFakeTimers();vi.setSystemTime(Date.parse("2026-10-11T12:00:00Z"));const started=Date.now();const window=5*3_600_000;
  const store=createMemoryStore();let toolRuns=0;const statuses:number[]=[];
  const config={...DEFAULT_TAGFLOW_CONFIG,enabled:true,baseUrl:"https://api.tagflow-ai.com/v1",defaultModel:"coder",credits:{sessionCredits:1,weeklyCredits:100,sessionHours:5},models:[{id:"coder",name:"Coder",contextWindow:32768,maxOutput:4096,inputPrice:0.1,outputPrice:0.2}]};
  await store.putTagflowConfig({config,updatedAt:Date.now(),updatedBy:"admin"});
  const upstream=vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"edit-1","function":{"name":"edit_file","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3}}\n\ndata: [DONE]\n\n',{headers:{"content-type":"text/event-stream"}}))
    .mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"Finished the task."},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":14,"completion_tokens":2}}\n\ndata: [DONE]\n\n',{headers:{"content-type":"text/event-stream"}}));
  const handle=createFetchHandler({store,verifier:{verify:async()=>({uid:"user",claims:{email:"test@adcode.test",email_verified:true}})},clock:{now:()=>Date.now()},tagflow:{apiKey:"fixture-only",fetchImpl:upstream}});
  const provider=recoverIncludedLimits(createOpenAiCompatibleProvider({id:"tagflow",displayName:"Included AI",baseUrl:"https://adcode.test/v1/ai/tagflow",apiKey:"user",models:["coder"],fetchImpl:async(url,init)=>{const response=await handle(new Request(url,init));statuses.push(response.status);return response;}}));
  const agent=createAgent({provider,model:"coder",maxTokens:100,tools:[{name:"edit_file",description:"Edit file",inputSchema:{type:"object"},mutating:true}],runner:{run:async()=>{
    // Another device spends the rest of this session's credits while the edit runs.
    toolRuns++;
    await store.reserveTagflow({id:"earlier",uid:"user",day:"2026-10-11",minute:1,tokens:1,costMicros:0,limits:config.limits,credits:{millicredits:1000,sessionLimit:1000,weeklyLimit:100_000,sessionMs:window,now:Date.now()}});
    await store.settleTagflow("earlier",{inputTokens:1,outputTokens:0,costMicros:0,estimated:false,failed:false,millicredits:1000});
    return{content:"Edited app.ts successfully.",isError:false};
  }}});
  try{
    const events:unknown[]=[];const run=(async()=>{for await(const event of agent.send("Fix the button"))events.push(event);})();
    await run;expect(statuses).toEqual([200,200]);expect(toolRuns).toBe(1);
    expect(Date.now()).toBe(started);
    expect(events).toContainEqual({kind:"text",text:"Finished the task."});expect(events.some(event=>(event as {kind:string}).kind==="error")).toBe(false);
    expect(JSON.stringify(upstream.mock.calls[1]?.[1]?.body)).toContain("Edited app.ts successfully");
    // Accounting continues in the same window, beyond the historical ceiling.
    expect((await store.getCreditWindows("user")).session).toEqual({startedAt:started,endsAt:started+window,usedMillicredits:1031,reservedMillicredits:0});
  }finally{agent.cancel();vi.useRealTimers();}
});

it("accepts the actual client tool loop when bytes exceed the model's token count", async () => {
  const store = createMemoryStore();
  await store.putTagflowConfig({ config: { ...DEFAULT_TAGFLOW_CONFIG, enabled: true, baseUrl: "https://api.tagflow-ai.com/v1", defaultModel: "coder", models: [{ id: "coder", name: "Coder", contextWindow: 32768, maxOutput: 4096, inputPrice: 0.1, outputPrice: 0.2 }] }, updatedAt: 0, updatedBy: "test" });
  const upstream = vi.fn<typeof fetch>().mockImplementation(async () => new Response(
    'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3}}\n\ndata: [DONE]\n\n',
    { headers: { "content-type": "text/event-stream" } },
  ));
  const handle = createFetchHandler({ store, verifier: { verify: async () => ({ uid: "test", claims: { email: "test@adcode.test", email_verified: true } }) }, clock: { now: () => Date.parse("2026-10-10T12:00:00Z") }, tagflow: { apiKey: "fixture-only", fetchImpl: upstream } });
  const pending: Response[] = [];
  try {
    const provider = createOpenAiCompatibleProvider({ id: "tagflow", displayName: "Included AI", baseUrl: "https://adcode.test/v1/ai/tagflow", apiKey: "test", models: ["coder"], fetchImpl: async (url, init) => { const response = await handle(new Request(url, init)); pending.push(response); return response; } });
    const request: ProviderRequest = {
      model: "coder", system: "Coding instructions. ".repeat(1300), maxTokens: 100,
      messages: [{ role: "user", content: [{ type: "text", text: "Read the sample file" }] }],
      tools: [{ name: "read_file", description: "Read a project file", mutating: false, inputSchema: { type: "object", properties: { path: { type: "string" } } } }],
    };
    const first = []; for await (const event of provider.stream(request, new AbortController().signal)) first.push(event);
    const continued: ProviderRequest = { ...request, messages: [...request.messages,
      { role: "assistant", content: [{ type: "tool-call", id: "read-1", name: "read_file", input: { path: "sample.ts" } }] },
      { role: "user", content: [{ type: "tool-result", toolCallId: "read-1", content: "const sample = 1;\n".repeat(600), isError: false }] },
    ] };
    const second = []; for await (const event of provider.stream(continued, new AbortController().signal)) second.push(event);
    expect(first.some(event => event.kind === "text")).toBe(true);
    expect(second.some(event => event.kind === "text")).toBe(true);
    expect(upstream).toHaveBeenCalledTimes(2);
    const sent = JSON.parse(upstream.mock.calls[1]![1]!.body as string);
    expect(Buffer.byteLength(JSON.stringify({ messages: sent.messages, tools: sent.tools }), "utf8")).toBeGreaterThan(32768);
    expect(sent.messages).toContainEqual({ role: "assistant", content: null, tool_calls: [{ id: "read-1", type: "function", function: { name: "read_file", arguments: '{"path":"sample.ts"}' } }] });
  } finally { for (const response of pending) if (!response.bodyUsed) await response.body?.cancel().catch(() => undefined); }
});

it("continues a browser tool loop with its text report after the relay refuses its screenshot", async () => {
  const store = createMemoryStore();
  await store.putTagflowConfig({ config: { ...DEFAULT_TAGFLOW_CONFIG, enabled: true, baseUrl: "https://api.tagflow-ai.com/v1", defaultModel: "coder", models: [{ id: "coder", name: "Coder", contextWindow: 32768, maxOutput: 4096, inputPrice: 0.1, outputPrice: 0.2 }] }, updatedAt: 0, updatedBy: "test" });
  const upstream = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"look-1","function":{"name":"view_page","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }))
    .mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"The report identified a missing label."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }));
  const handle = createFetchHandler({ store, verifier: { verify: async () => ({ uid: "test", claims: { email: "test@adcode.test", email_verified: true } }) }, clock: { now: () => Date.parse("2026-10-10T12:00:00Z") }, tagflow: { apiKey: "fixture-only", fetchImpl: upstream } });
  const statuses: number[] = [];
  const pending: Response[] = [];
  const provider = createOpenAiCompatibleProvider({ id: "tagflow", displayName: "Included AI", baseUrl: "https://adcode.test/v1/ai/tagflow", apiKey: "test", models: ["coder"], fetchImpl: async (url, init) => { const response = await handle(new Request(url, init)); statuses.push(response.status); pending.push(response); return response; } });
  const agent = createAgent({ provider, model: "coder", maxTokens: 100, tools: [{ name: "view_page", description: "Read page findings", mutating: false, inputSchema: { type: "object", properties: {} } }], runner: { run: async () => ({ content: "Missing label on the email field.", isError: false, images: [{ type: "image", mediaType: "image/png", data: "AAAA" }] }) } });
  try {
    const events = []; for await (const event of agent.send("Check the page")) events.push(event);
    expect(statuses).toEqual([200, 400, 200]);
    expect(events).toContainEqual({ kind: "status", text: "This model cannot read images - carrying on with the text alone" });
    expect(events.some(event => event.kind === "error")).toBe(false);
    expect(events.at(-1)).toMatchObject({ kind: "turn-end" });
    expect(upstream).toHaveBeenCalledTimes(2);
    const continued = JSON.parse(upstream.mock.calls[1]![1]!.body as string);
    expect(continued.messages).toContainEqual({ role: "tool", tool_call_id: "look-1", content: "Missing label on the email field." });
    expect(JSON.stringify(continued)).not.toContain("image_url");
  } finally { for (const response of pending) if (!response.bodyUsed) await response.body?.cancel().catch(() => undefined); }
});
