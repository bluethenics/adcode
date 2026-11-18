"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Globe, Layers, MapPin, Pencil, Plus, Users, X } from "lucide";
import { useAuth } from "@/components/AuthProvider";
import { Icon } from "@/components/Icon";
import { LogoDrop } from "@/components/LogoDrop";
import { SignInCard } from "@/components/SignInCard";
import { SponsoredToastPreview } from "@/components/SponsoredToastPreview";
import { TagPicker } from "@/components/TagPicker";
import { ClearingPrice } from "@/components/advertisers/ClearingPrice";
import { useNetworkStats } from "@/components/advertisers/NetworkStats";
import { AdPreviews } from "@/components/advertisers/portal/AdPreviews";
import { LiveReach } from "@/components/advertisers/portal/LiveReach";
import { RegionPicker, regionSummary } from "@/components/advertisers/portal/RegionPicker";
import { usePortal } from "@/components/advertisers/portal/PortalShell";
import { dollarsToMicros, money } from "@/components/money";
import { apiFetch, MESSAGES, type AdvertiserView, type CampaignView, type CreativeView } from "@/lib/api";
import { signupRefBody } from "@/lib/invite";
import { previewNetworkStats } from "@/lib/portalPreview";
import { compact, defaultCampaignName, domainOf, estimateReach, isHttpsUrl, range } from "@/lib/portalModel";
import { ECONOMICS } from "@/lib/site";
import { trackWebsiteEvent } from "@/lib/websiteAnalytics";

/**
 * New campaign, as four short steps: who sees it, the ad, the budget, then a review.
 *
 * The API needs three writes (advertiser, campaign, cards), and they all happen on the
 * last step, from one button. Until then nothing is saved anywhere but this tab, so
 * someone who is not signed in can build the whole campaign first and sign in only to
 * launch it. The draft survives a reload and the round trip through sign-in.
 */

const LIMITS = { brand: 40, headline: 80, body: 160 } as const;
const MAX_ADS = 3;
const DRAFT_KEY = "adcode-campaign-draft";
const FLOOR = Number(ECONOMICS.floorBlockMicros) / 1_000_000;
const BUDGETS = ["25", "100", "250", "500"] as const;

type Step = 1 | 2 | 3 | 4;
type Audience = "everyone" | "stack";
type Where = "world" | "regions";

interface AdDraft {
  headline: string;
  body: string;
}

interface Draft {
  step: Step;
  audience: Audience | null;
  tags: string[];
  where: Where;
  /** ISO country codes; sent as `geo:XX` target tags. */
  regions: string[];
  url: string;
  brand: string;
  logo: string | null;
  darkLogo: string | null;
  ads: AdDraft[];
  budget: string;
  bid: string;
  name: string;
}

const EMPTY: Draft = {
  step: 1,
  audience: null,
  tags: [],
  where: "world",
  regions: [],
  url: "",
  brand: "",
  logo: null,
  darkLogo: null,
  ads: [{ headline: "", body: "" }],
  budget: "100",
  bid: FLOOR.toFixed(2),
  name: "",
};

const STEPS: readonly { step: Step; label: string }[] = [
  { step: 1, label: "Audience" },
  { step: 2, label: "Your ad" },
  { step: 3, label: "Budget" },
  { step: 4, label: "Review" },
];

function readDraft(): Draft {
  try {
    const saved = sessionStorage.getItem(DRAFT_KEY);
    if (saved === null) return EMPTY;
    const parsed = JSON.parse(saved) as Partial<Draft>;
    const ads = Array.isArray(parsed.ads) && parsed.ads.length > 0 ? parsed.ads.slice(0, MAX_ADS) : EMPTY.ads;
    return { ...EMPTY, ...parsed, ads };
  } catch {
    return EMPTY;
  }
}

function writeDraft(draft: Draft | null): void {
  try {
    if (draft === null) sessionStorage.removeItem(DRAFT_KEY);
    else sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // A full or blocked storage only costs the draft on reload; the form still works.
  }
}

