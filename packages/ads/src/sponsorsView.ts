/**
 * Shape balance, history, and the server's projections into view-model data.
 *
 * Pure (brief §8). The one rule that governs this file: it **selects and formats**
 * monetary values, and never computes one.
 *
 * Spec deviation D1 is why the projections arrive pre-computed. Brief §1 forbids the
 * client computing money; §8.1 requires showing projected hourly earnings beside each
 * frequency preset so the user can trade interruption against income. Those cannot both
 * hold unless the server does the arithmetic, so `/v1/config` carries the table and this
 * module picks a row out of it.
 */
import { formatMicros } from "./ledger.ts";
import {
  PRESETS,
  micros,
  type Balance,
  type FrequencyPreset,
  type Receipt,
  type RemoteConfig,
} from "./types.ts";

const ORDER: readonly FrequencyPreset[] = ["off", "light", "standard", "max"];

export interface PresetOption {
  readonly preset: FrequencyPreset;
  readonly minIntervalMs: number;
  readonly dailyCap: number;
  /** Server-computed micros per hour, formatted. `null` when the server has not said. */
  readonly projectionLabel: string | null;
}

export interface SponsorsViewModel {
  readonly availableLabel: string;
  readonly lifetimeLabel: string;
  /** False until the server has answered once, so the UI can distinguish zero from unknown. */
  readonly hasServerBalance: boolean;
  readonly impressionCount: number;
  readonly clickCount: number;
  readonly presets: readonly PresetOption[];
}

/**
 * The formatted hourly projection for one preset, or `null` if the server has not sent
 * a projections table. Returning `null` is deliberate: an estimate invented here would
 * be the client computing money.
 *
 * Full precision, not the compact cents form. An hour at the densest cadence is worth
 * a few hundredths of a cent, so `formatMicrosCompact` rendered *every* preset as
 * "$0.00" - four rows of identical zero next to four different choices, which is worse
 * than showing nothing because it reads as a measurement rather than as a rounding.
 */
export function projectionFor(
  config: RemoteConfig | null,
  preset: FrequencyPreset,
): string | null {
  if (config === null) return null;
  const value = config.projections[preset];
  if (value === undefined) return null;
  return formatMicros(value);
}

export interface SponsorsViewInput {
  readonly balance: Balance | null;
  readonly history: readonly Receipt[];
  readonly config: RemoteConfig | null;
}

export function buildSponsorsView(input: SponsorsViewInput): SponsorsViewModel {
  const zero = micros(0n);
  const available = input.balance?.availableMicros ?? zero;
  const lifetime = input.balance?.lifetimeMicros ?? zero;

  let impressionCount = 0;
  let clickCount = 0;
  for (const receipt of input.history) {
    if (receipt.outcome === "impression") impressionCount += 1;
    else if (receipt.outcome === "click") clickCount += 1;
  }

  return {
    // Also full precision: a first earning of 4,000 micros is real money and rounding it
    // to cents shows a new user nothing at all.
    availableLabel: formatMicros(available),
    lifetimeLabel: formatMicros(lifetime),
    hasServerBalance: input.balance !== null,
    impressionCount,
    clickCount,
    presets: ORDER.map((preset) => ({
      preset,
      minIntervalMs: PRESETS[preset].minIntervalMs,
      dailyCap: PRESETS[preset].dailyCap,
      projectionLabel: projectionFor(input.config, preset),
    })),
  };
}

/** Kept for symmetry with surfaces that want full precision rather than cents. */
export const formatExact = formatMicros;
