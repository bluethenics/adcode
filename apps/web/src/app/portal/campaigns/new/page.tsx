"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { LogoDrop } from "@/components/LogoDrop";
import { TagPicker } from "@/components/TagPicker";
import { dollarsToMicros } from "@/components/money";
import {
  apiFetch,
  MESSAGES,
  type AdvertiserView,
  type CampaignView,
  type CreativeView,
} from "@/lib/api";
import { ECONOMICS, formatMicros } from "@/lib/site";

/**
 * One screen from nothing to a campaign in review.
 *
 * This used to be three: name an advertiser account, then fill a campaign form, then land
 * on a detail page and fill a second form for the creative. Nine fields, three submits,
 * and two of the three screens asked for something the person had already typed - the
 * brand name went in twice and the campaign needed a name of its own that only they would
 * ever see.
 *
 * Now: your brand, your message, your logo, a budget. The account, the campaign and the
 * card are all created by one button, and the two fields nobody should have to think about
 * - the CPM and the campaign's internal name - have defaults behind a disclosure.
 *
 * The preview is not decoration. The card lives in the corner of someone's editor at about
 * 260px wide, and a headline that reads fine in a text input can be unreadable there.
 */
const LIMITS = { brand: 40, headline: 80, body: 160 } as const;

export default function NewCampaign() {
  const router = useRouter();
  useEffect(() => router.replace("/portal#new-campaign"), [router]);
  return null;
}