/** What stops each step from continuing, in words, or null when it can. */
function problem(draft: Draft, step: Step): string | null {
  if (step === 1) {
    if (draft.audience === null) return "Choose who should see your ad.";
    if (draft.audience === "stack" && draft.tags.length === 0) return "Pick at least one language, framework, tool or platform.";
    if (draft.where === "regions" && draft.regions.length === 0) return "Pick at least one country or region, or choose worldwide.";
  }
  if (step === 2) {
    if (!isHttpsUrl(draft.url)) return "Enter the full https address people should land on.";
    if (draft.brand.trim().length === 0) return "Add the brand name developers will see on the card.";
    if (draft.logo === null) return "Add a logo. The card has a space for it and looks broken without one.";
    const short = draft.ads.findIndex((ad) => ad.headline.trim().length < 3);
    if (short !== -1) return draft.ads.length === 1 ? "Write your message, at least three characters." : `Ad ${short + 1} needs a message, at least three characters.`;
  }
  if (step === 3) {
    const budget = dollarsToMicros(draft.budget);
    const bid = dollarsToMicros(draft.bid);
    if (budget === null || BigInt(budget) < 1_000_000n) return "The smallest budget is $1.";
    if (BigInt(budget) > 100_000_000_000n) return "The largest budget one campaign can carry is $100,000.";
    if (bid === null || BigInt(bid) < ECONOMICS.floorBlockMicros) return `The lowest bid is $${FLOOR.toFixed(2)} per 500 views.`;
    if (BigInt(bid) > 50_000_000n) return "The highest bid is $50 per 500 views.";
  }
  return null;
}

