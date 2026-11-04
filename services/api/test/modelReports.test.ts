import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { DEFAULT_TAGFLOW_CONFIG } from "../src/tagflowConfig.ts";
import { completeModelReport, parseReportRange, summarizeModelReports } from "../src/tagflowReports.ts";
import type { ModelFeedbackRecord, ModelReportResponse, ModelRequestRecord } from "../src/tagflowReportTypes.ts";
import type { TokenVerifier } from "../src/auth.ts";

const from = Date.parse("2026-10-11T00:00:00Z"), now = from+86_400_000;
const range = parseReportRange("2026-10-11","2026-10-11",now)!;
const config = { ...DEFAULT_TAGFLOW_CONFIG, enabled: true, baseUrl: "https://api.tagflow-ai.com/v1", defaultModel: "coder", models: [{ id: "coder", name: "Coder", contextWindow: 131072, maxOutput: 4096, inputPrice: 0.1, outputPrice: 0.2 },{ id: "unused", name: "Unused", contextWindow: 131072, maxOutput: 4096, inputPrice: 0, outputPrice: 0 }] };
export const requestRow = (patch: Partial<ModelRequestRecord> = {}): ModelRequestRecord => ({ id: randomUUID(),uid: "account-a",modelId: "coder",modelName: "Coder",provider: "tagflow",upstreamModel: "revision-1",startedAt: from+1000,finishedAt: from+3000,providerStartedAt: from+1000,outcome: "success",errorCode: null,upstreamStatus: 200,source: "chat",streamed: true,toolsOffered: true,toolCalls: 1,finishReason: "stop",contextWindow: 131072,requestedOutput: 4096,estimatedInput: 100,inputTokens: 100,outputTokens: 20,costMicros: 100,estimated: false,durationMs: 2000,firstTokenMs: 100,...patch });

