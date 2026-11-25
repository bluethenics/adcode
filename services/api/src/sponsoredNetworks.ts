/**
 * The ad partners behind sponsored cards: in the ad box above the chat's message box, in a
 * sponsored notification, under an AI reply and on the phone.
 *
 * Zeekend and Imprezia, each switched on in Admin > Ad networks (2026-11-25). Each slot goes to
 * one of them by the shares set there (adNetworkConfig.ts NetworkMix), and a network with no
 * card hands the slot to the next, so people see cards as often as with one partner while the
 * requests are divided between them. Both run only on the sponsored page (apps/web
 * /sponsored/chat), in a frame walled off from the editor, and each network's own SDK draws
 * and measures its card.
 *
 * The sponsored page reads this list from `GET /v1/sponsored/networks`. A Zeekend publisher key
 * is public by design - Zeekend's SDK sends it from the browser - so it is part of the answer.
 * Imprezia's key is not, and stays behind the /v1/imprezia relay (impreziaProxy.ts).
 */
import { adNetworkEncryptionKeys, decryptAdNetworkKey } from "./adNetworkCrypto.ts";
import { isChatNetwork, networkMix, type AdNetworkStore, type CardPlace } from "./adNetworkConfig.ts";

/** Zeekend's sandbox keys serve test placements that earn nothing; a live key is `pub_live_…`. */
export const ZEEKEND_SANDBOX_KEYS: readonly string[] = ["pub_test", "pub_sandbox", "pub_demo"];
export type ZeekendKeyMode = "sandbox" | "live";
export const isZeekendKey = (key: string): boolean => ZEEKEND_SANDBOX_KEYS.includes(key) || /^pub_live_[A-Za-z0-9_-]{4,200}$/.test(key);
export const zeekendKeyMode = (key: string): ZeekendKeyMode => (key.startsWith("pub_live_") ? "live" : "sandbox");
/** The placement Zeekend's own React component uses for a chat answer. */
export const ZEEKEND_DEFAULT_PLACEMENT = "chat-main";

/** What every network in the list carries: its share of the slots and where it may appear. */
interface Part { share: number; places: CardPlace[] }
export type SponsoredNetwork =
  | ({ id: "zeekend"; publisherKey: string; placementId: string } & Part)
  | ({ id: "imprezia"; placementId?: string } & Part);

export interface SponsoredNetworksDeps {
  readonly adNetworks: AdNetworkStore | undefined;
  readonly encryptionKeys?: () => readonly string[];
}

/**
 * The chat networks switched on with a usable key, the first connection of each by priority,
 * in priority order. Imprezia's key is only checked for, never sent: its relay adds it.
 */
export async function sponsoredNetworks(deps: SponsoredNetworksDeps): Promise<SponsoredNetwork[]> {
  const port = deps.adNetworks;
  if (!port) return [];
  const keys = (deps.encryptionKeys ?? adNetworkEncryptionKeys)();
  // Without the encryption key neither Zeekend's key nor Imprezia's relay can be read.
  if (keys.length === 0) return [];
  const networks: SponsoredNetwork[] = [];
  try {
    const configs = (await port.list()).filter((config) => config.enabled && isChatNetwork(config)).sort((a, b) => a.priority - b.priority);
    for (const config of configs) {
      if (networks.some((network) => network.id === config.provider)) continue;
      const encrypted = await port.key(config.id);
      if (!encrypted) continue;
      const part = networkMix(config);
      if (config.provider === "imprezia") {
        networks.push({ id: "imprezia", ...(config.imprezia?.id ? { placementId: config.imprezia.id } : {}), ...part });
        continue;
      }
      let key: string;
      try { key = decryptAdNetworkKey(config.id, encrypted, keys); } catch { continue; }
      if (!isZeekendKey(key)) continue;
      networks.push({ id: "zeekend", publisherKey: key, placementId: config.zeekend?.placementId || ZEEKEND_DEFAULT_PLACEMENT, ...part });
    }
  } catch {
    return networks;
  }
  return networks;
}
