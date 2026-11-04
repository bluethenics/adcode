import type { MonetizeResponse } from "@adimpress/imprezia-sdk";
import { isCardKey, isHtmlBannerCreative } from "@adimpress/imprezia-sdk/utils/cardHelpers";

/**
 * Card formats a partner notification can show: logo or image, brand, title, description and a
 * call to action, which /sponsored/chat restyles to read like ADCode's own sponsored messages.
 * A third-party HTML banner, a fixed display size or a form cannot be, so a notification
 * answers "no card" for them and the editor hands the slot back. No format means vertical.
 */
const NATIVE_FORMATS: ReadonlySet<string | undefined> = new Set([undefined, "uicard-vertical", "uicard-horizontal", "uicard-text", "uicard-text-cta"]);

export function fitsNotification(monetized: MonetizeResponse): boolean {
  const card = Object.entries(monetized.linkData).find(([key]) => isCardKey(key))?.[1].metadata?.cardMetadata;
  return card !== undefined && !isHtmlBannerCreative(card) && NATIVE_FORMATS.has(card.adFormat);
}