describe("provider report calculations",() => {
  it("separates failures, demand, distinct users, revisions and explicit feedback without leaking account data",() => {
    const previous = requestRow({ startedAt: from-1000,finishedAt: from-500,providerStartedAt: from-1000 });
    const good = requestRow(), slow = requestRow({ uid: "new-account",startedAt: from+1500,finishedAt: from+9500,providerStartedAt: from+1500,durationMs: 8000,firstTokenMs: 500,inputTokens: 9000,outputTokens: 100,finishReason: "length" });
    const denied = requestRow({ providerStartedAt: null,outcome: "rejected",errorCode: "daily-limit",inputTokens: 0,outputTokens: 0,durationMs: null,firstTokenMs: null,toolCalls: 0 });
    const upstream = requestRow({ outcome: "provider_error",errorCode: "upstream-rate-limit",upstreamStatus: 429,inputTokens: 0,outputTokens: 0,toolCalls: 0 });
    const admin = requestRow({ source: "admin-test",inputTokens: 999999,uid: "test-admin" });
    const otherRevision = requestRow({ upstreamModel: "revision-2",uid: "other" });
    const ratings: ModelFeedbackRecord[] = [good,slow].map((row,index) => ({ requestId: row.id,uid: row.uid,rating: index ? "not-helpful" : "helpful",category: "quality",comment: index ? "private comment" : "Good answer",shareWithProvider: index === 0,createdAt: from+10000,updatedAt: from+10000 }));
    const result = summarizeModelReports([previous,good,slow,denied,upstream,admin,otherRevision],ratings,range,from);
    const model = result.models.find(model => model.upstreamModel === "revision-1")!;
    expect(model.current).toMatchObject({ attempts: 4,providerCalls: 3,successes: 2,providerErrors: 1,rejected: 1,activeUsers: 2,newUsers: 1,returningUsers: 1,repeatUsers: 1,inputTokens: 9100,outputTokens: 120,peakRpm: 3,peakConcurrency: 3,outputLimitStops: 1,durationP50: 5000,durationP95: 7700,firstTokenP50: 300,firstTokenSamples: 2,throughputSamples: 2,helpful: 1,notHelpful: 1,feedbackUsers: 2 });
    expect(model.previous.attempts).toBe(1);
    expect(model.sharedComments).toEqual([{ at: from+10000,rating: "helpful",category: "quality",comment: "Good answer" }]);
    expect(model.errors.map(error => error.code).toSorted()).toEqual(["daily-limit","upstream-rate-limit"]);
    expect(JSON.stringify(result)).not.toContain("account-a"); expect(JSON.stringify(result)).not.toContain("private comment"); expect(JSON.stringify(result)).not.toContain("test-admin");
    const completed = completeModelReport(result,config,range,now);
    expect(completed.models.find(model => model.modelId === "unused")!.current.attempts).toBe(0);
    expect(completed.models.filter(model => model.modelId === "coder")).toHaveLength(3); // two recorded revisions plus the current configuration
  });
  it("keeps sample sizes and unavailable performance honest",() => {
    const row = requestRow({ streamed: false,firstTokenMs: null,estimated: true });
    const metrics = summarizeModelReports([row],[],range,from).models[0]!.current;
    expect(metrics).toMatchObject({ estimatedRequests: 1,firstTokenSamples: 0,throughputSamples: 0,firstTokenP50: null,outputTpsP50: null });
    const feedback = [{ requestId: row.id,uid: row.uid,rating: "helpful" as const,category: "quality" as const,comment: "late feedback",shareWithProvider: true,createdAt: from+1000,updatedAt: from+1000 }];
    const historical = { ...row,startedAt: from-2*86_400_000 };
    expect(summarizeModelReports([historical],feedback,range,from).models[0]!.current).toMatchObject({ attempts: 0,helpful: 1 });
  });
  it("validates date boundaries and compares equal elapsed periods",() => {
    const invalid: [string | null,string | null][] = [["bad","2026-10-11"],[null,"bad"],["2026-02-30","2026-03-01"],["2026-10-12","2026-10-11"],["2026-01-01","2026-10-11"],["2026-10-11","2026-10-14"]];
    for (const [first,last] of invalid) expect(parseReportRange(first,last,now)).toBeNull();
    const partial = parseReportRange("2026-10-11","2026-10-11",from+3600000)!;
    expect(partial.toAt-partial.fromAt).toBe(partial.previousToAt-partial.previousFromAt);
    expect(partial.previousFromAt).toBe(from-3600000);
  });
  it("segments audience with unknowns, overlapping users, current opt-in profiles and period comparison",() => {
    const rows = [requestRow({ country:"IN",aiPersona:"reviewer",useCase:"code-review",platform:"win32",inputTokens:160000 }),requestRow({ country:"US",aiPersona:"tester",useCase:"testing",platform:"linux",outcome:"provider_error",inputTokens:0,outputTokens:0 }),requestRow({ uid:"no-profile" }),requestRow({ country:"IN",startedAt:from-1000 }),requestRow({ country:"DE",source:"admin-test" })];
    const profiles = new Map([["account-a",{ uid:"account-a",role:"student" as const,experience:"beginner" as const,primaryUse:"learning" as const,updatedAt:now }]]);
    const result = summarizeModelReports(rows,[],range,from,profiles), audience = result.models[0]!.audience!;
    expect(audience.countries.find(row => row.value === "IN")).toMatchObject({ requests:1,activeUsers:1,inputTokens:160000,previousRequests:1,previousActiveUsers:1 });
    expect(audience.countries.find(row => row.value === "US")).toMatchObject({ requests:1,activeUsers:1,providerErrors:1,successes:0 });
    expect(audience.countries.find(row => row.value === "unknown")!.requests).toBe(1);
    expect(audience.countries.some(row => row.value === "DE")).toBe(false);
    expect(audience.userRoles.find(row => row.value === "student")).toMatchObject({ requests:2,activeUsers:1,previousRequests:1 });
    expect(audience.useCases.find(row => row.value === "code-review")!.requests).toBe(1);
    expect(result.models[0]!.inputBands).toContainEqual({ band:"128k–256k",requests:1 });
    expect(JSON.stringify(result)).not.toContain("account-a");
    const withdrawn = summarizeModelReports(rows,[],range,from).models[0]!.audience!.userRoles;
    expect(withdrawn).toEqual([expect.objectContaining({ value:"unknown",requests:3,activeUsers:2,previousRequests:1 })]);
    const settings = completeModelReport({ collectionStartedAt:from,models:[] },{ ...config,maxInputTokens:262144,models:[{ ...config.models[0]!,contextWindow:262144 }] },range,now).models[0]!.configuration;
    expect(settings).toEqual({ contextWindow:262144,inputLimit:262144,outputLimit:4096,enabled:true });
  });
});

