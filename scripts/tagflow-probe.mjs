/*
 * Does Tag Flow AI do what ADCode needs? A live check against the real gateway.
 *
 * ADCode's agent works through tool calls - read a file, write a file, run a command - so a
 * model that streams text but cannot call a tool can chat but not build. Tag Flow's gateway
 * does not declare `tools` in its schema, so this asks it directly:
 *
 *   1. which models it serves (its public index, and /v1/models with the key),
 *   2. a streamed reply, and how soon the first words arrive,
 *   3. a tool call, and an answer that uses the tool's result,
 *   4. what it says about each model's context size, if anything.
 *
 * The key comes from TAGFLOW_API_KEY, or from a `.env.local` beside the repo (gitignored). It
 * is never printed. Nothing else is sent anywhere.
 *
 *   node scripts/tagflow-probe.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.env.TAGFLOW_BASE_URL ?? "https://api.tagflow-ai.com/v1").replace(/\/+$/, "");

function keyFrom() {
  if (process.env.TAGFLOW_API_KEY) return process.env.TAGFLOW_API_KEY.trim();
  for (const dir of [process.cwd(), "E:/adcode-sourcecode"]) {
    try {
      const line = readFileSync(join(dir, ".env.local"), "utf8").split(/\r?\n/).find((one) => one.startsWith("TAGFLOW_API_KEY="));
      if (line) return line.slice("TAGFLOW_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
    } catch {}
  }
  return "";
}

const key = keyFrom();
const report = { base: BASE, keyFound: key.length > 0 };
const scrub = (text) => (key ? String(text).split(key).join("[key]") : String(text));
const headers = { "content-type": "application/json", authorization: `Bearer ${key}` };

async function json(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
  return { status: response.status, body };
}

/** One streamed chat completion: the text, any tool calls, and timings. */
async function stream(payload) {
  const started = Date.now();
  const response = await fetch(`${BASE}/chat/completions`, { method: "POST", headers, body: JSON.stringify({ ...payload, stream: true }), signal: AbortSignal.timeout(180_000) });
  if (!response.ok || response.body === null) return { status: response.status, error: scrub((await response.text()).slice(0, 500)) };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let firstTokenMs = null;
  let finish = null;
  let chunks = 0;
  const calls = new Map();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let event;
      try { event = JSON.parse(data); } catch { continue; }
      chunks += 1;
      const choice = event.choices?.[0];
      const delta = choice?.delta ?? {};
      if (typeof delta.content === "string" && delta.content.length > 0) {
        firstTokenMs ??= Date.now() - started;
        text += delta.content;
      }
      for (const call of delta.tool_calls ?? []) {
        firstTokenMs ??= Date.now() - started;
        const at = call.index ?? 0;
        const sofar = calls.get(at) ?? { id: "", name: "", args: "" };
        if (call.id) sofar.id = call.id;
        if (call.function?.name) sofar.name += call.function.name;
        if (call.function?.arguments) sofar.args += call.function.arguments;
        calls.set(at, sofar);
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
    }
  }
  return { status: response.status, ms: Date.now() - started, firstTokenMs, chunks, finish, text, toolCalls: [...calls.values()] };
}

try {
  const index = await json(BASE.replace(/\/v1$/, "/"), {});
  report.index = index.body;

  if (!key) {
    report.stopped = "No key. Put TAGFLOW_API_KEY=... in E:/adcode-sourcecode/.env.local and run again.";
  } else {
    const models = await json(`${BASE}/models`, { headers });
    report.models = models.status === 200 ? models.body : { status: models.status, body: scrub(JSON.stringify(models.body)) };
    const model = (Array.isArray(index.body?.models) ? index.body.models[0] : null) ?? "tagflow-code-27b";
    report.model = model;
    const detail = await json(`${BASE}/models/${encodeURIComponent(model)}`, { headers });
    report.modelDetail = detail.status === 200 ? detail.body : { status: detail.status };

    report.chat = await stream({ model, max_tokens: 64, messages: [{ role: "user", content: "Reply with exactly: ready" }] });

    const tools = [{
      type: "function",
      function: {
        name: "read_file",
        description: "Read a file from the user's project and return its contents.",
        parameters: { type: "object", properties: { path: { type: "string", description: "Path relative to the project root" } }, required: ["path"] },
      },
    }];
    const ask = [
      { role: "system", content: "You are a coding assistant. Use the tools to look at files before answering." },
      { role: "user", content: "What is the project's name? It is in package.json." },
    ];
    const first = await stream({ model, max_tokens: 512, tools, messages: ask });
    report.toolCall = { ...first, text: first.text?.slice(0, 300) };
    const call = first.toolCalls?.[0];
    if (call !== undefined && call.name === "read_file") {
      const id = call.id || "call_1";
      const second = await stream({
        model,
        max_tokens: 256,
        tools,
        messages: [
          ...ask,
          { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: call.name, arguments: call.args } }] },
          { role: "tool", tool_call_id: id, content: JSON.stringify({ name: "snake-garden", version: "1.0.0" }) },
        ],
      });
      report.toolResultUsed = { ...second, usesResult: /snake-garden/i.test(second.text ?? "") };
    }

    report.verdict = {
      streams: report.chat?.status === 200 && (report.chat?.text ?? "").length > 0,
      callsTools: Array.isArray(report.toolCall?.toolCalls) && report.toolCall.toolCalls.some((one) => one.name === "read_file"),
      usesToolResults: report.toolResultUsed?.usesResult === true,
    };
  }
} catch (error) {
  report.threw = scrub(error?.stack ?? error);
}

console.log(scrub(JSON.stringify(report, null, 2)));
