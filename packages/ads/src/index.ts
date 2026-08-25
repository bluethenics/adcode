/**
 * Public surface of the ad client. Re-exports only; zero logic.
 *
 * Nothing here imports Electron, Monaco, or the DOM (brief §2), which is what lets the
 * whole client be built and tested before a window exists.
 */
export * from "./types.ts";

export { decide, tightenCaps } from "./scheduler.ts";
export {
  parseServeResponse,
  parseConfigResponse,
  parseBalanceResponse,
  parseReceiptsResponse,
} from "./validation.ts";
export { tag, type TagInput } from "./tagger.ts";
export { formatMicros, formatMicrosCompact, applyServerBalance } from "./ledger.ts";
export {
  buildSponsorsView,
  projectionFor,
  type PresetOption,
  type SponsorsViewModel,
  type SponsorsViewInput,
} from "./sponsorsView.ts";

export { createReceiptQueue, type ReceiptQueue } from "./receiptQueue.ts";
export {
  createFirebaseAuth,
  REFRESH_SKEW_MS,
  type FirebaseAuth,
  type FirebaseAuthDeps,
  type LinkedProfile,
} from "./auth.ts";
export { createAdClient, type AdClient, type AdClientDeps } from "./client.ts";
export { createAssetCache, type AssetCache, type AssetCacheDeps } from "./assetCache.ts";
export { createAdRenderer, type AdRenderer, type AdRendererDeps } from "./renderer.ts";
export {
  createAdService,
  type AdService,
  type AdServiceDeps,
  type AdServiceSettings,
} from "./adService.ts";
