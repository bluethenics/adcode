/**
 * POST /v1/serve.
 *
 * Every returned creative also writes a `serves` record. That record is the only reason
 * a later receipt can be believed (spec §9), so the write is not optional bookkeeping -
 * it is the thing that makes the money path safe.
 */
import type { ServeRequestBody, ServeResponseBody, ServedCreative } from "./contract.ts";
import type { Clock, IdGen, ServingConfig, Store } from "./store.ts";
import { runAuction, type Candidate } from "./targeting.ts";

export interface ServeDeps {
  store: Store;
  clock: Clock;
  ids: IdGen;
  /** Independent draw in [0, 1) for equal-share campaign delivery. */
  random?: () => number;
}

export async function handleServe(
  deps: ServeDeps,
  uid: string,
  body: ServeRequestBody,
  /**
   * The serving config, when the caller already read it.
   *
   * `server.ts` reads it for the rate limiter on every request; re-reading it here
   * costs a full Supabase round trip on the path with the tightest budget. Serve has
   * to fit inside the editor's 3,000ms timeout and was measured at ~5,000ms, with
   * every one of its reads sequential - so each spared round trip is ~500ms back.
   */
  config?: ServingConfig,
): Promise<ServeResponseBody> {
  const effective = config ?? (await deps.store.getConfig());
  if (effective.killSwitch || body.count <= 0) return { creatives: [] };

  /*
   * An admin test serve, if one is queued for this user.
   *
   * Deliberately ahead of targeting and budget: the point of a test is to prove delivery
   * works, which means it must not depend on the campaign it belongs to being live or
   * matching the tester's tags. Single-use - `takeTestServe` clears it - and flagged, so
   * the resulting receipt bills nobody.
   */
  /*
   * The queue drain and the candidate read are independent - a queued test skips the
   * auction, and the auction never reads the queue - so they go out together rather
   * than as two sequential round trips.
   */
  const [testCreativeId, campaigns] = await Promise.all([
    deps.store.takeTestServe(uid),
    deps.store.activeCampaignsFor(body.tags),
  ]);

  if (testCreativeId !== null) {
    const creative = await deps.store.getCreative(testCreativeId);
    if (creative !== null) {
      const at = deps.clock.now();
      await deps.store.recordServe({
        serveId: deps.ids.next("s"),
        uid,
        creativeId: creative.creativeId,
        campaignId: creative.campaignId,
        servedAt: at,
        expiresAt: at + effective.serveTtlMs,
        maxBidCpmMicros: 0n,
        clearingCpmMicros: 0n,
        costMicros: 0n,
        test: true,
      });

      return {
        creatives: [
          {
            creativeId: creative.creativeId,
            advertiser: creative.advertiser,
            headline: creative.headline,
            body: creative.body,
            clickUrl: creative.clickUrl,
            logoLight: creative.logoLight,
            logoDark: creative.logoDark,
          ttlMs: effective.serveTtlMs,
            // So the client can show it now rather than at the next scheduled slot.
            test: true,
          },
        ],
      };
    }
  }

  /*
   * Spend and artwork per candidate, in one wave rather than two: the auction needs
   * both the spend (eligibility) and the first approved creative (the payload) for
   * every candidate, and neither depends on the other.
   */
  const enriched = await Promise.all(
    campaigns.map(async (campaign) => ({
      campaign,
      spentMicros: await deps.store.getSpend(campaign.campaignId),
      approved: await deps.store.creativesForCampaign(campaign.campaignId),
    })),
  );

  const candidates: Candidate[] = enriched.map(({ campaign, spentMicros }) => ({
    campaign,
    spentMicros,
  }));
  const artwork = new Map(enriched.map(({ campaign, approved }) => [campaign.campaignId, approved] as const));

  const ranked = runAuction({
    candidates,
    tags: body.tags,
    count: candidates.length,
    floorCpmMicros: effective.floorCpmMicros,
    incrementCpmMicros: effective.auctionIncrementCpmMicros,
    tieSeed: deps.ids.next("auction"),
  });

  const now = deps.clock.now();

  // The editor has one display slot. Older clients ask for ten creatives, but a
  // runner-up expires before the next standard slot (both are ten minutes apart).
  // Keep the auction's captured prices, but share delivery equally across all
  // eligible campaigns with approved artwork. Always taking ranked[0] starves
  // every lower bidder. Draw afresh per request, independent of user, bid, or ID
  // counters, so every funded eligible campaign can reach the same audience.
  const eligible = ranked.filter(
    (winner) => (artwork.get(winner.campaign.campaignId)?.length ?? 0) > 0,
  );
  const selected = eligible.length > 0
    ? eligible[Math.floor((deps.random ?? Math.random)() * eligible.length)]
    : undefined;
  const winners = selected === undefined ? [] : [selected];
  const served = await Promise.all(
    winners.map(async (winner) => {
      const creative = artwork.get(winner.campaign.campaignId)?.[0];
      if (creative === undefined) return null;

      // Awaited, not fire-and-forget: the serve record is what makes a later
      // receipt believable (spec §9), so the response must not go out without it.
      await deps.store.recordServe({
        serveId: deps.ids.next("s"),
        uid,
        creativeId: creative.creativeId,
        campaignId: winner.campaign.campaignId,
        servedAt: now,
        expiresAt: now + effective.serveTtlMs,
        maxBidCpmMicros: winner.maxBidCpmMicros,
        clearingCpmMicros: winner.clearingCpmMicros,
        costMicros: winner.costMicros,
      });

      const servedCreative: ServedCreative = {
        creativeId: creative.creativeId,
        advertiser: creative.advertiser,
        headline: creative.headline,
        body: creative.body,
        clickUrl: creative.clickUrl,
        logoLight: creative.logoLight,
        logoDark: creative.logoDark,
        ttlMs: effective.serveTtlMs,
      };
      return servedCreative;
    }),
  );

  return { creatives: served.filter((one): one is ServedCreative => one !== null) };
}
