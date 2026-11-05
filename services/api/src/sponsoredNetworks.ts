/**
 * The ad partners behind the sponsored card under an AI reply, and their order.
 *
 * Zeekend comes first and Imprezia fills what it leaves: Zeekend's exchange declines most turns
 * by design (it says about 85%), so asking it first and Imprezia second shows the most cards
 * with one card per reply. Both run only on the sponsored page (apps/web /sponsored/chat), in a
 * frame walled off from the editor, and each network's own SDK draws and measures its card.
 *
 * The sponsored page reads this list from `GET /v1/sponsored/networks`. A Zeekend publisher key
 * is public by design - Zeekend's SDK sends it from the browser - so it is part of the answer;
 * Imprezia's key is not, and stays behind the /v1/imprezia relay.
 */
import { adNetworkEncryptionKeys, decryptAdNetworkKey } from "./adNetworkCrypto.ts";
import type { AdNetworkConfig, AdNetworkStore } from "./adNetworkConfig.ts";

/** Zeekend's sandbox keys serve test placements that earn nothing; a live key is `pub_live_…`. */
export const ZEEKEND_SANDBOX_KEYS: readonly string[] = ["pub_test", "pub_sandbox", "pub_demo"];
export type ZeekendKeyMode = "sandbox" | "live";
export const isZeekendKey = (key: string): boolean => ZEEKEND_SANDBOX_KEYS.includes(key) || /^pub_live_[A-Za-z0-9_-]{4,200}$/.test(key);
export const zeekendKeyMode = (key: string): ZeekendKeyMode => (key.startsWith("pub_live_") ? "live" : "sandbox");
/** The placement Zeekend's own React component uses for a chat answer. */
export const ZEEKEND_DEFAULT_PLACEMENT = "chat-main";

export type SponsoredNetwork = { id: "zeekend"; publisherKey: string; placementId: string } | { id: "imprezia" };

export interface SponsoredNetworksDeps {
  readonly adNetworks: AdNetworkStore | undefined;
  readonly encryptionKeys?: () => readonly string[];
}

const isImpreziaChat = (config: AdNetworkConfig): boolean => config.provider === "imprezia" && config.imprezia?.kind === "chat";

/** The partners switched on, in the order the page asks them: Zeekend, then Imprezia. */
export async function sponsoredNetworks(deps: SponsoredNetworksDeps): Promise<SponsoredNetwork[]> {
  const port = deps.adNetworks;
  if (!port) return [];
  const keys = (deps.encryptionKeys ?? adNetworkEncryptionKeys)();
  const networks: SponsoredNetwork[] = [];
  try {
    const configs = (await port.list()).filter((config) => config.enabled).sort((a, b) => a.priority - b.priority);
    for (const config of configs.filter((one) => one.provider === "zeekend")) {
      const encrypted = await port.key(config.id);
      if (!encrypted || keys.length === 0) continue;
      let key: string;
      try { key = decryptAdNetworkKey(config.id, encrypted, keys); } catch { continue; }
      if (!isZeekendKey(key)) continue;
      networks.push({ id: "zeekend", publisherKey: key, placementId: config.zeekend?.placementId || ZEEKEND_DEFAULT_PLACEMENT });
      break;
    }
    for (const config of configs.filter(isImpreziaChat)) {
      if (await port.key(config.id)) { networks.push({ id: "imprezia" }); break; }
    }
  } catch {
    return networks;
  }
  return networks;
}
