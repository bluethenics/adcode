"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { useAuth } from "@/components/AuthProvider";
import { RefreshStamp } from "@/components/RefreshStamp";
import { apiFetch, MESSAGES } from "@/lib/api";
import { useCachedResource } from "@/lib/adminCache";
import {
  EVENT_LABELS, REASON_HINTS, REASON_LABELS, SESSION_END_LABELS, SILENT_DAY_CHOICES, STEP_LABELS,
  duration, label, percent,
  type RetentionChurned, type RetentionSummary, type RetentionTimeline, type RetentionUser,
} from "@/lib/retention";
import "@/components/retention.css";

/*
 * Retention: who stops coming back, and why. Summary first - the cohorts, the funnel, the
 * reasons and the friction are one cached row the database rebuilds every hour - then the
 * churned people one page at a time, and any one person's timeline on demand.
 */

const PAGE = 25;
const when = (at: number): string => new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const day = (at: number): string => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function RetentionBody() {
  const params = useSearchParams();
  const router = useRouter();
  const { token } = useAuth();
  const silentDays = SILENT_DAY_CHOICES.find((choice) => String(choice) === params.get("silent")) ?? 7;
  const reason = params.get("reason");
  const uid = params.get("uid");
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = (changes: Record<string, string | null>): void => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key); else next.set(key, value);
    }
    router.replace(`/admin/retention${next.size > 0 ? `?${next.toString()}` : ""}`, { scroll: false });
  };

  const loadSummary = useCallback(async (): Promise<RetentionSummary | null> => {
    const found = await apiFetch<RetentionSummary>({ path: `/admin/retention?silentDays=${silentDays}`, token: await token() });
    setError(found.ok ? null : MESSAGES[found.error]);
    return found.ok ? found.value : null;
  }, [silentDays, token]);
  const summary = useCachedResource(`retention:${silentDays}`, loadSummary);

  const rebuild = async (): Promise<void> => {
    setRebuilding(true);
    const found = await apiFetch<RetentionSummary>({ path: `/admin/retention/refresh?silentDays=${silentDays}`, token: await token(), method: "POST" });
    if (!found.ok) setError(MESSAGES[found.error]);
    await summary.refresh();
    setRebuilding(false);
  };

  const report = summary.value;
  return (
    <AdminShell title="Retention" subtitle="Who stops coming back, where new people drop, and the friction they hit before they left.">
      <div className="retention-controls">
        <label>
          Churned means silent for
          <select className="select" value={silentDays} onChange={(event) => go({ silent: event.target.value, reason: null })}>
            {SILENT_DAY_CHOICES.map((choice) => <option key={choice} value={choice}>{choice} days</option>)}
          </select>
        </label>
        <RefreshStamp asOf={report?.builtAt ?? summary.asOf} refreshing={summary.refreshing || rebuilding} fromCache={summary.fromCache} onRefresh={() => void summary.refresh()} />
        <button type="button" className="btn btn-small" disabled={rebuilding} onClick={() => void rebuild()}>{rebuilding ? "Rebuilding…" : "Rebuild figures"}</button>
      </div>
      {error !== null && report === null && <div className="notice" data-tone="error" role="alert">{error} If this is the first deploy, check that the retention migration has been applied.</div>}
      {report === null && error === null && <p className="lede">Loading retention…</p>}
      {report !== null && <>
        <Totals report={report} />
        {report.totals.users === 0 && <p className="lede">No retention events yet. They start with desktop 2.6.3, from people who leave Help improve ADCode on.</p>}
        <div className="retention-grid">
          <Funnel report={report} />
          <Reasons report={report} active={reason} onPick={(picked) => go({ reason: picked === reason ? null : picked, uid: null })} />
        </div>
        <Cohorts report={report} />
        <Friction report={report} />
      </>}
      <Churned silentDays={silentDays} reason={reason} onReason={(next) => go({ reason: next })} onOpen={(picked) => go({ uid: picked })} />
      {uid !== null && <Timeline uid={uid} onClose={() => go({ uid: null })} />}
      <details className="adm-method">
        <summary>How these figures are counted</summary>
        <p className="lede">Events come only from desktop editors (2.6.3 and later) with Help improve ADCode on, and carry fixed names and codes with times and durations - never prompts, code, file names, paths or chat text. The database folds new events into one row per account every hour and rebuilds this summary; Rebuild figures does it now. Raw events are kept for 90 days.</p>
        <p className="lede">Cohorts and the funnel count new installs only - accounts whose first launch was recorded - by the UTC week of that launch. &ldquo;Day N&rdquo; means seen again N or more UTC days after the first launch; a person counts toward day N only once N days have passed. Churned means seen in the last 90 days and silent for the chosen number of days. The likely reason is the first rule that matches, most specific first: a crash or a limit in the last active day beats anything older, and &ldquo;faded&rdquo; means nothing went visibly wrong. Friction is ranked by how many churned people hit it; &ldquo;churn rate&rdquo; is churned hitters out of everyone in the window who hit it.</p>
      </details>
    </AdminShell>
  );
}

