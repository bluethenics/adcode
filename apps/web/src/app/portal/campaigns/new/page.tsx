"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { TagPicker } from "@/components/TagPicker";
import { apiFetch, MESSAGES, type AdvertiserView, type ApiResult, type CampaignView } from "@/lib/api";
import { dollarsToMicros } from "@/components/money";
import { PORTAL_TABS } from "../../tabs";

export default function NewCampaign() {
  return (
    <AppShell title="New campaign" tabs={PORTAL_TABS}>
      <NewCampaignForm />
    </AppShell>
  );
}

function NewCampaignForm() {
  const { token } = useAuth();
  const router = useRouter();

  const [name, setName] = useState("");
  const [cpm, setCpm] = useState("8.00");
  const [budget, setBudget] = useState("100.00");
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown only when the server says this account has no advertiser yet. The form creates
  // one and carries on in the same submit, rather than sending you to a separate sign-up
  // page and back - which was three extra clicks to do the same two requests.
  const [needsAdvertiser, setNeedsAdvertiser] = useState(false);
  const [advertiserName, setAdvertiserName] = useState("");

  const createCampaign = async (): Promise<ApiResult<CampaignView>> =>
    apiFetch<CampaignView>({
      path: "/portal/campaigns",
      token: await token(),
      method: "POST",
      body: { name: name.trim(), cpmMicros: dollarsToMicros(cpm), budgetMicros: dollarsToMicros(budget), targetTags: tags },
    });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;

    const cpmMicros = dollarsToMicros(cpm);
    const budgetMicros = dollarsToMicros(budget);

    // Checked here so the message names the field, rather than coming back as a generic
    // 400 that leaves you guessing which number was wrong.
    if (cpmMicros === null) {
      setError("CPM should be an amount like 8.00.");
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

    setBusy(true);
    setError(null);

    let created = await createCampaign();

    if (!created.ok && created.error === "no-advertiser") {
      if (advertiserName.trim().length === 0) {
        setBusy(false);
        setNeedsAdvertiser(true);
        setError("First time publishing? Name your advertiser account below, then submit again.");
        return;
      }

      const account = await apiFetch<AdvertiserView>({
        path: "/portal/advertiser",
        token: await token(),
        method: "POST",
        body: { name: advertiserName.trim() },
      });

      if (!account.ok) {
        setBusy(false);
        setError(MESSAGES[account.error]);
        return;
      }

      created = await createCampaign();
    }

    setBusy(false);
    if (!created.ok) {
      setError(MESSAGES[created.error]);
      return;
    }

    router.push(`/portal/campaigns/${created.value.campaignId}`);
  };

  return (
    <form onSubmit={submit} style={{ maxWidth: 620 }}>
      {error !== null && (
        <div className="notice" data-tone={needsAdvertiser ? "info" : "error"} role="alert">
          {error}
        </div>
      )}

      {needsAdvertiser && (
        <div className="field">
          <label htmlFor="c-adv">Advertiser name</label>
          <span className="field-hint">
            The name developers see on your ads. Your account is created with the campaign —
            no separate sign-up.
          </span>
          <input
            id="c-adv"
            className="input"
            maxLength={60}
            placeholder="Acme Inc."
            value={advertiserName}
            onChange={(e) => setAdvertiserName(e.target.value)}
          />
        </div>
      )}

      <div className="notice" data-tone="info">
        Campaigns start paused. Nothing is charged until you add a creative, it&apos;s
        approved, and you set the campaign live.
      </div>

      <div className="field">
        <label htmlFor="c-name">Campaign name</label>
        <span className="field-hint">Only you see this. Something you&apos;ll recognise later.</span>
        <input
          id="c-name"
          className="input"
          maxLength={80}
          required
          placeholder="Rust developers, Q3"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="c-cpm">Cost per thousand views</label>
        <span className="field-hint">
          What you pay for 1,000 verified views. Half of it goes to the developer who saw
          the ad.
        </span>
        <input
          id="c-cpm"
          className="input"
          inputMode="decimal"
          required
          value={cpm}
          onChange={(e) => setCpm(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="c-budget">Total budget</label>
        <span className="field-hint">
          Serving stops the moment this is spent. It&apos;s reserved from your funded
          balance while the campaign is live.
        </span>
        <input
          id="c-budget"
          className="input"
          inputMode="decimal"
          required
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
      </div>

      <div className="field">
        <label>Who sees it</label>
        <TagPicker selected={tags} onChange={setTags} />
      </div>

      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Create campaign
        </button>
        <button type="button" className="btn btn-outline" onClick={() => router.push("/portal")}>
          Cancel
        </button>
      </div>
    </form>
  );
}
