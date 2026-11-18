/**
 * A real-model proxy for comparing coding harnesses.
 *
 * The 14 November benchmark answered every harness with a scripted model, which isolates harness
 * overhead and nothing else. A reader replied - fairly - that model reasoning time, task success
 * and cache-adjusted billing need their own measurements. This proxy is that measurement: every
 * harness talks to it in its own API format (Anthropic Messages or OpenAI Chat Completions), and
 * every request goes on, translated, to the same real model through ADCode's included-AI relay.
 *
 * It records, per request: what the harness sent (tokens, o200k), the model's own time, the
 * tokens the model was billed for, and the longest prefix shared with the same run's previous
 * request - the part a prompt cache can serve. The relay credential comes from this computer's
 * signed-in ADCode account and is used only here: no harness ever sees it.
 *
 * Bundle with ../token-benchmark-2026-11-14/build.mjs, then: node proxy.mjs <port> <outDir> [model]
 */
import { createServer, type ServerResponse } from "node:http";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createBackendTokens, apiBaseUrl } from "E:/adcode-sourcecode/apps/desktop/src/main/backend.ts";
import { DiskFileStore, FetchHttpTransport, SystemClock } from "E:/adcode-sourcecode/apps/desktop/src/main/adPorts.ts";

const PORT = Number(process.argv[2] ?? 8790);
const OUT = process.argv[3] ?? "runs";
const MODEL = process.argv[4] ?? "tagflow-code-flash-1";
const USER_DATA = process.env["ADCODE_USER_DATA"] ?? join(process.env["APPDATA"] ?? "", "@adcode", "desktop");
mkdirSync(OUT, { recursive: true });
const tokens = createBackendTokens({ http: new FetchHttpTransport([]), clock: new SystemClock(), store: new DiskFileStore(join(USER_DATA, "ads")) });

let run = "default";
let seq = 0;
const previous = new Map<string, string>();
/**
 * Off unless set: the least time between one reply of a run and its next request. Used to test
 * whether a harness that answers within milliseconds arrives before the provider has written
 * its prefix cache.
 */
const MIN_GAP_MS = Number(process.env["PROXY_MIN_GAP_MS"] ?? 0);
const lastReply = new Map<string, number>();
/** Off unless set: send each run's requests with one prompt_cache_key, to test sticky caching upstream. */
const CACHE_KEY = process.env["PROXY_CACHE_KEY"] === "1";

type Json = Record<string, unknown>;
interface ChatMessage { role: string; content?: unknown; tool_calls?: unknown[]; tool_call_id?: string; name?: string }

const textOf = (content: unknown): string => typeof content === "string" ? content
  : Array.isArray(content) ? content.map((block: Json) => typeof block?.["text"] === "string" ? block["text"] as string : typeof block?.["content"] === "string" ? block["content"] as string : Array.isArray(block?.["content"]) ? textOf(block["content"]) : "").join("\n") : "";

/** Anthropic Messages -> OpenAI Chat Completions. */
function fromAnthropic(body: Json): Json {
  const messages: ChatMessage[] = [];
  const system = textOf(body["system"]);
  if (system) messages.push({ role: "system", content: system });
  for (const message of (body["messages"] as Json[] | undefined) ?? []) {
    const blocks = typeof message["content"] === "string" ? [{ type: "text", text: message["content"] }] : (message["content"] as Json[]) ?? [];
    if (message["role"] === "assistant") {
      const text = blocks.filter((b) => b["type"] === "text").map((b) => b["text"]).join("\n");
      const calls = blocks.filter((b) => b["type"] === "tool_use").map((b) => ({ id: b["id"], type: "function", function: { name: b["name"], arguments: JSON.stringify(b["input"] ?? {}) } }));
      messages.push({ role: "assistant", content: text || null, ...(calls.length > 0 ? { tool_calls: calls } : {}) });
    } else {
      for (const block of blocks.filter((b) => b["type"] === "tool_result")) messages.push({ role: "tool", tool_call_id: String(block["tool_use_id"]), content: textOf(block["content"]) || "(empty)" });
      const text = blocks.filter((b) => b["type"] === "text").map((b) => b["text"]).join("\n");
      if (text) messages.push({ role: "user", content: text });
    }
  }
  const tools = ((body["tools"] as Json[] | undefined) ?? []).filter((tool) => tool["input_schema"] !== undefined)
    .map((tool) => ({ type: "function", function: { name: tool["name"], description: tool["description"] ?? "", parameters: tool["input_schema"] } }));
  return { messages, ...(tools.length > 0 ? { tools } : {}), max_tokens: Math.min(Number(body["max_tokens"] ?? 8192), 16_000) };
}

