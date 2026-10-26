import type { ServeRequestBody, ServeResponseBody, SubmittedReceipt } from "./contract.ts";
import { AD_NETWORK_ID, adNetworkReadiness, parseAdNetworkConfig } from "./adNetworkConfig.ts";
import { adNetworkEncryptionKeys, decryptAdNetworkKey, encryptAdNetworkKey } from "./adNetworkCrypto.ts";
import { AdNetworkProviderError, previewBeehiiv, requestNetworkCreative, verifyNetworkEvent } from "./adNetworkHttp.ts";
import { checkReceipt, CLOCK_SKEW_MS } from "./plausibility.ts";
import { previewImprezia } from "./impreziaPreview.ts";
import type { Clock, IdGen, Store } from "./store.ts";
export interface AdNetworkRuntime { fetchImpl?: typeof fetch; encryptionKeys?: () => readonly string[]; assetOrigin?: string }
export interface AdNetworkDeps extends AdNetworkRuntime { store: Store; clock: Clock; ids: IdGen }
const keysFor = (deps: AdNetworkRuntime): readonly string[] => (deps.encryptionKeys ?? adNetworkEncryptionKeys)();

/** External demand fills an otherwise empty slot; direct campaigns and test serves always keep priority. */
export async function serveAdNetwork(deps: AdNetworkDeps, uid: string, body: ServeRequestBody, ttlMs: number): Promise<ServeResponseBody> {
  const port = deps.store.adNetworks;
  if (!port) return { creatives: [] };
  try {
    const keys = keysFor(deps);
    if (keys.length === 0) return { creatives: [] };
    const configs = (await port.list()).filter(config => config.enabled && config.provider === "http-json").slice(0, 3);
    // Independent requests share one timeout wave, keeping provider failover within the editor's serve deadline.
    const attempts = await Promise.allSettled(configs.map(async config => {
      const encrypted = await port.key(config.id);
      if (!encrypted) return null;
      const key = decryptAdNetworkKey(config.id, encrypted, keys);
      const id = `an_${deps.ids.next("n")}`;
      const creative = await requestNetworkCreative(config, key, body, id, ttlMs, deps.fetchImpl);
      return creative ? { config, id, creative } : null;
    }));
    for (const attempt of attempts) {
      if (attempt.status !== "fulfilled" || !attempt.value) continue;
      const { config, id, creative } = attempt.value;
      const now = deps.clock.now();
      await port.recordDelivery({ id, networkId: config.id, uid, creativeId: id, providerCreativeId: creative.providerCreativeId, servedAt: now, expiresAt: now + ttlMs, viewPayoutMicros: config.viewPayoutMicros, clickPayoutMicros: config.clickPayoutMicros, logoLight: creative.logoLight, logoDark: creative.logoDark });
      const { providerCreativeId: _providerId, ...safe } = creative;
      const origin = deps.assetOrigin ?? "https://adcode.bluethenics.com";
      return { creatives: [{ ...safe, creativeId: id, logoLight: `${origin}/assets/network_${id}_light.png`, logoDark: `${origin}/assets/network_${id}_dark.png` }] };
    }
  } catch { /* Additive migration may not yet be applied; ordinary ads continue. */ }
  return { creatives: [] };
}

/** A client receipt proposes an event. Only an owned, plausible delivery confirmed by the provider can earn. */
export async function settleAdNetworkReceipt(deps: AdNetworkDeps, uid: string, receipt: SubmittedReceipt): Promise<"settled" | "duplicate" | "rejected" | "unavailable" | null> {
  if (!receipt.creativeId.startsWith("an_") || !deps.store.adNetworks) return null;
  const port = deps.store.adNetworks;
  try {
    const delivery = await port.delivery(uid, receipt.creativeId);
    if (!delivery) return "rejected";
    if (receipt.outcome !== "dismissed" && delivery.settledEvents?.includes(receipt.outcome)) return "duplicate";
    const now = deps.clock.now();
    const verdict = checkReceipt(receipt, { serveId: delivery.id, uid, creativeId: delivery.creativeId, campaignId: delivery.networkId, servedAt: delivery.servedAt, expiresAt: delivery.expiresAt, maxBidCpmMicros: 0n, clearingCpmMicros: 0n, costMicros: 0n }, now);
    if (!verdict.ok || receipt.outcome === "dismissed" || receipt.shownAt + receipt.dwellMs > now + CLOCK_SKEW_MS) return "rejected";
    const [config, encrypted] = await Promise.all([port.get(delivery.networkId), port.key(delivery.networkId)]);
    if (!config?.enabled || !encrypted) return "rejected";
    const key = decryptAdNetworkKey(config.id, encrypted, keysFor(deps));
    const providerEventId = await verifyNetworkEvent(config, key, delivery, receipt.outcome, deps.fetchImpl);
    if (!providerEventId) return "rejected";
    return await port.settle(delivery.id, receipt.outcome, providerEventId, now) ? "settled" : "duplicate";
  } catch { return "unavailable"; }
}

