"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthProvider";
import { LogoDrop } from "./LogoDrop";
import { SignInCard } from "./SignInCard";
import { TagPicker } from "./TagPicker";
import {
  apiFetch,
  MESSAGES,
  type AdvertiserView,
  type CampaignView,
  type CheckoutView,
  type CreativeView,
} from "@/lib/api";
import { campaignNumbers, formatUsdMicros } from "@/lib/campaignPricing";
import { AdPreviewMark } from "./AdPreviewMark";

const DEFAULT_LOGO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export function LandingBidBuilder() {
  const { user, token, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [headline, setHeadline] = useState("");
  const [clickUrl, setClickUrl] = useState("");
  const [company, setCompany] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [bid, setBid] = useState("1.00");
  const [blocks, setBlocks] = useState("10");
  const [country, setCountry] = useState("");
  const [audience, setAudience] = useState<"everywhere" | "selected">("everywhere");
  const [tags, setTags] = useState<string[]>([]);
  const [showAuth, setShowAuth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparedCampaignId, setPreparedCampaignId] = useState<string | null>(null);

  const numbers = useMemo(() => campaignNumbers(bid, blocks), [bid, blocks]);

  useEffect(() => {
    if (email === "" && user?.email != null) setEmail(user.email);
  }, [email, user]);

  const validate = useCallback((): string | null => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return "Enter the email address for your receipt.";
    if (headline.trim().length < 3 || headline.trim().length > 60) return "Your ad line must be between 3 and 60 characters.";
    if (!clickUrl.trim().startsWith("https://") || clickUrl.trim().length < 12) return "Use a complete https destination URL.";
    if (!/^[A-Za-z]{2}$/.test(country.trim())) return "Enter your two-letter billing country, such as US or IN.";
    if (numbers === null) return "Bid at least $1.00 and choose one or more 500-impression blocks.";
    if (audience === "selected" && tags.length === 0) return "Select at least one developer context, or choose everyone.";
    return null;
  }, [audience, clickUrl, country, email, headline, numbers, tags.length]);

  const beginCheckout = useCallback(async () => {
    const validationError = validate();
    if (validationError !== null || numbers === null) {
      setError(validationError);
      return;
    }

    setBusy(true);
    setError(null);
    const authToken = await token();
    if (authToken === null) {
      setBusy(false);
      setShowAuth(true);
      return;
    }

    const brand = company.trim() || new URL(clickUrl.trim()).hostname.replace(/^www\./, "");
    let campaignId = preparedCampaignId;

    if (campaignId === null) {
      setStatus("Preparing your advertiser account…");
      const account = await apiFetch<AdvertiserView>({
        path: "/portal/advertiser",
        token: authToken,
        method: "POST",
        body: { name: brand },
      });
      if (!account.ok && account.error !== "already-advertiser") {
        setBusy(false);
        setStatus(null);
        setError(MESSAGES[account.error]);
        return;
      }

      setStatus("Creating your campaign…");
      const campaign = await apiFetch<CampaignView>({
        path: "/portal/campaigns",
        token: authToken,
        method: "POST",
        body: {
          name: `${brand} · ${new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" })}`,
          cpmMicros: numbers.cpmMicros.toString(),
          budgetMicros: numbers.budgetMicros.toString(),
          targetTags: audience === "selected" ? tags : [],
        },
      });
      if (!campaign.ok) {
        setBusy(false);
        setStatus(null);
        setError(MESSAGES[campaign.error]);
        return;
      }
      campaignId = campaign.value.campaignId;

      setStatus("Submitting your ad for review…");
      const creative = await apiFetch<CreativeView>({
        path: "/portal/creatives",
        token: authToken,
        method: "POST",
        body: {
          campaignId,
          advertiser: brand,
          headline: headline.trim(),
          body: null,
          clickUrl: clickUrl.trim(),
          logoLight: logo ?? DEFAULT_LOGO,
          logoDark: logo ?? DEFAULT_LOGO,
        },
      });
      if (!creative.ok) {
        setBusy(false);
        setStatus(null);
        setError(`${MESSAGES[creative.error]} The campaign is saved in your advertiser page.`);
        return;
      }
      setPreparedCampaignId(campaignId);
    }

    setStatus("Opening secure Dodo checkout…");
    const checkout = await apiFetch<CheckoutView>({
      path: "/portal/checkout",
      token: authToken,
      method: "POST",
      body: {
        amountMicros: numbers.budgetMicros.toString(),
        billingCountry: country.trim().toUpperCase(),
        email: email.trim(),
      },
    });
    if (!checkout.ok) {
      setBusy(false);
      setStatus(null);
      setError(`${MESSAGES[checkout.error]} Your campaign is saved; you can fund it from the advertiser page.`);
      return;
    }
    window.location.assign(checkout.value.checkoutUrl);
  }, [audience, clickUrl, company, country, email, headline, logo, numbers, preparedCampaignId, tags, token, validate]);

  useEffect(() => {
    if (showAuth && user !== null && !loading && !busy) {
      setShowAuth(false);
      void beginCheckout();
    }
  }, [beginCheckout, busy, loading, showAuth, user]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = validate();
    if (validationError !== null) {
      setError(validationError);
      return;
    }
    if (user === null) {
      setShowAuth(true);
      return;
    }
    void beginCheckout();
  };

  return (
    <div className="landing-bid-shell">
      <form className="landing-bid-form" onSubmit={submit} noValidate>
        <div className="bid-form-head">
          <div><span className="market-kicker">Create an ad</span><h2>Bid in one screen.</h2></div>
          <p>Choose your maximum. The auction may charge less.</p>
        </div>

        {error !== null && <div className="bid-notice" data-tone="error" role="alert">{error}</div>}

        <div className="bid-fields">
          <label className="bid-field"><span>Email <b>required</b></span><input type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="bid-field bid-field-wide"><span>Ad line <b>{headline.length} / 60</b></span><input maxLength={60} placeholder="Build, ship, and debug faster." value={headline} onChange={(event) => setHeadline(event.target.value)} /></label>
          <label className="bid-field bid-field-wide"><span>Destination URL</span><input type="url" placeholder="https://company.com/developers" value={clickUrl} onChange={(event) => setClickUrl(event.target.value)} /></label>
          <label className="bid-field"><span>Company <b>optional</b></span><input maxLength={40} placeholder="Acme" value={company} onChange={(event) => setCompany(event.target.value)} /></label>
          <label className="bid-field"><span>Billing country</span><input maxLength={2} placeholder="US" value={country} onChange={(event) => setCountry(event.target.value.toUpperCase())} /></label>
        </div>

        <LogoDrop label="Brand icon (optional)" hint="PNG, JPEG, or WebP. Square works best." value={logo} onChange={setLogo} />

        <div className="bid-price-grid">
          <label className="bid-field"><span>Bid per block <b>min $1.00</b></span><div className="bid-money-input"><i>$</i><input inputMode="decimal" value={bid} onChange={(event) => setBid(event.target.value)} /></div><small>One block = 500 verified impressions</small></label>
          <label className="bid-field"><span>Number of blocks</span><input inputMode="numeric" value={blocks} onChange={(event) => setBlocks(event.target.value)} /><small>{numbers?.impressions.toLocaleString("en-US") ?? "—"} maximum impressions</small></label>
        </div>

        <fieldset className="bid-audience"><legend>Audience</legend><label data-selected={audience === "everywhere"}><input type="radio" name="audience" checked={audience === "everywhere"} onChange={() => setAudience("everywhere")} />Every developer</label><label data-selected={audience === "selected"}><input type="radio" name="audience" checked={audience === "selected"} onChange={() => setAudience("selected")} />Selected contexts</label></fieldset>
        {audience === "selected" && <div className="bid-tags"><TagPicker selected={tags} onChange={setTags} /></div>}

        <div className="bid-preview-wrap">
          <div className="bid-preview-copy"><span>Live preview</span><small>What a developer sees</small></div>
          <div className="bid-preview"><AdPreviewMark logo={logo} company={company} /><span><b>{company.trim() || "Your company"}</b>{headline.trim() || "Your ad line appears here."}</span><em>Sponsored</em></div>
        </div>

        <div className="bid-total"><span><small>Estimated maximum</small><strong>{numbers === null ? "—" : formatUsdMicros(numbers.budgetMicros)}</strong></span><p>Delivery depends on demand. Your creative is reviewed before it can run.</p></div>
        <button className="bid-checkout" type="submit" disabled={busy}>{busy ? (status ?? "Preparing…") : "Continue to secure checkout"}<span aria-hidden="true">→</span></button>
        <p className="bid-provider">Checkout by Dodo Payments · Credits are added only after a signed payment confirmation.</p>
      </form>

      {showAuth && user === null && <div className="bid-auth"><SignInCard heading="Sign in to save this campaign" /></div>}
    </div>
  );
}
