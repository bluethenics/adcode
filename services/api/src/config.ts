/**
 * GET /v1/config.
 *
 * D1 of the ad-core design: the client is forbidden from computing money, so projected
 * hourly earnings are computed here and the client only selects and formats a row.
 *
 * The contract says this endpoint "may only tighten" - the service never emits caps
 * looser than the client's shipped defaults, so a compromised config cannot be used to
 * spam users with ads.
 */
import { advertiserCostMicros, formatMicros, userCreditMicros } from "./money.ts";
import type { CadenceName, ConfigResponseBody } from "./contract.ts";
import type { Store } from "./store.ts";

/** Ads per hour at each cadence. Mirrors the client's presets. */
const ADS_PER_HOUR: Record<CadenceName, bigint> = {
  off: 0n,
  light: 2n,
  standard: 4n,
  max: 12n,
};

export async function handleConfig(store: Store): Promise<ConfigResponseBody> {
  const config = await store.getConfig();

  const perImpression = userCreditMicros(
    advertiserCostMicros(config.defaultCpmMicros),
    config.revSharePercent,
  );

  const projections = {} as Record<CadenceName, string>;
  for (const [name, rate] of Object.entries(ADS_PER_HOUR) as [CadenceName, bigint][]) {
    // A projection while the kill switch is on would be a promise the server has already
    // decided not to keep.
    projections[name] = formatMicros(config.killSwitch ? 0n : perImpression * rate);
  }

  return { killSwitch: config.killSwitch, caps: config.caps, projections };
}