function fromChat(body: Json): Json {
  const { model: _model, stream: _stream, stream_options: _options, ...rest } = body;
  return rest;
}

/** Characters both serialised requests start with, as a token estimate (4 characters a token). */
function sharedPrefixTokens(a: string, b: string): number {
  let i = 0;
  const n = Math.min(a.length, b.length);
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return Math.floor(i / 4);
}

async function upstream(request: Json): Promise<{ status: number; json: Json; ms: number }> {
  const token = await tokens.getToken();
  if (!token.ok) throw new Error("Sign in to ADCode on this computer first: the proxy uses its included AI.");
  const started = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${apiBaseUrl()}/ai/tagflow/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.value}`, "content-type": "application/json", "x-adcode-ai-source": "agent", "x-adcode-platform": "benchmark" },
      body: JSON.stringify({ ...request, model: MODEL, stream: false }),
      signal: AbortSignal.timeout(300_000),
    });
    const json = await response.json().catch(() => ({})) as Json;
    if ((response.status === 429 || response.status >= 500) && attempt < 4) { await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1))); continue; }
    return { status: response.status, json, ms: Date.now() - started };
  }
}

const sse = (res: ServerResponse, event: string | null, data: unknown): void => { res.write(`${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(data)}\n\n`); };

function toAnthropic(res: ServerResponse, json: Json, stream: boolean, model: string): void {
  const choice = ((json["choices"] as Json[] | undefined) ?? [])[0] ?? {};
  const message = (choice["message"] as Json | undefined) ?? {};
  const usage = (json["usage"] as Json | undefined) ?? {};
  const calls = (message["tool_calls"] as Json[] | undefined) ?? [];
  const content: Json[] = [];
  if (typeof message["content"] === "string" && message["content"].trim()) content.push({ type: "text", text: message["content"] });
  for (const call of calls) {
    const fn = call["function"] as Json;
    let input: unknown = {};
    try { input = JSON.parse(String(fn["arguments"] ?? "{}")); } catch { input = {}; }
    content.push({ type: "tool_use", id: String(call["id"] ?? `toolu_${String(seq)}`), name: fn["name"], input });
  }
  if (content.length === 0) content.push({ type: "text", text: "" });
  const cached = Number((usage["prompt_tokens_details"] as Json | undefined)?.["cached_tokens"] ?? 0);
  const out = { id: `msg_${String(seq)}`, type: "message", role: "assistant", model, content, stop_reason: calls.length > 0 ? "tool_use" : choice["finish_reason"] === "length" ? "max_tokens" : "end_turn", stop_sequence: null,
    usage: { input_tokens: Number(usage["prompt_tokens"] ?? 0) - cached, output_tokens: Number(usage["completion_tokens"] ?? 0), cache_read_input_tokens: cached, cache_creation_input_tokens: 0 } };
  if (!stream) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(out)); return; }
  res.writeHead(200, { "content-type": "text/event-stream" });
  sse(res, "message_start", { type: "message_start", message: { ...out, content: [], stop_reason: null, usage: { ...out.usage, output_tokens: 1 } } });
  content.forEach((block, index) => {
    if (block["type"] === "text") {
      sse(res, "content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
      sse(res, "content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: block["text"] } });
    } else {
      sse(res, "content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: block["id"], name: block["name"], input: {} } });
      sse(res, "content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block["input"]) } });
    }
    sse(res, "content_block_stop", { type: "content_block_stop", index });
  });
  sse(res, "message_delta", { type: "message_delta", delta: { stop_reason: out.stop_reason, stop_sequence: null }, usage: { output_tokens: out.usage.output_tokens } });
  sse(res, "message_stop", { type: "message_stop" });
  res.end();
}

function toChat(res: ServerResponse, json: Json, stream: boolean): void {
  if (!stream) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(json)); return; }
  const choice = ((json["choices"] as Json[] | undefined) ?? [])[0] ?? {};
  const message = (choice["message"] as Json | undefined) ?? {};
  const base = { id: json["id"] ?? `chatcmpl_${String(seq)}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: json["model"] ?? MODEL };
  res.writeHead(200, { "content-type": "text/event-stream" });
  sse(res, null, { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  if (typeof message["content"] === "string" && message["content"]) sse(res, null, { ...base, choices: [{ index: 0, delta: { content: message["content"] }, finish_reason: null }] });
  const calls = (message["tool_calls"] as Json[] | undefined) ?? [];
  if (calls.length > 0) sse(res, null, { ...base, choices: [{ index: 0, delta: { tool_calls: calls.map((call, index) => ({ index, ...call })) }, finish_reason: null }] });
  sse(res, null, { ...base, choices: [{ index: 0, delta: {}, finish_reason: choice["finish_reason"] ?? (calls.length > 0 ? "tool_calls" : "stop") }] });
  sse(res, null, { ...base, choices: [], usage: json["usage"] ?? null });
  res.write("data: [DONE]\n\n");
  res.end();
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${String(PORT)}`);
  if (url.pathname === "/__run") { run = url.searchParams.get("name") ?? "default"; previous.delete(run); res.end("ok"); return; }
  let raw = "";
  req.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
  req.on("end", () => void (async () => {
    const path = url.pathname;
    if (/\/models$/.test(path) && req.method === "GET") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ object: "list", data: [{ id: "bench-model", object: "model", created: 0, owned_by: "bench" }] })); return; }
    if (path.endsWith("count_tokens")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: Math.ceil(raw.length / 4) })); return; }
    const api = /\/messages$/.test(path) ? "anthropic" : /chat\/completions$/.test(path) ? "chat" : null;
    let body: Json | null = null;
    try { body = raw ? JSON.parse(raw) as Json : null; } catch { body = null; }
    if (api === null || body === null) { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: `The benchmark proxy does not serve ${path}` } })); return; }
    const id = ++seq;
    const at = Date.now();
    const request = api === "anthropic" ? fromAnthropic(body) : fromChat(body);
    const serialised = JSON.stringify(request);
    const shared = sharedPrefixTokens(previous.get(run) ?? "", serialised);
    // Kept for the analysis, which counts tokens and cacheable prefixes with a real tokenizer.
    writeFileSync(join(OUT, `${run}-${String(id).padStart(5, "0")}.json`), serialised);
    previous.set(run, serialised);
    try {
      const since = Date.now() - (lastReply.get(run) ?? 0);
      if (MIN_GAP_MS > 0 && since < MIN_GAP_MS) await new Promise((resolve) => setTimeout(resolve, MIN_GAP_MS - since));
      const answer = await upstream(CACHE_KEY ? { ...request, prompt_cache_key: `bench-${run}` } : request);
      lastReply.set(run, Date.now());
      const usage = (answer.json["usage"] as Json | undefined) ?? {};
      appendFileSync(join(OUT, "log.jsonl"), `${JSON.stringify({ run, id, at, api, sentChars: serialised.length, sentTokensEstimate: Math.ceil(serialised.length / 4), sharedPrefixTokens: shared, tools: ((request["tools"] as unknown[] | undefined) ?? []).length, status: answer.status, modelMs: answer.ms, promptTokens: usage["prompt_tokens"] ?? null, completionTokens: usage["completion_tokens"] ?? null, cachedTokens: (usage["prompt_tokens_details"] as Json | undefined)?.["cached_tokens"] ?? null, finish: (((answer.json["choices"] as Json[] | undefined) ?? [])[0] ?? {})["finish_reason"] ?? null })}\n`);
      if (answer.status !== 200) { res.writeHead(answer.status, { "content-type": "application/json" }); res.end(JSON.stringify(answer.json)); return; }
      if (api === "anthropic") toAnthropic(res, answer.json, body["stream"] === true, String(body["model"] ?? MODEL));
      else toChat(res, answer.json, body["stream"] === true);
    } catch (error) {
      appendFileSync(join(OUT, "log.jsonl"), `${JSON.stringify({ run, id, at, api, error: error instanceof Error ? error.message : String(error) })}\n`);
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : "proxy failed" } }));
    }
  })());
}).listen(PORT, () => { console.log(`benchmark proxy on ${String(PORT)} -> ${MODEL}`); });
