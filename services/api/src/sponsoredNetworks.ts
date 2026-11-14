/**
 * The ad partner behind sponsored cards: under an AI reply, in a sponsored notification and on
 * the phone.
 *
 * Zeekend is ADCode's only ad partner. Imprezia used to fill what Zeekend left; it is no longer
 * listed, so the sponsored page never asks it for a card (its admin connection may stay saved,
 * and serves nothing). Zeekend runs only on the sponsored page (apps/web /sponsored/chat), in a
 * frame walled off from the editor, and its own SDK draws and measures the card.
 *
 * The sponsored page reads this list from `GET /v1/sponsored/networks`. A Zeekend publisher key
 * is public by design - Zeekend's SDK sends it from the browser - so it is part of the answer.
 */
import { adNetworkEncryptionKeys, decryptAdNetworkKey } from "./adNetworkCrypto.ts";
import type { AdNetworkStore } from "./adNetworkConfig.ts";

/** Zeekend's sandbox keys serve test placements that earn nothing; a live key is `pub_live_…`. */
export const ZEEKEND_SANDBOX_KEYS: readonly string[] = ["pub_test", "pub_sandbox", "pub_demo"];
export type ZeekendKeyMode = "sandbox" | "live";
export const isZeekendKey = (key: string): boolean => ZEEKEND_SANDBOX_KEYS.includes(key) || /^pub_live_[A-Za-z0-9_-]{4,200}$/.test(key);
export const zeekendKeyMode = (key: string): ZeekendKeyMode => (key.startsWith("pub_live_") ? "live" : "sandbox");
/** The placement Zeekend's own React component uses for a chat answer. */
export const ZEEKEND_DEFAULT_PLACEMENT = "chat-main";

export type SponsoredNetwork = { id: "zeekend"; publisherKey: string; placementId: string };

export interface SponsoredNetworksDeps {
  readonly adNetworks: AdNetworkStore | undefined;
  readonly encryptionKeys?: () => readonly string[];
}

/** The Zeekend connection switched on with a valid key - the first by priority - or nothing. */
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
  } catch {
    return networks;
  }
  return networks;
}
