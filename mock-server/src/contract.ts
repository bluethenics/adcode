/**
 * Wire types for the serving contract, written from the spec.
 *
 * Brief §10: "The mock server must not import the client's types. A mock that shares
 * the client's type definitions cannot catch a contract mismatch, which is the main
 * thing it exists to do."
 *
 * So these are deliberate duplicates, not shared definitions. If the client's idea of
 * the contract drifts from this file, a test breaks - which is the point. Do not
 * refactor this into an import from `packages/ads`; a dependency-cruiser rule will
 * reject it anyway.
 *
 * Money is a decimal string here for the same reason it is on the client: JSON has no
 * bigint, and a JSON number would already have lost precision above 2^53.
 */

export type ThemeName = "light" | "dark";
export type CadenceName = "off" | "light" | "standard" | "max";
export type ReceiptOutcome = "impression" | "click" | "dismissed";

export interface ServeRequestBody {
  tags: string[];
  themeKind: ThemeName;
  count: number;
}

export interface ServedCreative {
  creativeId: string;
  advertiser: string;
  headline: string;
  body: string | null;
  clickUrl: string;
  logoLight: string;
  logoDark: string;
  ttlMs: number;
}

export interface ServeResponseBody {
  creatives: ServedCreative[];
}

export interface SubmittedReceipt {
  receiptId: string;
  creativeId: string;
  shownAt: number;
  dwellMs: number;
  themeKind: ThemeName;
  outcome: ReceiptOutcome;
}

export interface ReceiptsRequestBody {
  receipts: SubmittedReceipt[];
}

export interface ReceiptsResponseBody {
  acked: string[];
}

export interface BalanceResponseBody {
  availableMicros: string;
  lifetimeMicros: string;
}

export interface ConfigResponseBody {
  killSwitch: boolean;
  caps: { minIntervalMs?: number; dailyCap?: number };
  projections: Record<CadenceName, string>;
}