describe("provider report and feedback endpoints",() => {
  const verifier: TokenVerifier = { async verify(token) { return ["admin","user","other"].includes(token) ? { uid: token,claims: { email: `${token}@test.com`,email_verified: true } } : null; } };
  async function setup(upstream: typeof fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "OK" },finish_reason: "stop" }],usage: { prompt_tokens: 10,completion_tokens: 2 } }),{ headers: { "content-type": "application/json" } })) {
    const store = createMemoryStore(); await store.addAdmin({ email: "admin@test.com",addedAt: 1,addedBy: "setup" }); await store.putTagflowConfig({ config,updatedAt: from,updatedBy: "admin" });
    let clockNow = from+3600000;
    const handle = createFetchHandler({ store,verifier,clock: { now: () => clockNow },tagflow: { apiKey: "test-key",fetchImpl: upstream,rateLimitWaitsMs: [0, 0] } });
    const call = async (path: string,token: string,data?: unknown,source?: string) => {
      const response = await handle(new Request(`https://adcode.test/v1${path}`,{ method: data === undefined ? "GET" : "POST",headers: { authorization: `Bearer ${token}`,"content-type":"application/json",...(source ? { "x-adcode-ai-source":source } : {}) },...(data === undefined ? {} : { body: JSON.stringify(data) }) }));
      clockNow += 1;
      return response;
    };
    const chat = (source?: string) => call("/ai/tagflow/chat/completions","user",{ model: "coder",messages: [{ role: "user",content: "private prompt must never appear in analytics" }],max_tokens: 20,stream: false },source);
    return { store,call,chat };
  }
  it("records customer calls, rejects non-admin reports and prevents feedback forgery/duplicates",async () => {
    const { store,call,chat } = await setup();
    const response = await chat("chat"), id = response.headers.get("x-adcode-request-id")!;
    expect(response.status).toBe(200); await response.text();
    const telemetry = await store.getModelRequest(id);
    expect(telemetry).toMatchObject({ outcome:"success",source:"chat",inputTokens:10,outputTokens:2,upstreamStatus:200 });
    expect(JSON.stringify(telemetry)).not.toContain("private prompt");
    expect((await call("/admin/tagflow/reports","user")).status).toBe(403);
    expect((await call("/admin/tagflow/reports?to=bad","admin")).status).toBe(400);
    const feedback = { requestId:id,rating:"helpful",category:"quality",comment:"do not share this",shareWithProvider:false };
    expect((await call("/ai/tagflow/feedback","other",feedback)).status).toBe(404);
    expect((await call("/ai/tagflow/feedback","user",{ ...feedback,uid:"other" })).status).toBe(400);
    expect((await call("/ai/tagflow/feedback","user",feedback)).status).toBe(200);
    expect((await call("/ai/tagflow/feedback","user",{ ...feedback,rating:"not-helpful",comment:"Shared feedback",shareWithProvider:true })).status).toBe(200);
    const report = await (await call("/admin/tagflow/reports?from=2026-10-11&to=2026-10-11","admin")).json() as ModelReportResponse;
    expect(report.models.find(model => model.modelId === "coder")!.current).toMatchObject({ attempts:1,helpful:0,notHelpful:1 });
    expect(JSON.stringify(report)).not.toContain("do not share this"); expect(JSON.stringify(report)).not.toContain("private prompt"); expect(JSON.stringify(report)).toContain("Shared feedback");
    expect((await call("/ai/tagflow/feedback","user",{ requestId:id,rating:null })).status).toBe(200);
    expect(await store.getModelFeedback(id,"user")).toBeNull();
    expect((await store.listAudit()).some(row => row.action === "read-free-model-provider-reports")).toBe(true);
  });
  it("serves every model's summary first and one model's full report on request",async () => {
    const { call,chat } = await setup();
    const response = await chat(); expect(response.status).toBe(200); await response.text();
    const summary = await (await call("/admin/tagflow/reports","admin")).json() as ModelReportResponse & { scope: string };
    expect(summary.scope).toBe("summary");
    expect(summary.models.find(model => model.modelId === "coder")!.current.attempts).toBe(1);
    const coder = summary.models.find(model => model.modelId === "coder")!;
    const one = await (await call(`/admin/tagflow/reports?provider=${coder.provider}&model=coder&upstream=${coder.upstreamModel}&fresh=1`,"admin")).json() as ModelReportResponse & { scope: string };
    expect(one.scope).toBe("model");
    expect(one.models.map(model => model.modelId)).toEqual(["coder"]);
    expect(one.models[0]!.current).toMatchObject({ attempts:1,successes:1 });
    expect((await call("/admin/tagflow/reports?provider=tagflow&model=&upstream=x","admin")).status).toBe(400);
  });
  it("saves only the signed-in account's consented profile and supports withdrawal without deleting operational metrics",async () => {
    const { call,chat,store } = await setup();
    const profile = { role:"founder",experience:"advanced",primaryUse:"build-product",consent:true };
    expect((await call("/ai/tagflow/audience","user",{ ...profile,uid:"other" })).status).toBe(400);
    expect((await call("/ai/tagflow/audience","user",{ ...profile,role:"guessed-persona" })).status).toBe(400);
    expect((await call("/ai/tagflow/audience","user",profile)).status).toBe(200);
    expect(await (await call("/ai/tagflow/audience","other")).json()).toEqual({ profile:null });
    expect(await (await call("/ai/tagflow/audience","user")).json()).toEqual({ profile });
    const response = await chat("chat"); await response.text();
    const before = await store.readModelReports(range); expect(before.models[0]!.audience!.userRoles[0]).toMatchObject({ value:"founder",requests:1 });
    expect((await call("/ai/tagflow/audience","user",{ ...profile,consent:false })).status).toBe(200);
    expect(await store.getModelAudienceProfile("user")).toBeNull();
    const after = await store.readModelReports(range); expect(after.models[0]!.audience!.userRoles[0]).toMatchObject({ value:"unknown",requests:1 }); expect(after.models[0]!.current.successes).toBe(1);
  });
  it("takes geography only from a trusted deployment callback and discards arbitrary client persona strings",async () => {
    const { store } = await setup();
    const handle = createFetchHandler({ store,verifier,clock:{ now:() => from+3600000 },tagflow:{ apiKey:"test-key",country:() => "IN",fetchImpl:async () => new Response(JSON.stringify({ choices:[{ message:{ content:"OK" },finish_reason:"stop" }],usage:{ prompt_tokens:10,completion_tokens:2 } })) } });
    const send = async (persona:string) => {
      const result = await handle(new Request("https://adcode.test/v1/ai/tagflow/chat/completions",{ method:"POST",headers:{ authorization:"Bearer user","content-type":"application/json","x-adcode-ai-source":"agent","x-adcode-ai-persona":persona,"x-adcode-platform":"win32","cf-ipcountry":"US","x-adcode-country":"DE" },body:JSON.stringify({ model:"coder",messages:[{ role:"user",content:"secret prompt" }],stream:false,max_tokens:20 }) }));
      await result.text(); return store.getModelRequest(result.headers.get("x-adcode-request-id")!);
    };
    expect(await send("reviewer")).toMatchObject({ country:"IN",aiPersona:"reviewer",useCase:"code-review",platform:"win32" });
    const arbitrary = await send("Secret custom agent name"); expect(arbitrary).toMatchObject({ country:"IN",aiPersona:"unknown",useCase:"agent-workflow" }); expect(JSON.stringify(arbitrary)).not.toContain("Secret custom");
  });
  it("counts the web version as its own platform, apart from the desktop operating systems",async () => {
    const { store } = await setup();
    const handle = createFetchHandler({ store,verifier,clock:{ now:() => from+3600000 },tagflow:{ apiKey:"test-key",country:() => "IN",fetchImpl:async () => new Response(JSON.stringify({ choices:[{ message:{ content:"OK" },finish_reason:"stop" }],usage:{ prompt_tokens:10,completion_tokens:2 } })) } });
    const send = async (platform:string) => {
      const result = await handle(new Request("https://adcode.test/v1/ai/tagflow/chat/completions",{ method:"POST",headers:{ authorization:"Bearer user","content-type":"application/json","x-adcode-ai-source":"agent","x-adcode-platform":platform },body:JSON.stringify({ model:"coder",messages:[{ role:"user",content:"hi" }],stream:false,max_tokens:20 }) }));
      await result.text(); return store.getModelRequest(result.headers.get("x-adcode-request-id")!);
    };
    expect(await send("web")).toMatchObject({ platform:"web" });
    expect(await send("android")).toMatchObject({ platform:"unknown" });
  });
  it("records upstream rate limits even when historical personal credit caps are exhausted",async () => {
    const { store,call,chat } = await setup(async () => new Response("test-key raw private error",{ status:429 }));
    const response = await chat(); expect(response.status).toBe(429);
    const row = await store.getModelRequest(response.headers.get("x-adcode-request-id")!);
    expect(row).toMatchObject({ outcome:"provider_error",errorCode:"upstream-rate-limit",upstreamStatus:429,inputTokens:0,estimated:false });
    expect(JSON.stringify(row)).not.toContain("test-key");
    await store.putTagflowPolicy("user",{ blocked:false,limits:null,credits:{ sessionCredits:0,weeklyCredits:100,sessionHours:5 },updatedAt:from,updatedBy:"admin" });
    const denied = await chat(); expect(denied.status).toBe(429);
    expect(await store.getModelRequest(denied.headers.get("x-adcode-request-id")!)).toMatchObject({ outcome:"provider_error",errorCode:"upstream-rate-limit",upstreamStatus:429 });
    const report = await (await call("/admin/tagflow/reports?from=2026-10-11&to=2026-10-11","admin")).json() as ModelReportResponse;
    expect(report.models[0]!.current).toMatchObject({ attempts:2,providerCalls:2,providerErrors:2,rejected:0 });
  });
  it("excludes admin tests and refuses client attempts to label themselves as an admin test",async () => {
    const { store,chat } = await setup(); const response = await chat("admin-test"); await response.text();
    expect(await store.getModelRequest(response.headers.get("x-adcode-request-id")!)).toMatchObject({ source:"unknown" });
    const row = requestRow({ source:"admin-test",upstreamModel:"coder" }); await store.putModelRequest(row);
    const report = await store.readModelReports(range);
    expect(report.models.find(model => model.upstreamModel === "coder")!.current.attempts).toBe(1);
  });
  it("excludes actual administrator test calls from customer reports",async () => {
    const { call,store } = await setup();
    const response = await call("/ai/tagflow/chat/completions","admin",{ model:"coder",messages:[{ role:"user",content:"Connection check" }],stream:false,max_tokens:20 },"admin-test");
    await response.text();
    expect(await store.getModelRequest(response.headers.get("x-adcode-request-id")!)).toMatchObject({ source:"admin-test",outcome:"success" });
    const report = await (await call("/admin/tagflow/reports","admin")).json() as ModelReportResponse;
    expect(report.models.every(model => model.current.attempts === 0)).toBe(true);
  });
  it("attributes accounting failures to ADCode instead of the provider",async () => {
    const { store,chat } = await setup();
    store.settleTagflow = async () => { throw new Error("database offline"); };
    const response = await chat(); expect(response.status).toBe(503);
    expect(await store.getModelRequest(response.headers.get("x-adcode-request-id")!)).toMatchObject({ outcome:"relay_error",errorCode:"storage-settlement" });
  });
  it("observes first tool output, deduplicates streamed calls and records interrupted streams",async () => {
    const encoder = new TextEncoder();
    const frame = (value:unknown) => encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
    const { store,call } = await setup(async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(frame({ choices:[{ index:0,delta:{ role:"assistant" } }] }));
      controller.enqueue(frame({ choices:[{ index:0,delta:{ tool_calls:[{ index:0,id:"call-1",function:{ name:"read_file",arguments:"{" } }] } }] }));
      controller.enqueue(frame({ choices:[{ index:0,delta:{ tool_calls:[{ index:0,function:{ arguments:"}" } }] },finish_reason:"tool_calls" }],usage:{ prompt_tokens:30,completion_tokens:5 } }));
      controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close();
    } }),{ headers:{ "content-type":"text/event-stream" } }));
    const response = await call("/ai/tagflow/chat/completions","user",{ model:"coder",messages:[{ role:"user",content:"Read" }],tools:[{ type:"function",function:{ name:"read_file",parameters:{} } }],stream:true,max_tokens:20 },"agent");
    await response.text();
    expect(await store.getModelRequest(response.headers.get("x-adcode-request-id")!)).toMatchObject({ outcome:"success",source:"agent",toolCalls:1,toolsOffered:true,finishReason:"tool_calls",firstTokenMs:1,inputTokens:30,outputTokens:5,estimated:false });
    const interrupted = await setup(async () => new Response(frame({ choices:[{ delta:{ content:"Partial" } }] }),{ headers:{ "content-type":"text/event-stream" } }));
    const partial = await interrupted.call("/ai/tagflow/chat/completions","user",{ model:"coder",messages:[{ role:"user",content:"Read" }],stream:true,max_tokens:20 }); await partial.text();
    expect(await interrupted.store.getModelRequest(partial.headers.get("x-adcode-request-id")!)).toMatchObject({ outcome:"provider_error",errorCode:"incomplete-stream",estimated:true });
  });
});
