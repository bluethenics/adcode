"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { money, when } from "@/components/money";
import { AdminSummary } from "@/components/AdminUI";
import { AdminLoader } from "@/components/AdminLoader";
import { apiFetch, MESSAGES } from "@/lib/api";

/*
 * Admin > Ads > Ad safety (services/api adSafety.ts, adIntegrity.ts; 2026-11-26).
 *
 * Everything an administrator needs when an ad partner complains, or a new advertiser turns
 * up, on one page:
 *  - who may advertise without a look first, and whether cards pay unverified accounts;
 *  - every ad network's circuit breaker: Pause stops a network serving and paying at once,
 *    Resume starts it again. The integrity guards open one on their own when traffic looks
 *    automated, and only a person closes it;
 *  - the alerts behind those pauses;
 *  - earnings held while a partner reviews them, released one account at a time or all at once.
 */

type CreativeReview = "auto" | "new-advertisers" | "all";
interface Settings { creativeReview: CreativeReview; cardsNeedVerifiedEmail: boolean; updatedAt: number | null; updatedBy: string | null }
interface Breaker { network: string; open: boolean; reason: string | null; openedAt: number | null }
interface Alert { id: number; network: string; reason: string; details: Record<string, unknown>; at: number }
interface Network { id: string; name: string; provider: string; enabled: boolean }
interface Hold { uid: string; reason: string; heldMicros: string; sourceMicros: string; alreadySpentMicros: string; placedAt: number; placedBy: string; note: string | null }
interface Holds { holds: Hold[]; accounts: number; heldMicros: string }
interface Safety { settings: Settings; breakers: Breaker[]; alerts: Alert[]; networks: Network[]; holds: Holds | null }

const REVIEW_CHOICES: { id: CreativeReview; label: string; hint: string }[] = [
  { id: "new-advertisers", label: "Review a new advertiser's first ads", hint: "Recommended. Cards from an advertiser with none approved yet wait in Creatives; once one is approved, their next cards go live by themselves." },
  { id: "all", label: "Review every new ad", hint: "Every card waits in Creatives until you approve it. Safest, and the most work." },
  { id: "auto", label: "Approve automatically", hint: "Cards go live the moment they are submitted, as before 2.7.0. Only the automatic checks on links and images stand in the way." },
];

const REASONS: Record<string, string> = {
  manual: "Paused by an administrator",
  "repeat-ratio": "Many claims on a 30-second timer",
  "conversation-breaches": "Too many cards per conversation",
  "country-spike": "Machine-speed claims from one country",
};

const reasonLabel = (reason: string | null): string => (reason === null ? "" : REASONS[reason] ?? reason);

