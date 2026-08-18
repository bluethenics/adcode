/**
 * POST /v1/serve.
 *
 * Every returned creative also writes a `serves` record. That record is the only reason
 * a later receipt can be believed (spec §9), so the write is not optional bookkeeping -
 * it is the thing that makes the money path safe.
 */
import type { ServeRequestBody, ServeResponseBody, ServedCreative } from "./contract.ts";
import type { Clock, IdGen, Store } from "./store.ts";
import { selectCampaigns, type Candidate } from "./targeting.ts";

export interface ServeDeps {
  store: Store;
  clock: Clock;
  ids: IdGen;
}

export async function handleServe(
  deps: ServeDeps,
  uid: string,
  body: ServeRequestBody,
): Promise<ServeResponseBody> {
  const config = await deps.store.getConfig();
  if (config.killSwitch || body.count <= 0) return { creatives: [] };

  const campaigns = await deps.store.activeCampaignsFor(body.tags);

  const candidates: Candidate[] = await Promise.all(
    campaigns.map(async (campaign) => ({
      campaign,
      spentMicros: await deps.store.getSpend(campaign.campaignId),
    })),
  );

  const ranked = selectCampaigns(candidates, body.tags, body.count);

  const now = deps.clock.now();
  const creatives: ServedCreative[] = [];

  for (const campaign of ranked) {
    if (creatives.length >= body.count) break;

    const approved = await deps.store.creativesForCampaign(campaign.campaignId);
    const creative = approved[0];
    if (creative === undefined) continue;

    await deps.store.recordServe({
      serveId: deps.ids.next("s"),
      uid,
      creativeId: creative.creativeId,
      servedAt: now,
      expiresAt: now + config.serveTtlMs,
    });

    creatives.push({
      creativeId: creative.creativeId,
      advertiser: creative.advertiser,
      headline: creative.headline,
      body: creative.body,
      clickUrl: creative.clickUrl,
      logoLight: creative.logoLight,
      logoDark: creative.logoDark,
      ttlMs: config.serveTtlMs,
    });
  }

  return { creatives };
}
