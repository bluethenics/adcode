import type { TagflowConfig } from "./tagflowTypes.ts";
import { modelProvider, providerConnections, type IncludedProviderId } from "./includedProviders.ts";

const record = (raw: unknown): raw is Record<string, unknown> => raw !== null && typeof raw === "object" && !Array.isArray(raw);
const windowSize = (raw: unknown): number | null => typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 1024 && raw <= 10_000_000 ? raw : null;

/** Accept only explicit provider metadata. A model's marketing name never determines its size. */
export function providerContextWindows(raw: unknown): Map<string, number> {
  const result = new Map<string, number>();
  if (!record(raw)) return result;
  const models = raw["data"] ?? raw["models"];
  if (!Array.isArray(models) || models.length > 5000) return result;
  for (const model of models) {
    if (!record(model)) continue;
    const id = model["id"] ?? model["name"];
    if (typeof id !== "string" || id.length > 200) continue;
    const modality = Array.isArray(model["input_modalities"]) ? model["input_modalities"].find(one => record(one) && one["type"] === "text") as Record<string, unknown> | undefined : undefined;
    const supported = modality && record(modality["supported_inputs"]) ? modality["supported_inputs"] : undefined;
    const max = supported && record(supported["max_context_length"]) ? supported["max_context_length"]["value"] : undefined;
    const context = windowSize(max ?? model["context_length"] ?? model["context_window"] ?? model["contextWindow"] ?? model["max_context_length"] ?? model["max_model_len"] ?? model["max_model_length"] ?? model["inputTokenLimit"]);
    if (context !== null) result.set(id.replace(/^models\//, ""), context);
  }
  return result;
}

/** One refresh per hour/isolate. Missing metadata or a provider outage preserves the saved size. */
export function createProviderContextSync(fetchImpl: typeof fetch) {
  const cache = new Map<string, { expires: number; value: Map<string, number>; pending: Promise<Map<string, number>> | undefined }>();
  async function read(id: string, url: string, headers: Record<string, string>, now: number): Promise<Map<string, number>> {
    const key = `${id}:${url}`, previous = cache.get(key);
    if (previous?.pending) return previous.pending;
    if (previous && previous.expires > now) return previous.value;
    const entry = { expires: now + 3_600_000, value: previous?.value ?? new Map<string, number>(), pending: undefined as Promise<Map<string, number>> | undefined };
    entry.pending = (async () => {
      try {
        const response = await fetchImpl(url, { headers: { accept: "application/json", ...headers }, redirect: "manual", signal: AbortSignal.timeout(3000) });
        if (!response.ok || Number(response.headers.get("content-length")) > 4_000_000 || !response.body) { await response.body?.cancel(); return entry.value; }
        const reader = response.body.getReader(), decoder = new TextDecoder(); let body = "", size = 0;
        try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 4_000_000) { await reader.cancel(); return entry.value; } body += decoder.decode(chunk.value, { stream: true }); } } finally { reader.releaseLock(); }
        body += decoder.decode();
        const parsed = providerContextWindows(JSON.parse(body)); if (parsed.size) entry.value = parsed;
      } catch { /* Saved values remain usable offline. */ }
      finally { entry.pending = undefined; }
      return entry.value;
    })();
    cache.set(key, entry); return entry.pending;
  }
  return async (config: TagflowConfig, keyFor: (id: IncludedProviderId) => string, now: number): Promise<TagflowConfig> => {
    const metadata = new Map<IncludedProviderId, Map<string, number>>();
    await Promise.all(providerConnections(config.providers).map(async connection => {
      const key = keyFor(connection.id); if (!key) return;
      const publicUrl = connection.id === "custom-heabsy" ? "https://api.heabsy.com/site/v1/models" : connection.id === "openrouter" ? "https://openrouter.ai/api/v1/models" : null;
      const base = connection.id === "tagflow" ? config.baseUrl : connection.baseUrl;
      const headers = publicUrl ? {} : connection.authentication === "bearer" ? { authorization: `Bearer ${key}` } : { [connection.authentication]: key };
      metadata.set(connection.id, await read(connection.id, publicUrl ?? `${base.replace(/\/+$/, "")}/models`, headers, now));
    }));
    const models = config.models.map(model => {
      const contextWindow = metadata.get(modelProvider(model))?.get(model.upstreamModel ?? model.id);
      return contextWindow === undefined || contextWindow < model.maxOutput ? model : { ...model, contextWindow };
    });
    return { ...config, models, maxInputTokens: Math.max(config.maxInputTokens, ...models.map(model => model.contextWindow)) };
  };
}