export function AdSafety() {
  const { token } = useAuth();
  const [data, setData] = useState<Safety | null>(null);
  const [draft, setDraft] = useState<Pick<Settings, "creativeReview" | "cardsNeedVerifiedEmail"> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const found = await apiFetch<Safety>({ path: "/admin/ad-safety", token: await token() });
    if (found.ok) {
      setData(found.value);
      setDraft({ creativeReview: found.value.settings.creativeReview, cardsNeedVerifiedEmail: found.value.settings.cardsNeedVerifiedEmail });
    } else setError(MESSAGES[found.error]);
    setLoading(false);
  }, [token]);

  useEffect(() => void load(), [load]);

  const call = async (key: string, path: string, method: "POST", body: unknown, done: string) => {
    setBusy(key);
    setNotice(null);
    const result = await apiFetch<unknown>({ path, token: await token(), method, body });
    setBusy(null);
    if (result.ok) { setNotice(done); await load(); }
    else setError(MESSAGES[result.error]);
  };

  if (loading) return <AdminLoader label="Loading ad safety" />;
  if (data === null || draft === null) return <div className="notice" data-tone="error" role="alert">{error ?? "Ad safety could not be loaded."}</div>;

  const chatNetworks = data.networks.filter((network) => network.provider === "zeekend" || network.provider === "imprezia");
  const ids = [...new Set([...chatNetworks.map((network) => network.id), ...data.breakers.map((breaker) => breaker.network)])];
  const breakerFor = (id: string) => data.breakers.find((breaker) => breaker.network === id && breaker.open);
  const paused = ids.filter((id) => breakerFor(id) !== undefined).length;
  const dayAgo = Date.now() - 86_400_000;
  const recentAlerts = data.alerts.filter((alert) => alert.at >= dayAgo).length;
  const dirty = draft.creativeReview !== data.settings.creativeReview || draft.cardsNeedVerifiedEmail !== data.settings.cardsNeedVerifiedEmail;

  return (
    <>
      {error !== null && <div className="notice" data-tone="error" role="alert">{error}</div>}
      {notice !== null && <div className="notice" data-tone="success" role="status">{notice}</div>}

      <AdminSummary items={[
        { label: "Networks paused", value: paused, hint: `of ${ids.length}`, ...(paused > 0 ? { tone: "warn" as const } : {}) },
        { label: "Alerts, last day", value: recentAlerts, hint: "From the integrity guards", ...(recentAlerts > 0 ? { tone: "warn" as const } : {}) },
        { label: "Earnings held", value: data.holds === null ? "-" : <span className="money">{money(data.holds.heldMicros)}</span>, hint: data.holds === null ? "Holds are not set up on this database" : `${data.holds.accounts.toLocaleString()} ${data.holds.accounts === 1 ? "account" : "accounts"}` },
      ]} />

      <section className="card adm-safety-section">
        <h2>New advertisers</h2>
        <p className="muted">Who may put an ad in front of developers before a person has looked at it. Waiting cards are in <a href="/admin/review">Creatives</a>.</p>
        <div className="adm-safety-choices" role="radiogroup" aria-label="Review new ads">
          {REVIEW_CHOICES.map((choice) => (
            <label key={choice.id} className="adm-safety-choice" data-on={draft.creativeReview === choice.id}>
              <input type="radio" name="creative-review" checked={draft.creativeReview === choice.id} onChange={() => setDraft({ ...draft, creativeReview: choice.id })} />
              <span><strong>{choice.label}</strong><small>{choice.hint}</small></span>
            </label>
          ))}
        </div>
        <h2>Who sponsored cards pay</h2>
        <label className="adm-safety-choice" data-on={draft.cardsNeedVerifiedEmail}>
          <input type="checkbox" checked={draft.cardsNeedVerifiedEmail} onChange={(event) => setDraft({ ...draft, cardsNeedVerifiedEmail: event.target.checked })} />
          <span>
            <strong>Only accounts with a verified email</strong>
            <small>Recommended. Anonymous accounts cost nothing to make, so paying them invites farms of fake accounts. Unverified people still see cards; they are told to confirm their email to earn.</small>
          </span>
        </label>
        <div className="adm-row-actions">
          <button type="button" className="btn btn-small btn-primary" disabled={!dirty || busy === "settings"} onClick={() => void call("settings", "/admin/ad-safety", "POST", draft, "Saved. New ads and card claims follow these rules from now on.")}>Save</button>
          {dirty && <button type="button" className="btn btn-small btn-outline" onClick={() => setDraft({ creativeReview: data.settings.creativeReview, cardsNeedVerifiedEmail: data.settings.cardsNeedVerifiedEmail })}>Undo changes</button>}
          {data.settings.updatedAt !== null && <span className="muted">Last changed {when(data.settings.updatedAt)}{data.settings.updatedBy !== null ? ` by ${data.settings.updatedBy}` : ""}</span>}
        </div>
      </section>

      <section className="card adm-safety-section">
        <h2>Ad networks</h2>
        <p className="muted">Pause stops a network at once: the editor stops asking it for cards and its cards stop paying. The guards below pause a network by themselves when its traffic looks automated; only you can resume it.</p>
        {ids.length === 0 ? <p className="muted">No partner network is connected. Add one in <a href="/admin/ad-networks">Ad networks</a>.</p> : (
          <div className="adm-stack-list">
            {ids.map((id) => {
              const network = chatNetworks.find((one) => one.id === id);
              const breaker = breakerFor(id);
              return (
                <article key={id} className="adm-row adm-safety-network" data-paused={breaker !== undefined}>
                  <header className="adm-row-head">
                    <strong>{network?.name ?? id}</strong>
                    <span className="adm-safety-state">{breaker !== undefined ? "Paused" : network?.enabled === false ? "Turned off in Ad networks" : "Running"}</span>
                  </header>
                  {breaker !== undefined && <p className="muted">{reasonLabel(breaker.reason)}{breaker.openedAt !== null ? ` · since ${when(breaker.openedAt)}` : ""}</p>}
                  <div className="adm-row-actions">
                    {breaker !== undefined ? (
                      <button type="button" className="btn btn-small btn-primary" disabled={busy === id} onClick={() => {
                        if (window.confirm(`Resume ${network?.name ?? id}? Its cards will show and pay again.`)) void call(id, `/admin/ad-integrity/${encodeURIComponent(id)}/reset`, "POST", {}, `${network?.name ?? id} is running again.`);
                      }}>Resume</button>
                    ) : (
                      <button type="button" className="btn btn-small btn-outline" disabled={busy === id} onClick={() => {
                        const note = window.prompt(`Pause ${network?.name ?? id} now? Add a note for the record (optional).`, "");
                        if (note !== null) void call(id, `/admin/ad-integrity/${encodeURIComponent(id)}/pause`, "POST", { note }, `${network?.name ?? id} is paused.`);
                      }}>Pause</button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="card adm-safety-section">
        <h2>Recent alerts</h2>
        {data.alerts.length === 0 ? <p className="muted">No alerts. Each automatic pause, and each pause by hand, is listed here.</p> : (
          <ul className="adm-safety-alerts">
            {data.alerts.slice(0, 20).map((alert) => (
              <li key={alert.id}>
                <strong>{alert.network}</strong> · {reasonLabel(alert.reason)} · <span className="muted">{when(alert.at)}</span>
                {typeof alert.details["note"] === "string" && <span className="muted"> · {String(alert.details["note"])}</span>}
                {typeof alert.details["country"] === "string" && <span className="muted"> · {String(alert.details["country"])}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card adm-safety-section">
        <h2>Held earnings</h2>
        <p className="muted">Money credited by a partner that is reviewing it. Held money stays in each balance but cannot be converted or withdrawn; releasing it restores the account exactly. Nothing is ever taken away here.</p>
        {data.holds === null ? <p className="muted">Holds are not set up on this database.</p> : data.holds.accounts === 0 ? <p className="muted">Nothing is held.</p> : (
          <>
            <div className="adm-row-actions">
              <button type="button" className="btn btn-small btn-outline" disabled={busy === "release-all"} onClick={() => {
                if (window.confirm(`Release every hold (${data.holds!.accounts.toLocaleString()} accounts, ${money(data.holds!.heldMicros)})? Each account can convert and withdraw it again.`)) void call("release-all", "/admin/earning-holds/release", "POST", { all: true }, "Every hold was released.");
              }}>Release all</button>
            </div>
            <table className="adm-table">
              <thead><tr><th>Account</th><th>Held</th><th>Already spent</th><th>Held since</th><th></th></tr></thead>
              <tbody>
                {data.holds.holds.map((hold) => (
                  <tr key={`${hold.uid}:${hold.reason}`}>
                    <td className="mono">{hold.uid}</td>
                    <td className="money">{money(hold.heldMicros)}</td>
                    <td className="money muted">{money(hold.alreadySpentMicros)}</td>
                    <td className="muted">{when(hold.placedAt)}</td>
                    <td><button type="button" className="btn btn-small btn-outline" disabled={busy === hold.uid} onClick={() => void call(hold.uid, "/admin/earning-holds/release", "POST", { uid: hold.uid, reason: hold.reason }, "Released.")}>Release</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.holds.accounts > data.holds.holds.length && <p className="muted">Showing the largest {data.holds.holds.length.toLocaleString()} of {data.holds.accounts.toLocaleString()}.</p>}
          </>
        )}
      </section>
    </>
  );
}
