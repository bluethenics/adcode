"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch } from "@/lib/api";
import type { SourcesView } from "@/lib/sources";
import type { WebsiteAnalyticsReport } from "@/lib/websiteAnalytics";

/**
 * The reads Admin > Growth is built from, one hook each so a tab loads only what it shows.
 * All of them answer `null` while loading and an error sentence when the API refused: the
 * invite endpoints say 503 until the referrals migration is applied, and the tabs say so
 * in words rather than drawing zeros.
 */

export interface CampaignCode {
  code: string;
  label: string;
  active: boolean;
  createdAt: number;
  link: string;
}

export interface ReferralConfigView {
  userPercent: string;
  advertiserPercent: string;
  windowDays: number;
  claimDays: number;
  houseAdvertiserIds: string[];
}

export const WINDOWS = [7, 30, 90, 0] as const;

const UNAVAILABLE = "Invites could not be loaded. If invites were just added, apply the referrals migration.";

interface Loaded<T> {
  value: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

function useAdminRead<T>(path: string | null, failure: string): Loaded<T> {
  const { token } = useAuth();
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (path === null) return;
    setLoading(true);
    const result = await apiFetch<T>({ path, token: await token() });
    if (result.ok) {
      setValue(result.value);
      setError(null);
    } else {
      setValue(null);
      setError(failure);
    }
    setLoading(false);
  }, [failure, path, token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { value, error, loading, reload };
}

/** Where people came from, per source and per inviting partner. `days` 0 is all time. */
export function useSources(days: number): Loaded<SourcesView> {
  return useAdminRead<SourcesView>(`/admin/sources?days=${days}`, UNAVAILABLE);
}

/** The campaign links operators made for their own posts. */
export function useCampaignCodes(): Loaded<{ codes: CampaignCode[] }> {
  return useAdminRead<{ codes: CampaignCode[] }>("/admin/ref-codes", UNAVAILABLE);
}

/** The programme's terms and which advertisers are ADCode's own. */
export function useReferralConfig(): Loaded<ReferralConfigView> {
  return useAdminRead<ReferralConfigView>("/admin/referral-config", UNAVAILABLE);
}

/** The website report, for invite-page visits per loop. At most 90 days, like Analytics. */
export function useWebsiteReport(days: number): Loaded<WebsiteAnalyticsReport> {
  const span = days === 0 ? 90 : Math.min(90, days);
  return useAdminRead<WebsiteAnalyticsReport>(`/admin/website-analytics?days=${span}`, "Website analytics could not be loaded.");
}

/** The period picker every Growth tab shares. */
export function WindowPicker({ days, onChange, loading, onRefresh }: { days: number; onChange: (days: number) => void; loading: boolean; onRefresh: () => void }) {
  return (
    <div className="website-analytics-controls">
      <label>
        Period{" "}
        <select value={days} onChange={(event) => onChange(Number(event.target.value))}>
          {WINDOWS.map((value) => <option key={value} value={value}>{value === 0 ? "All time" : `Last ${value} days`}</option>)}
        </select>
      </label>
      <button type="button" className="btn btn-small" disabled={loading} onClick={onRefresh}>Refresh</button>
    </div>
  );
}
