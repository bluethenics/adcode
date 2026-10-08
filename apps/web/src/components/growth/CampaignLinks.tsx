"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch } from "@/lib/api";
import type { SourceRowView } from "@/lib/sources";
import { useCampaignCodes, useSources, WindowPicker, type CampaignCode } from "./useGrowthData";

/** A code's row in Sources, matched by code, or null before anybody used it. */
export function rowForCode(rows: readonly SourceRowView[] | undefined, code: string): SourceRowView | null {
  return rows?.find((row) => row.kind === "campaign" && row.code === code) ?? null;
}

/**
 * Links for ADCode's own posts and ads. Each one is a code with no owner: the people who
 * arrive through it are counted in a row of their own, and it pays nobody.
 */
export function CampaignLinks() {
  const { token } = useAuth();
  const [days, setDays] = useState(30);
  const codes = useCampaignCodes();
  const sources = useSources(days);
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [made, setMade] = useState<CampaignCode | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function create(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setFormError(null);
    const code = newCode.trim().toLowerCase();
    const result = await apiFetch<CampaignCode>({ path: "/admin/ref-codes", token: await token(), method: "POST", body: { code, label: newLabel.trim() } });
    if (result.ok) {
      setMade(result.value);
      setNewCode("");
      setNewLabel("");
      void codes.reload();
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
    if (result.ok) void codes.reload();
  }

  function copy(link: string): void {
    void navigator.clipboard.writeText(link).then(() => setCopied(link), () => undefined);
  }

  const list = codes.value?.codes ?? [];

  return (
    <div className="growth-links">
      <section className="website-analytics-card" aria-labelledby="growth-new-link">
        <h2 id="growth-new-link">Make a link for a post</h2>
        <p className="website-analytics-note">
          One link per post or ad - a Threads post, an X ad, a newsletter. People who arrive through it get a row of their
          own in Sources, so you can see which post brought people who stayed. Campaign links pay nobody.
        </p>
        <form className="sources-form" onSubmit={(event) => void create(event)}>
          <label>Code <input value={newCode} onChange={(event) => setNewCode(event.target.value)} placeholder="threads-oct07" required /></label>
          <label>Note <input value={newLabel} onChange={(event) => setNewLabel(event.target.value)} placeholder="Threads post about the Store launch" maxLength={120} /></label>
          <button type="submit" className="btn btn-small btn-primary">Create link</button>
        </form>
        {formError !== null && <p role="alert">{formError}</p>}
        {made !== null && (
          <p className="sources-made" role="status">
            Your link: <code>{made.link}</code>{" "}
            <button type="button" className="btn btn-small" onClick={() => copy(made.link)}>{copied === made.link ? "Copied" : "Copy"}</button>
          </p>
        )}
      </section>

      <WindowPicker days={days} onChange={setDays} loading={sources.loading || codes.loading} onRefresh={() => { void codes.reload(); void sources.reload(); }} />
      {codes.error !== null && <p role="alert">{codes.error}</p>}

      {codes.value !== null && list.length === 0 && <p className="website-analytics-note">No links yet. Make one above for your next post.</p>}

      {list.length > 0 && (
        <section className="website-analytics-card sources-card" aria-labelledby="growth-links-heading">
          <h2 id="growth-links-heading">Your links</h2>
          <div className="sources-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Note</th>
                  <th scope="col">Visits</th>
                  <th scope="col">People</th>
                  <th scope="col">Real users</th>
                  <th scope="col">Came back</th>
                  <th scope="col">Link</th>
                  <th scope="col">Live</th>
                </tr>
              </thead>
              <tbody>
                {list.map((code) => {
                  const row = rowForCode(sources.value?.rows, code.code);
                  return (
                    <tr key={code.code} data-active={code.active}>
                      <th scope="row" className="mono">{code.code}</th>
                      <td>{code.label === "" ? "—" : code.label}</td>
                      <td>{row?.visits === null || row === null ? "0" : row.visits.toLocaleString("en-US")}</td>
                      <td>{(row?.people ?? 0).toLocaleString("en-US")}</td>
                      <td>{(row?.realUsers ?? 0).toLocaleString("en-US")}</td>
                      <td>{(row?.cameBack ?? 0).toLocaleString("en-US")}</td>
                      <td><button type="button" className="btn btn-small" onClick={() => copy(code.link)}>{copied === code.link ? "Copied" : "Copy link"}</button></td>
                      <td><input type="checkbox" aria-label={`${code.code} accepts new people`} checked={code.active} onChange={(event) => void setActive(code.code, event.target.checked)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="website-analytics-note">Turn a link off and nobody new is counted to it; the address still opens, as a plain ADCode page.</p>
        </section>
      )}
    </div>
  );
}