export function NewCampaignForm() {
  const { token } = useAuth();
  const router = useRouter();

  const [brand, setBrand] = useState("");
  const [headline, setHeadline] = useState("");
  const [body, setBody] = useState("");
  const [clickUrl, setClickUrl] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [darkLogo, setDarkLogo] = useState<string | null>(null);
  const [budget, setBudget] = useState("100.00");
  const [tags, setTags] = useState<string[]>([]);
  const [cpm, setCpm] = useState(formatMicros(ECONOMICS.floorBlockMicros, 2).replace("$", ""));
  const [campaignName, setCampaignName] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;

    const trimmedBrand = brand.trim();
    const budgetMicros = dollarsToMicros(budget);
    const blockBidMicros = dollarsToMicros(cpm);
    const cpmMicros = blockBidMicros === null ? null : (BigInt(blockBidMicros) * 2n).toString();

    // Checked here so the message names the field, rather than coming back as a generic
    // 400 that leaves you guessing which one was wrong.
    if (trimmedBrand.length === 0) {
      setError("Your brand name is what developers see on the card.");
      return;
    }
    if (logo === null) {
      setError("Add a logo — the card has a space for it and it looks broken without one.");
      return;
    }
    if (!clickUrl.startsWith("https://") || clickUrl.length < 12) {
      setError("The link has to be an https address.");
      return;
    }
    if (budgetMicros === null) {
      setError("Budget should be an amount like 100.00.");
      return;
    }
    if (BigInt(budgetMicros) < 1_000_000n) {
      setError("The minimum budget is $1.00.");
      return;
    }
    if (cpmMicros === null) {
      setError("Maximum block bid should be an amount like 1.00.");
      return;
    }
    if (BigInt(blockBidMicros ?? "0") < ECONOMICS.floorBlockMicros) {
      setError(`The minimum bid is ${formatMicros(ECONOMICS.floorBlockMicros, 2)} per 500 impressions.`);
      return;
    }

    setBusy(true);
    setError(null);

    const t = await token();

    /*
     * Three writes, in the only order they can happen in, each reporting what it was
     * doing if it fails. A single "couldn't create campaign" after the account was
     * already made would leave someone re-submitting a form that would now fail
     * differently.
     */
    setStep("Creating your advertiser account…");
    const account = await apiFetch<AdvertiserView>({
      path: "/portal/advertiser",
      token: t,
      method: "POST",
      body: { name: trimmedBrand },
    });

    // Already having one is the normal case on the second campaign, not a failure.
    if (!account.ok && account.error !== "already-advertiser") {
      setBusy(false);
      setStep(null);
      setError(MESSAGES[account.error]);
      return;
    }

    setStep("Creating the campaign…");
    const campaign = await apiFetch<CampaignView>({
      path: "/portal/campaigns",
      token: t,
      method: "POST",
      body: {
        name: campaignName.trim().length > 0 ? campaignName.trim() : defaultName(trimmedBrand),
        cpmMicros,
        budgetMicros,
        targetTags: tags,
      },
    });

    if (!campaign.ok) {
      setBusy(false);
      setStep(null);
      setError(MESSAGES[campaign.error]);
      return;
    }

    setStep("Submitting your card for review…");
    const creative = await apiFetch<CreativeView>({
      path: "/portal/creatives",
      token: t,
      method: "POST",
      body: {
        campaignId: campaign.value.campaignId,
        advertiser: trimmedBrand,
        headline: headline.trim(),
        body: body.trim().length === 0 ? null : body.trim(),
        clickUrl,
        logoLight: logo,
        // One upload covers both themes unless a second is given. Most logos work on
        // both, and asking for two up front is a step that stops people.
        logoDark: darkLogo ?? logo,
      },
    });

    setBusy(false);
    setStep(null);

    if (!creative.ok) {
      // The campaign exists, so the detail page is where they can retry the card rather
      // than starting the whole thing again.
      setError(`${MESSAGES[creative.error]} Your campaign was created — add the card there.`);
      router.push(`/portal?campaign=${campaign.value.campaignId}`);
      return;
    }

    router.push(`/portal?campaign=${campaign.value.campaignId}&created=1`);
  };

  return (
    <form onSubmit={submit} className="campaign-builder">
      <div className="campaign-builder-form">
        {error !== null && (
          <div className="notice" data-tone="error" role="alert">
            {error}
          </div>
        )}

        <section className="ios-card">
          <header className="ios-card-head">
            <h2>Your card</h2>
            <p>This is all a developer ever sees. It sits in the corner of their editor.</p>
          </header>

          <div className="field">
            <label htmlFor="brand">Brand name</label>
            <span className="field-hint">
              Shown on the card, and the name on your advertiser account.
            </span>
            <input
              id="brand"
              className="input"
              maxLength={LIMITS.brand}
              required
              placeholder="Acme"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="headline">Your message</label>
            <span className="field-hint">
              {headline.length}/{LIMITS.headline} — it sits in a small card, so shorter reads
              better.
            </span>
            <input
              id="headline"
              className="input"
              maxLength={LIMITS.headline}
              required
              placeholder="Ship faster with Acme"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="body">Supporting line</label>
            <span className="field-hint">
              Optional. {body.length}/{LIMITS.body}
            </span>
            <input
              id="body"
              className="input"
              maxLength={LIMITS.body}
              placeholder="A build tool for Rust teams"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          <LogoDrop
            label="Logo"
            hint="Square works best. Dropped here, resized here — nothing to host."
            value={logo}
            onChange={setLogo}
          />

          <div className="field">
            <label htmlFor="link">Where it goes</label>
            <input
              id="link"
              className="input"
              type="url"
              required
              placeholder="https://acme.com/developers"
              value={clickUrl}
              onChange={(e) => setClickUrl(e.target.value)}
            />
          </div>
        </section>

        <section className="ios-card">
          <header className="ios-card-head">
            <h2>Budget and reach</h2>
            <p>Serving stops the moment the budget is spent. There is no overrun.</p>
          </header>

          <div className="field">
            <label htmlFor="budget">Total budget</label>
            <span className="field-hint">
              Reserved from your funded balance while the campaign is live.
            </span>
            <input
              id="budget"
              className="input"
              inputMode="decimal"
              required
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Who sees it</label>
            <span className="field-hint">
              Leave everything unticked to reach every developer.
            </span>
            <TagPicker selected={tags} onChange={setTags} />
          </div>

          <details className="ios-disclosure">
            <summary>Advanced</summary>

            <div className="field">
              <label htmlFor="cpm">Maximum bid per 500 impressions</label>
              <span className="field-hint">
                The floor is {formatMicros(ECONOMICS.floorBlockMicros, 2)}. A second-price
                auction sets the clearing price, so a winning block can cost less than this bid.
              </span>
              <input
                id="cpm"
                className="input"
                inputMode="decimal"
                value={cpm}
                onChange={(e) => setCpm(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="cname">Campaign name</label>
              <span className="field-hint">
                Only you see this. Left blank, it is named after your brand and today&apos;s
                date.
              </span>
              <input
                id="cname"
                className="input"
                maxLength={80}
                placeholder={defaultName(brand.trim() || "Acme")}
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
              />
            </div>

            <LogoDrop
              label="Logo for dark themes"
              hint="Optional. Only needed if your logo disappears on a dark background."
              value={darkLogo}
              onChange={setDarkLogo}
            />
          </details>
        </section>

        <div className="notice" data-tone="info">
          Nothing is charged yet. Campaigns start paused: we review the card, then you fund
          it and set it live.
        </div>

        <div className="actions">
          <button type="submit" className="btn btn-primary btn-large" disabled={busy}>
            {busy ? (step ?? "Working…") : "Start campaign"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => router.push("/portal#campaigns")}>
            Cancel
          </button>
        </div>
      </div>

      {/* Sticky on a wide screen, because the whole point is watching it change as you
          type; it falls back to sitting above the form on a phone. */}
      <aside className="campaign-builder-preview">
        <div className="ios-card">
          <header className="ios-card-head">
            <h2>How it looks</h2>
            <p>Actual size, in the corner of the editor.</p>
          </header>

          <div className="card-preview-ground">
            <div className="toast" style={{ position: "static", animation: "none" }}>
              <span className="toast-tag">Sponsored · {brand.trim() || "Your brand"}</span>
              <span className="toast-headline">
                {logo !== null && (
                  // eslint-disable-next-line @next/next/no-img-element -- a data: URL at
                  // its rendered size; next/image would proxy it for nothing.
                  <img src={logo} alt="" className="toast-logo" width={28} height={28} />
                )}
                <span className="toast-head">{headline.trim() || "Your message"}</span>
              </span>
              {body.trim().length > 0 && <span className="toast-body">{body}</span>}
            </div>
          </div>

          <ul className="ios-group ios-group-plain">
            <li>
              <span>Budget</span>
              <b className="money">${budget || "0.00"}</b>
            </li>
            <li>
              <span>Reaches</span>
              <b>{tags.length === 0 ? "Every developer" : `${tags.length} tags`}</b>
            </li>
            <li>
              <span>Bid per 500 impressions</span>
              <b className="money">${cpm || "0.00"}</b>
            </li>
          </ul>
        </div>
      </aside>
    </form>
  );
}

/** "Acme · Aug 2026" — recognisable in a list six months later without being typed. */
function defaultName(brand: string): string {
  const month = new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return `${brand} · ${month}`;
}
