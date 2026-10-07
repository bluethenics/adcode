"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { moneyExact } from "@/components/money";
import { apiFetch } from "@/lib/api";
import { coverageText, sourceCells, SOURCE_COLUMNS, windowLabel, type SourcesView } from "@/lib/sources";

interface CampaignCode {
  code: string;
  label: string;
  active: boolean;
  createdAt: number;
  link: string;
}

const WINDOWS = [7, 30, 90, 0] as const;

/**
 * Where people come from, and what each place is worth: one row per campaign code, one for
 * every invite from a user, and one for everyone nobody can account for.
 *
 * Read it left to right as a funnel - visits, people, people who used ADCode, people who
 * came back - and then as money: what their views earned, what advertisers they brought
 * spent, what was paid out for them, and what ADCode kept.
 */
export function SourcesPanel() {
  const { token } = useAuth();
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<SourcesView | null>(null);
  const [codes, setCodes] = useState<CampaignCode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [made, setMade] = useState<CampaignCode | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const t = await token();
    const [found, list] = await Promise.all([
      apiFetch<SourcesView>({ path: `/admin/sources?days=${days}`, token: t }),
      apiFetch<{ codes: CampaignCode[] }>({ path: "/admin/ref-codes", token: t }),
    ]);
    if (found.ok) {
      setReport(found.value);
      setError(null);
    } else {
      setReport(null);
      setError("Sources could not be loaded. If this is the first deploy with invites, apply the referrals migration.");
    }
    if (list.ok) setCodes(list.value.codes);
    setLoading(false);
  }, [days, token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createCode(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setFormError(null);
    const code = newCode.trim().toLowerCase();
    const result = await apiFetch<CampaignCode>({ path: "/admin/ref-codes", token: await token(), method: "POST", body: { code, label: newLabel.trim() } });
    if (result.ok) {
      setMade(result.value);
      setNewCode("");
      setNewLabel("");
      void load();
    } else {
      setFormError(
        result.error === "invalid-state"
          ? "That code is taken. Pick another."
          : "Use 3-32 lowercase letters, numbers and hyphens, starting with a letter or number.",
      );
    }
  }

  async function setActive(code: string, active: boolean): Promise<void> {
    const result = await apiFetch<CampaignCode>({ path: `/admin/ref-codes/${encodeURIComponent(code)}`, token: await token(), method: "POST", body: { active } });
    if (result.ok) setCodes((current) => current.map((c) => (c.code === code ? result.value : c)));
  }

  const users = report?.rows.find((row) => row.kind === "users");

  return (
    <section className="sources-panel" aria-labelledby="sources-heading">
      <h2 id="sources-heading" className="growth-website-heading">Sources</h2>
      <div className="website-analytics-controls">
        <label>
          Period{" "}
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
            {WINDOWS.map((value) => <option key={value} value={value}>{windowLabel(value)}</option>)}
          </select>
        </label>
        <button type="button" className="btn btn-small" disabled={loading} onClick={() => void load()}>Refresh</button>
      </div>

      {loading && <p role="status">Loading sources…</p>}
      {error !== null && <p role="alert">{error}</p>}

      {report !== null && (
        <>
          <div className="admin-tiles">
            <div className="admin-tile"><strong>{report.coverage.realUsers === 0 ? "—" : `${Math.round((report.coverage.attributedRealUsers / report.coverage.realUsers) * 100)}%`}</strong><span>New real users with a source</span></div>
            <div className="admin-tile"><strong>{(users?.people ?? 0).toLocaleString("en-US")}</strong><span>People invited by users</span></div>
            <div className="admin-tile"><strong>{(users?.advertisers ?? 0).toLocaleString("en-US")}</strong><span>Advertisers invited by users</span></div>
            <div className="admin-tile"><strong>{moneyExact(users?.paidMicros ?? "0")}</strong><span>Paid out for invites</span></div>
          </div>
          <p className="website-analytics-note">{coverageText(report.coverage)} Grouped by when people arrived; money is everything they brought since.</p>

          <section className="website-analytics-card sources-card">
            <div className="sources-scroll">
              <table>
                <thead><tr>{SOURCE_COLUMNS.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={row.key} data-kind={row.kind}>
                      {sourceCells(row).map((cell, index) => (index === 0 ? <th key={index} scope="row">{cell}</th> : <td key={index}>{cell}</td>))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="website-analytics-note">
              Visits count consenting visitors to each invite page. Real users were seen using ADCode at least once;
              came back means seen on two or more days. A view by an invited person of an ad from an invited
              advertiser counts in both rows, so the money columns are not added up across rows.
            </p>
          </section>

          {report.topReferrers.length > 0 && (
            <details className="website-analytics-card">
              <summary>Top referrers</summary>
              <div className="sources-scroll">
                <table>
                  <thead><tr><th scope="col">Account</th><th scope="col">Code</th><th scope="col">People</th><th scope="col">Real users</th><th scope="col">Advertisers</th><th scope="col">Brought in</th><th scope="col">Paid out</th></tr></thead>
                  <tbody>
                    {report.topReferrers.map((row) => (
                      <tr key={row.referrerUid}>
                        <td className="mono">{row.referrerUid}</td>
                        <td className="mono">{row.code}</td>
                        <td>{row.people}</td>
                        <td>{row.realUsers}</td>
                        <td>{row.advertisers}</td>
                        <td>{moneyExact((BigInt(row.adRevenueMicros) + BigInt(row.advertiserSpendMicros)).toString())}</td>
                        <td>{moneyExact(row.paidMicros)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}

      <section className="website-analytics-card">
        <h2>Campaign codes</h2>
        <p className="website-analytics-note">
          A code for one of your own posts or ads. Put its link in the post; people who arrive through it are counted in
          their own row above. Campaign codes pay nobody.
        </p>
        <form className="sources-form" onSubmit={(event) => void createCode(event)}>
          <label>Code <input value={newCode} onChange={(event) => setNewCode(event.target.value)} placeholder="threads-oct06" required /></label>
          <label>Note <input value={newLabel} onChange={(event) => setNewLabel(event.target.value)} placeholder="Threads post about the Store launch" maxLength={120} /></label>
          <button type="submit" className="btn btn-small btn-primary">Create link</button>
        </form>
        {formError !== null && <p role="alert">{formError}</p>}
        {made !== null && (
          <p className="sources-made" role="status">
            Your link: <code>{made.link}</code>{" "}
            <button type="button" className="btn btn-small" onClick={() => void navigator.clipboard.writeText(made.link)}>Copy</button>
          </p>
        )}
        {codes.length > 0 && (
          <table>
            <thead><tr><th scope="col">Code</th><th scope="col">Note</th><th scope="col">Link</th><th scope="col">Live</th></tr></thead>
            <tbody>
              {codes.map((code) => (
                <tr key={code.code}>
                  <td className="mono">{code.code}</td>
                  <td>{code.label}</td>
                  <td className="mono">{code.link}</td>
                  <td><input type="checkbox" aria-label={`${code.code} accepts new people`} checked={code.active} onChange={(event) => void setActive(code.code, event.target.checked)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </section>
  );
}
