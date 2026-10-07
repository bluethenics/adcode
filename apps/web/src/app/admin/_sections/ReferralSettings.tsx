"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES } from "@/lib/api";
import { moneyExact } from "@/components/money";

interface ReferralConfigView {
  userPercent: string;
  advertiserPercent: string;
  windowDays: number;
  claimDays: number;
  houseAdvertiserIds: string[];
}

interface AdvertiserRow {
  advertiserId: string;
  name: string;
}

/** Yesterday, UTC: the most recent day that has finished and can be settled. */
function yesterday(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

/**
 * The invite programme's terms, which advertisers are ADCode's own, and settling a day by
 * hand. The nightly job settles the last seven days on its own; the button exists for the
 * day the migration goes live and for checking a change.
 */
export function ReferralSettings() {
  const { token } = useAuth();
  const [config, setConfig] = useState<ReferralConfigView | null>(null);
  const [advertisers, setAdvertisers] = useState<AdvertiserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [day, setDay] = useState(yesterday());
  const [settled, setSettled] = useState<string | null>(null);

  const load = useCallback(async () => {
    const t = await token();
    const [found, list] = await Promise.all([
      apiFetch<ReferralConfigView>({ path: "/admin/referral-config", token: t }),
      apiFetch<{ advertisers: AdvertiserRow[] }>({ path: "/admin/advertisers", token: t }),
    ]);
    if (found.ok) setConfig(found.value);
    else setError("Invite settings could not be loaded. If this is the first deploy with invites, apply the referrals migration.");
    if (list.ok) setAdvertisers(list.value.advertisers);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (config === null) return;
    setSaved(false);
    const result = await apiFetch<ReferralConfigView>({ path: "/admin/referral-config", token: await token(), method: "POST", body: config });
    if (result.ok) {
      setConfig(result.value);
      setSaved(true);
      setError(null);
    } else {
      setError(result.error === "bad-request" ? "Percents are whole numbers from 0 to 50; the window is 0-1095 days; claims 0-60 days." : MESSAGES[result.error]);
    }
  }

  async function settle(): Promise<void> {
    setSettled(null);
    const result = await apiFetch<{ day: string; referrers: number; micros: string }>({
      path: "/admin/referrals/settle",
      token: await token(),
      method: "POST",
      body: { day },
    });
    setSettled(
      result.ok
        ? `${result.value.day}: paid ${moneyExact(result.value.micros)} to ${result.value.referrers} ${result.value.referrers === 1 ? "person" : "people"}. A day already paid pays nothing again.`
        : result.error === "bad-request"
          ? "Pick a day that has finished (UTC)."
          : MESSAGES[result.error],
    );
  }

  if (error !== null && config === null) return <p role="alert">{error}</p>;
  if (config === null) return <p role="status">Loading…</p>;

  const house = new Set(config.houseAdvertiserIds);
  const toggleHouse = (id: string, on: boolean): void =>
    setConfig({ ...config, houseAdvertiserIds: on ? [...house, id] : [...house].filter((x) => x !== id) });

  return (
    <div className="referral-settings">
      <form className="ios-card referral-settings-form" onSubmit={(event) => void save(event)}>
        <h2>Terms</h2>
        <label>Inviter's share of each paid view their people see (%) <input inputMode="numeric" value={config.userPercent} onChange={(event) => setConfig({ ...config, userPercent: event.target.value.trim() })} /></label>
        <label>Share of a referred advertiser's spend (%) <input inputMode="numeric" value={config.advertiserPercent} onChange={(event) => setConfig({ ...config, advertiserPercent: event.target.value.trim() })} /></label>
        <label>Days a claim earns for <input type="number" min={0} max={1095} value={config.windowDays} onChange={(event) => setConfig({ ...config, windowDays: Number(event.target.value) })} /></label>
        <label>Days a new account may add a code <input type="number" min={0} max={60} value={config.claimDays} onChange={(event) => setConfig({ ...config, claimDays: Number(event.target.value) })} /></label>

        <fieldset>
          <legend>ADCode&apos;s own advertisers</legend>
          <p className="field-hint">Their spend is ADCode paying itself, so it never pays an invite share and never counts as revenue in Sources.</p>
          {advertisers.length === 0 && <p className="field-hint">No advertisers yet.</p>}
          {advertisers.map((advertiser) => (
            <label key={advertiser.advertiserId} className="referral-house">
              <input type="checkbox" checked={house.has(advertiser.advertiserId)} onChange={(event) => toggleHouse(advertiser.advertiserId, event.target.checked)} />{" "}
              {advertiser.name} <span className="mono">{advertiser.advertiserId}</span>
            </label>
          ))}
        </fieldset>

        <button type="submit" className="btn btn-small btn-primary">Save terms</button>
        {saved && <p role="status">Saved. New terms apply to days settled from now on.</p>}
        {error !== null && <p role="alert">{error}</p>}
      </form>

      <div className="ios-card referral-settings-form">
        <h2>Settle a day</h2>
        <p className="field-hint">Runs nightly at 00:30 UTC over the last seven days. Use this for a day by hand; it never pays a day twice.</p>
        <label>Day (UTC) <input type="date" value={day} onChange={(event) => setDay(event.target.value)} /></label>
        <button type="button" className="btn btn-small" onClick={() => void settle()}>Settle</button>
        {settled !== null && <p role="status">{settled}</p>}
      </div>
    </div>
  );
}
