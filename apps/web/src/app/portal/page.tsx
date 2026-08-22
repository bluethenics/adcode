"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES, type AdvertiserView, type CampaignView } from "@/lib/api";
import { money, statusLabel, tone } from "@/components/money";
import { PORTAL_TABS } from "./tabs";

export default function PortalHome() {
  return (
    <AppShell title="Advertiser portal" tabs={PORTAL_TABS}>
      <PortalBody />
    </AppShell>
  );
}

function PortalBody() {
  const { token } = useAuth();
  const [advertiser, setAdvertiser] = useState<AdvertiserView | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignView[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "signup" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const t = await token();
    const found = await apiFetch<AdvertiserView>({ path: "/portal/advertiser", token: t });

    if (!found.ok) {
      // "No advertiser yet" is the sign-up path, not an error to apologise for.
      if (found.error === "no-advertiser") {
        setState("signup");
        return;
      }
      setError(MESSAGES[found.error]);
      setState("error");
      return;
    }

    setAdvertiser(found.value);

    const list = await apiFetch<CampaignView[]>({ path: "/portal/campaigns", token: t });
    if (list.ok) setCampaigns(list.value);
    setState("ready");
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const createAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || name.trim().length === 0) return;

    setBusy(true);
    setError(null);

    const t = await token();
    const created = await apiFetch<AdvertiserView>({
      path: "/portal/advertiser",
      token: t,
      method: "POST",
      body: { name: name.trim() },
    });

    setBusy(false);
    if (!created.ok) {
      setError(MESSAGES[created.error]);
      return;
    }
    setState("loading");
    void load();
  };

  if (state === "loading") return <p className="lede">Loading…</p>;

  if (state === "error") {
    return (
      <div className="notice" data-tone="error" role="alert">
        {error}
      </div>
    );
  }

  if (state === "signup") {
    return (
      <div className="auth-card" style={{ margin: "20px 0" }}>
        <h1>Name your advertiser account</h1>
        <p className="field-hint" style={{ marginBottom: 20 }}>
          This is the name developers see on your ads. You can create campaigns straight
          away; you only add funds when you&apos;re ready to go live.
        </p>

        {error !== null && (
          <div className="notice" data-tone="error" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={createAccount}>
          <div className="field">
            <label htmlFor="adv-name">Advertiser name</label>
            <input
              id="adv-name"
              className="input"
              maxLength={60}
              required
              placeholder="Acme Inc."
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: "100%" }}>
            Create advertiser account
          </button>
        </form>
      </div>
    );
  }

  const live = campaigns.filter((c) => c.status === "active").length;

  return (
    <>
      <div className="stats">
        <div className="stat">
          <span className="stat-label">Available to commit</span>
          <span className="stat-value money">{money(advertiser?.availableMicros ?? "0")}</span>
          <span className="stat-hint">Funded, not yet promised to a campaign</span>
        </div>
        <div className="stat">
          <span className="stat-label">Committed</span>
          <span className="stat-value">{money(advertiser?.reservedMicros ?? "0")}</span>
          <span className="stat-hint">Reserved by live campaigns</span>
        </div>
        <div className="stat">
          <span className="stat-label">Total funded</span>
          <span className="stat-value">{money(advertiser?.fundedMicros ?? "0")}</span>
          <span className="stat-hint">All payments received</span>
        </div>
        <div className="stat">
          <span className="stat-label">Live campaigns</span>
          <span className="stat-value">{live}</span>
          <span className="stat-hint">{campaigns.length} total</span>
        </div>
      </div>

      <div className="actions" style={{ marginTop: 0, marginBottom: 24 }}>
        <Link href="/portal/campaigns/new" className="btn btn-primary btn-small">
          New campaign
        </Link>
        <Link href="/portal/billing" className="btn btn-outline btn-small">
          Add funds
        </Link>
      </div>

      {campaigns.length === 0 ? (
        <div className="empty">
          <h3>No campaigns yet</h3>
          <p>
            A campaign holds your budget and targeting. Create one, add a creative, and it
            goes live once the creative is approved and the budget is funded.
          </p>
          <div className="actions" style={{ justifyContent: "center" }}>
            <Link href="/portal/campaigns/new" className="btn btn-primary btn-small">
              Create your first campaign
            </Link>
          </div>
        </div>
      ) : (
        <div className="rows">
          <div className="row row-head">
            <span className="row-main">Campaign</span>
            <span className="row-num">Views</span>
            <span className="row-num">Clicks</span>
            <span className="row-num">Spent</span>
          </div>
          {campaigns.map((campaign) => (
            <Link key={campaign.campaignId} href={`/portal/campaigns/${campaign.campaignId}`} className="row">
              <span className="row-main">
                <span className="row-title">{campaign.name}</span>
                <span className="row-sub">
                  <span className="pill" data-tone={tone(campaign.status)}>
                    {statusLabel(campaign.status)}
                  </span>{" "}
                  {money(campaign.budgetMicros)} budget ·{" "}
                  {campaign.targetTags.length === 0
                    ? "everyone"
                    : `${campaign.targetTags.length} tag${campaign.targetTags.length === 1 ? "" : "s"}`}
                </span>
              </span>
              <span className="row-num mono">{campaign.impressions}</span>
              <span className="row-num mono">{campaign.clicks}</span>
              <span className="row-num mono">{money(campaign.spentMicros)}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
