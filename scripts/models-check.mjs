/**
 * Does each model on the list actually work? Ask it.
 *
 * Reported: "for a lot of models I am getting errors" - and "all AI models must be working".
 * A request-body test proves ADCode sends what each provider documents; only a real request
 * proves the provider accepts it. This sends two through the same adapters the app uses:
 *
 *   plain  - "Reply with the single word: ok", no tools
 *   tools  - a tool round trip: the model calls get_number, gets 42, and says it
 *
 * for every provider whose key is in the environment, and writes what happened to
 * artifacts/models-check-<date>.json. Keys are read from the usual variables and never
 * printed or written anywhere.
 *
 *   OPENAI_API_KEY=... GEMINI_API_KEY=... npm run models:check
 *   npm run models:check -- --all              every usable model, not the top five
 *   npm run models:check -- --provider google  one provider
 *   npm run models:check -- --model gpt-6.1-sol
 *
 * Costs a few requests per model on your own keys; --all on OpenRouter is over 300 models.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAgent } from "../packages/ai/src/agent.ts";
import { BUNDLED_CATALOGUE, baseUrlFor, parseCatalogue, recommendedModel, traitsOf, usableCatalogue } from "../packages/ai/src/catalogue.ts";
import { createAnthropicProvider } from "../packages/ai/src/providers/anthropic.ts";
import { createGoogleProvider } from "../packages/ai/src/providers/google.ts";
import { createOpenAiCompatibleProvider } from "../packages/ai/src/providers/openaiCompatible.ts";

const KEYS = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  groq: ["GROQ_API_KEY"],
  xai: ["XAI_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
  "fireworks-ai": ["FIREWORKS_API_KEY"],
};

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? null);
};
const ALL = args.includes("--all");
const ONLY_PROVIDER = flag("--provider");
const ONLY_MODEL = flag("--model");
const TIMEOUT_MS = 120_000;

const keyFor = (provider) => {
  for (const name of KEYS[provider] ?? []) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
};

async function catalogue() {
  try {
    const response = await fetch("https://models.dev/api.json", { signal: AbortSignal.timeout(60_000) });
    if (response.ok) {
      const live = usableCatalogue(parseCatalogue(await response.json()));
      if (live.length > 0) return { providers: live, source: "models.dev (live)" };
    }
  } catch {
    // The bundled snapshot is the fallback.
  }
  return { providers: BUNDLED_CATALOGUE, source: "bundled snapshot" };
}

function providerFor(id, key, providers) {
  const traits = (model) => traitsOf(providers, id, model);
  if (id === "anthropic") return createAnthropicProvider({ apiKey: key, traits });
  if (id === "google") return createGoogleProvider({ apiKey: key, traits });
  const baseUrl = baseUrlFor(id);
  if (baseUrl === null) return null;
  return createOpenAiCompatibleProvider({ id, displayName: id, baseUrl, apiKey: key, models: [], traits });
}

const NUMBER_TOOL = {
  name: "get_number",
  description: "Returns the number the user is asking about.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  mutating: false,
};

/** One request through the real agent loop: what it said, which tools it called, and how it ended. */
async function ask(provider, model, providers, prompt, tools) {
  const started = Date.now();
  const traits = traitsOf(providers, provider.id, model);
  const agent = createAgent({
    provider,
    model,
    tools,
    maxTokens: Math.min(4096, traits?.maxOutput ?? 4096),
    ...(traits?.maxOutput ? { maxOutputTokens: Math.min(traits.maxOutput, 32_768) } : {}),
    runner: { run: async () => ({ content: "42", isError: false }) },
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let text = "";
  const called = [];
  let ending = "none";
  let error = null;
  try {
    for await (const event of agent.send(prompt, { signal: controller.signal })) {
      if (event.kind === "text") text += event.text;
      if (event.kind === "tool-call") called.push(event.call.name);
      if (event.kind === "turn-end") ending = event.reason;
      if (event.kind === "error") { ending = "error"; error = event.detail; }
      if (event.kind === "refusal") { ending = "refusal"; error = event.detail; }
      if (event.kind === "cancelled") { ending = "timeout"; error = `no answer within ${TIMEOUT_MS / 1000}s`; }
    }
  } catch (thrown) {
    ending = "error";
    error = thrown instanceof Error ? thrown.message : String(thrown);
  } finally {
    clearTimeout(timer);
  }
  return { ms: Date.now() - started, text: text.trim().slice(0, 200), called, ending, error: error?.slice(0, 500) ?? null };
}

async function main() {
  const { providers, source } = await catalogue();
  const results = [];
  const tested = providers.filter((provider) => (ONLY_PROVIDER === null || provider.id === ONLY_PROVIDER) && keyFor(provider.id) !== null);
  const missing = providers.filter((provider) => keyFor(provider.id) === null).map((provider) => provider.id);

  process.stdout.write(`catalogue: ${source}\n`);
  if (tested.length === 0) {
    process.stdout.write(`No provider keys in the environment. Set any of: ${Object.values(KEYS).flat().join(", ")}\n`);
    process.exit(2);
  }

  for (const provider of tested) {
    const key = keyFor(provider.id);
    const adapter = providerFor(provider.id, key, providers);
    if (adapter === null) continue;
    const recommended = recommendedModel(providers, provider.id);
    const models = ONLY_MODEL !== null
      ? provider.models.filter((model) => model.id === ONLY_MODEL)
      : ALL
        ? provider.models
        : [...new Set([recommended, ...provider.models.slice(0, 5).map((model) => model.id)])]
          .map((id) => provider.models.find((model) => model.id === id))
          .filter(Boolean);

    for (const model of models) {
      const plain = await ask(adapter, model.id, providers, "Reply with the single word: ok", []);
      const tools = await ask(adapter, model.id, providers, "Call get_number, then reply with just the number it returned.", [NUMBER_TOOL]);
      const result = {
        provider: provider.id,
        model: model.id,
        recommended: model.id === recommended,
        plain: { ok: plain.ending === "end-turn" && /ok/i.test(plain.text), ...plain },
        tools: { ok: tools.ending === "end-turn" && tools.called.includes("get_number") && /42/.test(tools.text), ...tools },
      };
      results.push(result);
      const mark = (check) => (check.ok ? "ok  " : "FAIL");
      process.stdout.write(
        `${mark(result.plain)} ${mark(result.tools)} ${provider.id}/${model.id}` +
          (result.plain.ok && result.tools.ok ? "" : `  - ${result.tools.error ?? result.plain.error ?? `${result.tools.ending}: "${result.tools.text}"`}`) +
          "\n",
      );
    }
  }

  const day = new Date().toISOString().slice(0, 10);
  const target = join(process.cwd(), "artifacts", `models-check-${day}.json`);
  await mkdir(join(process.cwd(), "artifacts"), { recursive: true });
  await writeFile(target, JSON.stringify({ checkedAt: new Date().toISOString(), catalogue: source, untested: missing, results }, null, 2), "utf8");
  const working = results.filter((one) => one.plain.ok && one.tools.ok).length;
  process.stdout.write(`\n${String(working)} of ${String(results.length)} models answered and used a tool. Details: ${target}\n`);
  if (missing.length > 0) process.stdout.write(`Not tested (no key): ${missing.join(", ")}\n`);
}

await main();