export async function handleAdNetworkAdmin(deps: AdNetworkDeps, adminUid: string, path: string, method: string, raw?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const port = deps.store.adNetworks;
  const response = (status: number, body: Record<string, unknown>) => ({ status, body });
  if (!port) return response(503, { error: "ad-networks-unavailable" });
  if (path === "/v1/admin/ad-networks") {
    if (method === "GET") {
      const networks = await Promise.all((await port.list()).map(async config => {
        const keyConfigured = await port.key(config.id) !== null;
        return { ...config, keyConfigured, readiness: adNetworkReadiness(config, keyConfigured) };
      }));
      return response(200, { networks, credentialsManageable: keysFor(deps).length > 0 });
    }
    if (method === "PUT") {
      const config = parseAdNetworkConfig(raw);
      if (!config) return response(400, { error: "invalid-network", message: "Check the network settings. Named providers support previews only; Imprezia needs provisioned inventory and zero payouts." });
      if (config.enabled && (!keysFor(deps).length || !await port.key(config.id))) return response(409, { error: "key-required", message: "Save the connection disabled, then save its API key before enabling it." });
      await port.put(config, adminUid, deps.clock.now());
      await deps.store.writeAudit({ adminUid, action: "ad-network-save", subjectUid: config.id, at: deps.clock.now() });
      return response(200, { ok: true });
    }
    return response(405, { error: "method-not-allowed" });
  }
  const match = /^\/v1\/admin\/ad-networks\/([a-z0-9-]+)\/(key|test)$/.exec(path);
  if (!match || !AD_NETWORK_ID.test(match[1]!)) return response(404, { error: "not-found" });
  const id = match[1]!;
  const config = await port.get(id);
  if (!config) return response(404, { error: "not-found" });
  if (match[2] === "key" && method === "PUT") {
    const key = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)["key"] : undefined;
    if (key !== null && (typeof key !== "string" || key.trim().length === 0 || key.length > 8192 || /[\r\n]/.test(key))) return response(400, { error: "invalid-key" });
    const keys = keysFor(deps);
    if (key !== null && !keys[0]) return response(503, { error: "encryption-not-configured", message: "Set AD_NETWORK_ENCRYPTION_KEY once before saving provider API keys." });
    await port.putKey(id, key === null ? null : encryptAdNetworkKey(id, key as string, keys[0]!));
    await deps.store.writeAudit({ adminUid, action: key === null ? "ad-network-key-remove" : "ad-network-key-save", subjectUid: id, at: deps.clock.now() });
    return response(200, { ok: true, keyConfigured: key !== null });
  }
  if (match[2] === "test" && method === "POST") {
    if (config.provider === "imprezia" && !config.imprezia) return response(409, { error: "inventory-required", message: "Enter the app bundle or site domain provisioned by Imprezia Exchange before testing." });
    const encrypted = await port.key(id);
    if (!encrypted) return response(409, { error: "key-required" });
    try {
      const key = decryptAdNetworkKey(id, encrypted, keysFor(deps));
      if (config.provider === "imprezia") return response(200, { ok: true, creative: await previewImprezia(config, key, deps.ids.next("test"), deps.fetchImpl), readiness: "exchange-test-only" });
      if (config.provider === "beehiiv") return response(200, { ok: true, advertisements: await previewBeehiiv(config, key, deps.fetchImpl), readiness: "newsletter-preview-only" });
      const creative = await requestNetworkCreative(config, key, { tags: [], themeKind: "light", count: 1 }, deps.ids.next("test"), 60_000, deps.fetchImpl);
      return response(200, { ok: true, creative });
    } catch (error) {
      return response(502, { error: "provider-unavailable", message: error instanceof AdNetworkProviderError ? error.message : "The connection could not be tested. Check the API key and encryption settings." });
    }
  }
  return response(405, { error: "method-not-allowed" });
}