function Totals({ report }: { report: RetentionSummary }) {
  const tiles = [
    { label: "People (last 90 days)", value: report.totals.users },
    { label: "New installs", value: report.totals.newInstalls },
    { label: "Active today", value: report.totals.active1d },
    { label: "Active, 7 days", value: report.totals.active7d },
    { label: "Active, 30 days", value: report.totals.active30d },
    { label: `Churned (${report.silentDays}+ days silent)`, value: report.totals.churned },
  ];
  return <div className="admin-tiles">{tiles.map((tile) => <div className="admin-tile" key={tile.label}><strong>{tile.value.toLocaleString("en-US")}</strong><span>{tile.label}</span></div>)}</div>;
}

function Funnel({ report }: { report: RetentionSummary }) {
  const base = report.funnel.base;
  return (
    <section className="website-analytics-card retention-funnel" aria-labelledby="retention-funnel">
      <h2 id="retention-funnel">Where new installs drop</h2>
      <p className="lede">{base.toLocaleString("en-US")} new installs in the last 90 days, and how many reached each moment.</p>
      <ol>
        {report.funnel.steps.map((step, index) => {
          const previous = index === 0 ? base : report.funnel.steps[index - 1]!.users;
          const lost = Math.max(0, previous - step.users);
          return (
            <li key={step.step}>
              <div className="retention-bar-label"><span>{label(STEP_LABELS, step.step)}</span><b>{step.users.toLocaleString("en-US")} <small>{percent(step.users, base)}</small></b></div>
              <div className="retention-bar" aria-hidden="true"><span style={{ width: base === 0 ? 0 : `${(step.users / base) * 100}%` }} /></div>
              {index > 0 && lost > 0 && <p className="retention-lost">−{lost.toLocaleString("en-US")} ({percent(lost, previous)}) since the step before</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Reasons({ report, active, onPick }: { report: RetentionSummary; active: string | null; onPick: (reason: string) => void }) {
  const rows = report.reasons.filter((row) => row.users > 0);
  const total = report.totals.churned;
  return (
    <section className="website-analytics-card retention-reasons" aria-labelledby="retention-reasons">
      <h2 id="retention-reasons">Why they likely left</h2>
      {rows.length === 0 ? <p className="lede">Nobody has churned at {report.silentDays} days yet.</p> : <>
        <p className="lede">{total.toLocaleString("en-US")} churned people by their likeliest reason. Choose one to list them.</p>
        <ul>
          {rows.map((row) => (
            <li key={row.reason}>
              <button type="button" aria-pressed={active === row.reason} onClick={() => onPick(row.reason)} title={REASON_HINTS[row.reason]}>
                <span className="retention-bar-label"><span>{label(REASON_LABELS, row.reason)}</span><b>{row.users.toLocaleString("en-US")} <small>{percent(row.users, total)}</small></b></span>
                <span className="retention-bar" aria-hidden="true"><span style={{ width: `${(row.users / Math.max(1, rows[0]!.users)) * 100}%` }} /></span>
                <span className="retention-hint">{REASON_HINTS[row.reason]}</span>
              </button>
            </li>
          ))}
        </ul>
      </>}
    </section>
  );
}

function Cohorts({ report }: { report: RetentionSummary }) {
  const cell = (point: { eligible: number; retained: number }) =>
    point.eligible === 0 ? <td className="retention-na">not yet</td> : <td title={`${point.retained} of ${point.eligible}`} style={{ "--share": point.retained / point.eligible } as React.CSSProperties} className="retention-cell">{percent(point.retained, point.eligible)}</td>;
  const rows = [...report.cohorts].reverse();
  return (
    <section className="website-analytics-card" aria-labelledby="retention-cohorts">
      <h2 id="retention-cohorts">Cohorts: who came back</h2>
      <p className="lede">New installs by the week of their first launch, newest first.</p>
      <div className="table-scroll" role="region" tabIndex={0} aria-label="Weekly cohorts">
        <table className="table retention-cohorts">
          <thead><tr><th scope="col">Week of</th><th scope="col">New installs</th><th scope="col">Day 1</th><th scope="col">Day 7</th><th scope="col">Day 30</th></tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={row.weekStart}>
              <th scope="row">{new Date(`${row.weekStart}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</th>
              <td>{row.users.toLocaleString("en-US")}</td>
              {row.users === 0 ? <><td className="retention-na">—</td><td className="retention-na">—</td><td className="retention-na">—</td></> : <>{cell(row.d1)}{cell(row.d7)}{cell(row.d30)}</>}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

function Friction({ report }: { report: RetentionSummary }) {
  return (
    <section className="website-analytics-card" aria-labelledby="retention-friction">
      <h2 id="retention-friction">Top friction among people who left</h2>
      {report.friction.length === 0 ? <p className="lede">No friction recorded in the last 90 days.</p> : (
        <div className="table-scroll" role="region" tabIndex={0} aria-label="Friction ranked by churned people">
          <table className="table retention-friction">
            <thead><tr><th scope="col">Friction</th><th scope="col">Churned who hit it</th><th scope="col">Everyone who hit it</th><th scope="col">Churn rate</th><th scope="col">Most common codes</th></tr></thead>
            <tbody>{report.friction.map((row) => (
              <tr key={row.name}>
                <th scope="row">{label(EVENT_LABELS, row.name)}</th>
                <td>{row.churned.toLocaleString("en-US")} <small className="retention-muted">{percent(row.churned, report.totals.churned)} of churned</small></td>
                <td>{row.users.toLocaleString("en-US")}</td>
                <td>{percent(row.churned, row.users)}</td>
                <td>{row.topCodes.length === 0 ? <span className="retention-muted">—</span> : row.topCodes.map((code) => <code key={code.code} className="retention-code">{code.code} · {code.churned}</code>)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Churned({ silentDays, reason, onReason, onOpen }: { silentDays: number; reason: string | null; onReason: (reason: string | null) => void; onOpen: (uid: string) => void }) {
  const { token } = useAuth();
  const [offset, setOffset] = useState(0);
  const [list, setList] = useState<RetentionChurned | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setOffset(0); }, [silentDays, reason]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const query = new URLSearchParams({ silentDays: String(silentDays), offset: String(offset), limit: String(PAGE) });
      if (reason !== null) query.set("reason", reason);
      const found = await apiFetch<RetentionChurned>({ path: `/admin/retention/churned?${query.toString()}`, token: await token() });
      if (!live) return;
      if (found.ok) { setList(found.value); setError(null); } else setError(MESSAGES[found.error]);
    })();
    return () => { live = false; };
  }, [silentDays, reason, offset, token]);

  return (
    <section className="website-analytics-card" aria-labelledby="retention-churned">
      <div className="retention-head">
        <h2 id="retention-churned">Churned people{reason !== null ? `: ${label(REASON_LABELS, reason)}` : ""}</h2>
        {reason !== null && <button type="button" className="btn btn-small" onClick={() => onReason(null)}>Show every reason</button>}
      </div>
      {error !== null && <div className="notice" data-tone="error" role="alert">{error}</div>}
      {list === null && error === null && <p className="lede">Loading…</p>}
      {list !== null && (list.users.length === 0 ? <p className="lede">Nobody here - silent for {silentDays}+ days and seen in the last 90.</p> : <>
        <p className="lede">{list.total.toLocaleString("en-US")} people, most recently lost first. Open one for their timeline.</p>
        <div className="table-scroll" role="region" tabIndex={0} aria-label="Churned people">
          <table className="table retention-people">
            <thead><tr><th scope="col">Account</th><th scope="col">Last seen</th><th scope="col">Days active</th><th scope="col">Got as far as</th><th scope="col">Last error</th><th scope="col">Last session</th><th scope="col">Likely reason</th></tr></thead>
            <tbody>{list.users.map((user) => <PersonRow key={user.uid} user={user} onOpen={onOpen} />)}</tbody>
          </table>
        </div>
        <div className="retention-pager">
          <button type="button" className="btn btn-small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Newer</button>
          <span>{offset + 1}–{Math.min(offset + PAGE, list.total)} of {list.total.toLocaleString("en-US")}</span>
          <button type="button" className="btn btn-small" disabled={offset + PAGE >= list.total} onClick={() => setOffset(offset + PAGE)}>Older</button>
        </div>
      </>)}
    </section>
  );
}

function PersonRow({ user, onOpen }: { user: RetentionUser; onOpen: (uid: string) => void }) {
  return (
    <tr>
      <td><button type="button" className="install-link-button retention-uid" onClick={() => onOpen(user.uid)}>{user.uid}</button>{user.version !== null && <small className="retention-muted"> v{user.version}</small>}</td>
      <td>{day(user.lastSeenAt)}</td>
      <td>{user.activeDays}</td>
      <td>{user.furthestStep === null ? <span className="retention-muted">—</span> : label(STEP_LABELS, user.furthestStep)}</td>
      <td>{user.lastError === null ? <span className="retention-muted">none</span> : <>{label(EVENT_LABELS, user.lastError.name)}{user.lastError.code !== null && <code className="retention-code">{user.lastError.code}</code>}</>}</td>
      <td>{user.lastSession === null ? <span className="retention-muted">—</span> : `${label(SESSION_END_LABELS, user.lastSession.code ?? "")}${user.lastSession.ms === null ? "" : `, ${duration(user.lastSession.ms)}`}`}</td>
      <td>{label(REASON_LABELS, user.reason)}</td>
    </tr>
  );
}

function Timeline({ uid, onClose }: { uid: string; onClose: () => void }) {
  const { token } = useAuth();
  const [timeline, setTimeline] = useState<RetentionTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    let live = true;
    setTimeline(null);
    panel.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    void (async () => {
      const found = await apiFetch<RetentionTimeline>({ path: `/admin/retention/user?uid=${encodeURIComponent(uid)}`, token: await token() });
      if (!live) return;
      if (found.ok) { setTimeline(found.value); setError(null); } else setError(MESSAGES[found.error]);
    })();
    return () => { live = false; };
  }, [uid, token]);
  const user = timeline?.user ?? null;
  return (
    <section ref={panel} className="website-analytics-card retention-timeline" aria-labelledby="retention-timeline">
      <div className="retention-head">
        <h2 id="retention-timeline">Timeline · <code>{uid}</code></h2>
        <div className="retention-head-actions">
          <Link className="btn btn-small" href={`/admin/people?q=${encodeURIComponent(uid)}`}>Open account</Link>
          <button type="button" className="btn btn-small" onClick={onClose}>Close</button>
        </div>
      </div>
      {error !== null && <div className="notice" data-tone="error" role="alert">{error === MESSAGES["not-found"] ? "No retention events for this account." : error}</div>}
      {timeline === null && error === null && <p className="lede">Loading…</p>}
      {user !== null && <>
        <dl className="retention-facts">
          <div><dt>First seen</dt><dd>{when(user.firstSeenAt)}{user.newInstall ? " (new install)" : " (installed before 2.6.3)"}</dd></div>
          <div><dt>Last seen</dt><dd>{when(user.lastSeenAt)}</dd></div>
          <div><dt>Days active</dt><dd>{user.activeDays}</dd></div>
          <div><dt>Got as far as</dt><dd>{user.furthestStep === null ? "—" : label(STEP_LABELS, user.furthestStep)}</dd></div>
          <div><dt>Likely reason</dt><dd>{label(REASON_LABELS, user.reason)}</dd></div>
          <div><dt>Version</dt><dd>{user.version ?? "—"}</dd></div>
        </dl>
        <h3>Events, newest first</h3>
        <ol className="retention-events">
          {timeline!.events.map((event, index) => (
            <li key={`${event.at}-${index}`} data-kind={event.name}>
              <time dateTime={new Date(event.at).toISOString()}>{when(event.at)}</time>
              <span>{label(EVENT_LABELS, event.name)}</span>
              {event.code !== null && <code className="retention-code">{event.name === "session_end" ? label(SESSION_END_LABELS, event.code) : event.code}</code>}
              {event.ms !== null && <small className="retention-muted">{duration(event.ms)}</small>}
            </li>
          ))}
        </ol>
        {timeline!.events.length === 0 && <p className="lede">Raw events are kept for 90 days; this account&apos;s are older. The summary above still stands.</p>}
      </>}
    </section>
  );
}

export default function RetentionPage() {
  return <Suspense fallback={null}><RetentionBody /></Suspense>;
}