export function CampaignBuilder() {
  const portal = usePortal();
  const auth = useAuth();
  const router = useRouter();
  const live = useNetworkStats(null);
  const [previewStats, setPreviewStats] = useState<ReturnType<typeof previewNetworkStats>>(null);
  useEffect(() => setPreviewStats(previewNetworkStats()), []);
  const stats = live.stats ?? previewStats;
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [restored, setRestored] = useState(false);
  const [shownError, setShownError] = useState<string | null>(null);
  const [editing, setEditing] = useState(0);
  const [launching, setLaunching] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [needSignIn, setNeedSignIn] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setDraft(readDraft());
    setRestored(true);
  }, []);
  useEffect(() => {
    if (restored) writeDraft(draft);
  }, [draft, restored]);

  const update = useCallback((patch: Partial<Draft>) => {
    setShownError(null);
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const go = useCallback((step: Step) => {
    setShownError(null);
    setDraft((current) => ({ ...current, step }));
    // Each step is a new screen: start it at the top, with focus on its heading.
    requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      globalThis.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, []);

  const next = (from: Step) => {
    const blocking = problem(draft, from);
    if (blocking !== null) {
      setShownError(blocking);
      return;
    }
    go((from + 1) as Step);
  };

  /** Steps already passed can be revisited from the stepper; later ones cannot be skipped to. */
  const reachable = (step: Step) => step < draft.step || ([1, 2, 3] as Step[]).slice(0, step - 1).every((s) => problem(draft, s) === null);

  const budgetMicros = dollarsToMicros(draft.budget);
  const bidMicros = dollarsToMicros(draft.bid);
  const yours = useMemo(() => {
    const views = portal.campaigns.reduce((sum, c) => sum + c.impressions, 0);
    const clicks = portal.campaigns.reduce((sum, c) => sum + c.clicks, 0);
    return { views, clicks };
  }, [portal.campaigns]);
  const estimate = budgetMicros === null || bidMicros === null || problem(draft, 3) !== null
    ? null
    : estimateReach(BigInt(budgetMicros), BigInt(bidMicros), { yours, network: stats });

  const previewAds = draft.ads.map((ad) => ({ brand: draft.brand, headline: ad.headline, body: ad.body, logo: draft.logo }));
  const signedIn = portal.status !== "signed-out" && portal.status !== "checking";

  const launch = useCallback(async () => {
    for (const step of [1, 2, 3] as Step[]) {
      const blocking = problem(draft, step);
      if (blocking !== null) {
        go(step);
        setShownError(blocking);
        return;
      }
    }
    const t = await portal.token();
    if (t === null) {
      setNeedSignIn(true);
      return;
    }
    setLaunchError(null);
    const brand = draft.brand.trim();

    if (portal.advertiser === null) {
      setLaunching("Creating your advertiser account");
      const account = await apiFetch<AdvertiserView>({ path: "/portal/advertiser", token: t, method: "POST", body: { name: brand, ...signupRefBody() } });
      // Already having one is normal (a second campaign, or a stale report): carry on.
      if (!account.ok && account.error !== "already-advertiser") {
        setLaunching(null);
        setLaunchError(MESSAGES[account.error]);
        return;
      }
      if (account.ok) trackWebsiteEvent("advertiser_created");
    }

    setLaunching("Creating the campaign");
    const bidBlock = BigInt(dollarsToMicros(draft.bid) ?? "0");
    const campaign = await apiFetch<CampaignView>({
      path: "/portal/campaigns",
      token: t,
      method: "POST",
      body: {
        name: draft.name.trim().length > 0 ? draft.name.trim() : defaultCampaignName(brand),
        cpmMicros: (bidBlock * 2n).toString(),
        budgetMicros: dollarsToMicros(draft.budget),
        targetTags: [...(draft.audience === "stack" ? draft.tags : []), ...(draft.where === "regions" ? draft.regions.map((code) => `geo:${code}`) : [])],
      },
    });
    if (!campaign.ok) {
      setLaunching(null);
      setLaunchError(MESSAGES[campaign.error]);
      return;
    }
    trackWebsiteEvent("campaign_created");

    const id = campaign.value.campaignId;
    let published = 0;
    for (const [index, ad] of draft.ads.entries()) {
      setLaunching(draft.ads.length === 1 ? "Publishing your ad" : `Publishing ad ${index + 1} of ${draft.ads.length}`);
      const card = await apiFetch<CreativeView>({
        path: "/portal/creatives",
        token: t,
        method: "POST",
        body: {
          campaignId: id,
          advertiser: brand,
          headline: ad.headline.trim(),
          body: ad.body.trim().length === 0 ? null : ad.body.trim(),
          clickUrl: draft.url.trim(),
          logoLight: draft.logo,
          // One upload covers both themes unless a second is given.
          logoDark: draft.darkLogo ?? draft.logo,
        },
      });
      if (card.ok) published++;
    }

    writeDraft(null);
    await portal.reload();
    // The campaign exists either way; its page is where a missing ad is added again.
    router.push(`/portal/campaigns/${encodeURIComponent(id)}?created=${published === draft.ads.length ? "1" : "partial"}`);
  }, [draft, go, portal, router]);

  // Signing in from the review step carries straight on to the launch.
  useEffect(() => {
    if (needSignIn && auth.user !== null && launching === null) {
      setNeedSignIn(false);
      void launch();
    }
  }, [auth.user, launch, launching, needSignIn]);

  if (!restored) return <div className="ap-skeleton" aria-busy="true"><i className="ap-sk-title" /><i className="ap-sk-panel" /></div>;

  const step = draft.step;
  const ad = draft.ads[Math.min(editing, draft.ads.length - 1)] ?? { headline: "", body: "" };
  const setAd = (patch: Partial<AdDraft>) =>
    update({ ads: draft.ads.map((one, index) => (index === Math.min(editing, draft.ads.length - 1) ? { ...one, ...patch } : one)) });

  return (
    <div className="ap-builder" data-step={step}>
      <ol className="ap-stepper" aria-label="Campaign steps">
        {STEPS.map((item) => {
          const done = item.step < step;
          const current = item.step === step;
          return (
            <li key={item.step} data-state={done ? "done" : current ? "current" : "todo"}>
              <button type="button" onClick={() => go(item.step)} disabled={current || !reachable(item.step) || launching !== null} aria-current={current ? "step" : undefined}>
                <span className="ap-step-num" aria-hidden="true">{done ? <Icon node={Check} /> : item.step}</span>
                <span className="ap-step-label">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <div className="ap-step ap-step-split">
          <div>
            <h1 ref={heading} tabIndex={-1}>New campaign</h1>
            <p className="ap-step-lede">Who should see your ad?</p>
            <div className="ap-choices" role="radiogroup" aria-label="Audience">
              <button type="button" role="radio" aria-checked={draft.audience === "everyone"} className="ap-choice" onClick={() => update({ audience: "everyone", tags: [] })}>
                <span className="ap-choice-icon"><Icon node={Users} /></span>
                <span className="ap-choice-text">
                  <strong>Every developer</strong>
                  <span>{stats === null ? "Your card rotates in front of everyone writing code in ADCode." : `All ${compact(stats.developers)} developers on ADCode, in every language.`}</span>
                </span>
                <span className="ap-choice-go" aria-hidden="true"><Icon node={draft.audience === "everyone" ? Check : ArrowRight} /></span>
              </button>
              <button type="button" role="radio" aria-checked={draft.audience === "stack"} className="ap-choice" onClick={() => update({ audience: "stack" })}>
                <span className="ap-choice-icon"><Icon node={Layers} /></span>
                <span className="ap-choice-text">
                  <strong>Developers in your stack</strong>
                  <span>Only people working in the languages, frameworks and tools you pick. Matched on their device, no code leaves it.</span>
                </span>
                <span className="ap-choice-go" aria-hidden="true"><Icon node={draft.audience === "stack" ? Check : ArrowRight} /></span>
              </button>
            </div>
            {draft.audience === "stack" && (
              <div className="ap-tags">
                <TagPicker selected={draft.tags} onChange={(tags) => update({ tags })} />
              </div>
            )}

            {draft.audience !== null && (
              <>
                <p className="ap-step-lede ap-step-lede-next">Where in the world?</p>
                <div className="ap-choices ap-choices-row" role="radiogroup" aria-label="Region">
                  <button type="button" role="radio" aria-checked={draft.where === "world"} className="ap-choice ap-choice-small" onClick={() => update({ where: "world" })}>
                    <span className="ap-choice-icon"><Icon node={Globe} /></span>
                    <span className="ap-choice-text"><strong>Worldwide</strong><span>Every country ADCode is used in.</span></span>
                  </button>
                  <button type="button" role="radio" aria-checked={draft.where === "regions"} className="ap-choice ap-choice-small" onClick={() => update({ where: "regions" })}>
                    <span className="ap-choice-icon"><Icon node={MapPin} /></span>
                    <span className="ap-choice-text"><strong>Chosen countries</strong><span>Only developers connecting from the regions you sell in.</span></span>
                  </button>
                </div>
                {draft.where === "regions" && <RegionPicker selected={draft.regions} onChange={(regions) => update({ regions })} />}
                <StepActions error={shownError} onNext={() => next(1)} />
              </>
            )}
            {draft.audience === null && shownError !== null && <p className="ap-field-error" role="alert">{shownError}</p>}
          </div>
          <LiveReach />
        </div>
      )}

      {step === 2 && (
        <div className="ap-step ap-step-form">
          <div className="ap-form">
            <h1 ref={heading} tabIndex={-1}>Your ad</h1>
            <p className="ap-step-lede">Where it sends people, and what it says.</p>

            <div className="field">
              <label htmlFor="ap-url">Destination URL</label>
              <input
                id="ap-url"
                className="input"
                type="url"
                inputMode="url"
                autoComplete="url"
                placeholder="https://yourproduct.com/developers"
                value={draft.url}
                onChange={(event) => update({ url: event.target.value })}
                onBlur={() => {
                  const url = draft.url.trim();
                  const fixed = url.length > 0 && !/^[a-z]+:\/\//i.test(url) ? `https://${url}` : url;
                  update({ url: fixed, brand: draft.brand.trim() === "" && isHttpsUrl(fixed) ? titleFromDomain(domainOf(fixed)) : draft.brand });
                }}
              />
              <span className="field-hint">Where people go when they click your card. It has to be https.</span>
            </div>

            <div className="field">
              <label htmlFor="ap-brand">Brand name</label>
              <input id="ap-brand" className="input" maxLength={LIMITS.brand} placeholder="Your product" value={draft.brand} onChange={(event) => update({ brand: event.target.value })} />
              <span className="field-hint">Shown on the card, and the name of your advertiser account.</span>
            </div>

            <LogoDrop label="Logo" hint="Square works best. Resized here, nothing to host." value={draft.logo} onChange={(logo) => update({ logo })} />

            <div className="ap-ads">
              {draft.ads.length > 1 && (
                <div className="ap-ad-tabs" role="tablist" aria-label="Ads in this campaign">
                  {draft.ads.map((_, index) => (
                    <button key={index} type="button" role="tab" aria-selected={index === Math.min(editing, draft.ads.length - 1)} onClick={() => setEditing(index)}>
                      Ad {index + 1}
                    </button>
                  ))}
                </div>
              )}
              <div className="field">
                <label htmlFor="ap-headline">{draft.ads.length > 1 ? `Message for ad ${Math.min(editing, draft.ads.length - 1) + 1}` : "Your message"}</label>
                <input id="ap-headline" className="input" maxLength={LIMITS.headline} placeholder="Find the line that broke prod" value={ad.headline} onChange={(event) => setAd({ headline: event.target.value })} />
                <span className="field-hint">{ad.headline.length}/{LIMITS.headline}. The card is small, so shorter reads better.</span>
              </div>
              <div className="field">
                <label htmlFor="ap-body">Supporting line <small>optional</small></label>
                <input id="ap-body" className="input" maxLength={LIMITS.body} placeholder="Free for small teams" value={ad.body} onChange={(event) => setAd({ body: event.target.value })} />
              </div>
              <div className="ap-ad-actions">
                {draft.ads.length < MAX_ADS && (
                  <button
                    type="button"
                    className="ap-link"
                    onClick={() => {
                      update({ ads: [...draft.ads, { headline: "", body: "" }] });
                      setEditing(draft.ads.length);
                    }}
                  >
                    <Icon node={Plus} />Add another version
                  </button>
                )}
                {draft.ads.length > 1 && (
                  <button
                    type="button"
                    className="ap-link ap-link-quiet"
                    onClick={() => {
                      const at = Math.min(editing, draft.ads.length - 1);
                      update({ ads: draft.ads.filter((_, index) => index !== at) });
                      setEditing(Math.max(0, at - 1));
                    }}
                  >
                    <Icon node={X} />Remove this version
                  </button>
                )}
              </div>
              <p className="field-hint">Versions share your budget and rotate, so you can see which message gets clicked.</p>
            </div>

            <details className="ap-more">
              <summary>Different logo for dark themes</summary>
              <LogoDrop label="Logo for dark themes" hint="Only needed if your logo disappears on a dark background." value={draft.darkLogo} onChange={(darkLogo) => update({ darkLogo })} />
            </details>

            <StepActions error={shownError} onBack={() => go(1)} onNext={() => next(2)} />
          </div>
          <aside className="ap-live-preview" aria-label="Live preview">
            <h2>Live preview</h2>
            <p>The card exactly as it appears in the editor, at the same size.</p>
            <div className="card-preview-ground">
              <SponsoredToastPreview brand={draft.brand} headline={ad.headline} body={ad.body} logo={draft.logo} />
            </div>
          </aside>
        </div>
      )}

      {step === 3 && (
        <div className="ap-step ap-step-form">
          <div className="ap-form">
            <h1 ref={heading} tabIndex={-1}>Budget</h1>
            <p className="ap-step-lede">The most this campaign can spend. It stops the moment the budget is used.</p>

            <fieldset className="ap-budget">
              <legend>Total budget</legend>
              <div className="ap-presets" role="group" aria-label="Budget shortcuts">
                {BUDGETS.map((amount) => (
                  <button key={amount} type="button" aria-pressed={Number(draft.budget) === Number(amount)} onClick={() => update({ budget: amount })}>
                    ${amount}
                  </button>
                ))}
              </div>
              <div className="ap-money">
                <span aria-hidden="true">$</span>
                <input aria-label="Total budget in dollars" className="input" inputMode="decimal" value={draft.budget} onChange={(event) => update({ budget: event.target.value.replace(/^\$/, "") })} />
              </div>
            </fieldset>

            <div className="field">
              <label htmlFor="ap-bid">Maximum bid per 500 verified views</label>
              <div className="ap-money">
                <span aria-hidden="true">$</span>
                <input id="ap-bid" className="input" inputMode="decimal" value={draft.bid} onChange={(event) => update({ bid: event.target.value.replace(/^\$/, "") })} />
              </div>
              <span className="field-hint">The floor is ${FLOOR.toFixed(2)}. Each slot is a second-price auction, so you often pay less than this.</span>
            </div>
            <ClearingPrice />

            <div className="field">
              <label htmlFor="ap-name">Campaign name <small>optional</small></label>
              <input id="ap-name" className="input" maxLength={80} placeholder={defaultCampaignName(draft.brand.trim() || "Your brand")} value={draft.name} onChange={(event) => update({ name: event.target.value })} />
              <span className="field-hint">Only you see this.</span>
            </div>

            <StepActions error={shownError} onBack={() => go(2)} onNext={() => next(3)} nextLabel="Review campaign" />
          </div>
          <aside className="ap-live-preview ap-estimate-side" aria-label="What this budget buys">
            <h2>What it buys</h2>
            {estimate === null ? (
              <p>Enter a budget and a bid to see the range.</p>
            ) : (
              <>
                <strong>{range(estimate.viewsLow, estimate.viewsHigh)}</strong>
                <span>verified views</span>
                <p>From all blocks clearing at your bid to all clearing at the ${FLOOR.toFixed(2)} floor.</p>
              </>
            )}
          </aside>
        </div>
      )}

      {step === 4 && (
        <div className="ap-step ap-review">
          <header className="ap-review-head">
            <div>
              <h1 ref={heading} tabIndex={-1}>Your campaign is ready</h1>
              <ul className="ap-meta">
                <li className="ap-meta-brand">
                  {draft.logo !== null && (
                    // eslint-disable-next-line @next/next/no-img-element -- a data: URL at its rendered size
                    <img src={draft.logo} alt="" width={22} height={22} />
                  )}
                  {draft.brand.trim()}
                </li>
                <li>{domainOf(draft.url)}</li>
                <li><strong className="money">{money(dollarsToMicros(draft.budget) ?? "0")}</strong> budget</li>
                <li>{draft.audience === "stack" ? `${draft.tags.length} ${draft.tags.length === 1 ? "context" : "contexts"}` : "Every developer"}</li>
                <li>{draft.where === "regions" ? regionSummary(draft.regions) : "Worldwide"}</li>
              </ul>
            </div>
            <div className="ap-review-actions">
              <button type="button" className="ap-btn" onClick={() => go(2)} disabled={launching !== null}><Icon node={Pencil} />Edit</button>
              <button type="button" className="ap-btn ap-btn-primary" onClick={() => void launch()} disabled={launching !== null} aria-busy={launching !== null}>
                {launching !== null ? `${launching}…` : signedIn ? "Launch campaign" : "Sign in to launch"}
              </button>
            </div>
          </header>

          {estimate !== null && (
            <dl className="ap-estimate">
              <div><dt>Verified views</dt><dd>{range(estimate.viewsLow, estimate.viewsHigh)}</dd></div>
              {estimate.clicksLow !== null && estimate.clicksHigh !== null && (
                <div><dt>Clicks</dt><dd>{range(estimate.clicksLow, estimate.clicksHigh)}</dd></div>
              )}
              <p>
                Over the whole budget, from every block clearing at your ${Number(draft.bid).toFixed(2)} bid to every block at the floor.
                {estimate.clickRateSource === "yours" && " Clicks use your campaigns' click rate so far."}
                {estimate.clickRateSource === "network" && " Clicks use the click rate across ADCode right now."}
              </p>
            </dl>
          )}

          {launchError !== null && <div className="ap-banner" data-tone="error" role="alert"><p>{launchError}</p></div>}
          <FundingNote budgetMicros={dollarsToMicros(draft.budget)} />

          {needSignIn && auth.user === null && (
            <div className="ap-signin" role="region" aria-label="Sign in to launch">
              <p>Your campaign is saved in this tab. Sign in or create an account and it launches straight away.</p>
              <SignInCard heading="Sign in to launch your campaign" audience="advertiser" headingTag="h2" />
            </div>
          )}

          <AdPreviews ads={previewAds} />
        </div>
      )}
    </div>
  );
}

function StepActions({ error, onBack, onNext, nextLabel = "Continue" }: { error: string | null; onBack?: () => void; onNext: () => void; nextLabel?: string }) {
  return (
    <div className="ap-step-actions">
      {error !== null && <p className="ap-field-error" role="alert">{error}</p>}
      <div>
        {onBack !== undefined && <button type="button" className="ap-btn ap-btn-ghost" onClick={onBack}><Icon node={ArrowLeft} />Back</button>}
        <button type="button" className="ap-btn ap-btn-primary" onClick={onNext}>{nextLabel}<Icon node={ArrowRight} /></button>
      </div>
    </div>
  );
}

/** Whether the balance covers the budget, which is what decides if launch means live. */
function FundingNote({ budgetMicros }: { budgetMicros: string | null }) {
  const portal = usePortal();
  if (budgetMicros === null) return null;
  const budget = BigInt(budgetMicros);
  const available = BigInt(portal.advertiser?.availableMicros ?? "0");
  if (portal.advertiser !== null && available >= budget) {
    return (
      <div className="ap-banner" data-tone="ok">
        <p>Your {money(available.toString())} balance covers this budget, so it goes live the moment you launch. Cards pass automated checks on submit; there is no review queue.</p>
      </div>
    );
  }
  const short = budget - available;
  return (
    <div className="ap-banner" data-tone="info">
      <p>
        Launching saves the campaign and its ads. It starts serving once you add {money(short.toString())} in credits, which you can do on the next screen.
        Nothing is charged until then.
      </p>
    </div>
  );
}

/** "Tracewell" from "tracewell.dev": a starting point for the brand name, always editable. */
function titleFromDomain(domain: string): string {
  const name = domain.split(".")[0] ?? "";
  return name.length === 0 ? "" : name.slice(0, 1).toUpperCase() + name.slice(1, LIMITS.brand);
}
