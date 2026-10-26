"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES } from "@/lib/api";
import { dollarsToMicros, moneyExact, when } from "@/components/money";
import { AdminSummary } from "@/components/AdminUI";

/** Long enough to bury the next report: a pasted stack trace, a log. Shown clamped until asked. */
const LONG_REPORT = 480;

/**
 * Bugs, requests and questions filed from inside the editor.
 *
 * It was a list with no state, which meant it was re-read from the top every visit and
 * nothing was ever finished. Three things fixed that: a status you can set, a filter that
 * hides what is done, and a delete for the duplicates and the pasted spam.
 *
 * Delete really deletes - the one record in this system that is removed rather than
 * superseded. A ledger entry is evidence about money and has to outlive its author; a
 * duplicate bug report is noise in a queue somebody has to read. The audit row survives
 * either way, so the deletion itself stays on the record.
 */
interface ReportRow {
  reportId: string;
  uid: string;
  kind: string;
  title: string;
  body: string;
  appVersion: string;
  platform: string;
  status: string;
  createdAt: number;
}

const KIND_LABEL: Record<string, string> = {
  bug: "Bug",
  feature: "Feature request",
  help: "Help",
  other: "Other",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  triaged: "In progress",
  closed: "Done",
};

const STATUS_TONE: Record<string, string> = {
  open: "pending",
  triaged: "paused",
  closed: "live",
};

type Filter = "open" | "all" | "bug" | "feature" | "help" | "other";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "bug", label: "Bugs" },
  { id: "feature", label: "Requests" },
  { id: "help", label: "Help" },
  { id: "other", label: "Other" },
  { id: "all", label: "All" },
];

export function ReportsBody({ initialQuery = "" }: { initialQuery?: string }) {
  const { token } = useAuth();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  // Thank-you awards: which report has the picker open, what was given, and a custom amount.
  const [awarding, setAwarding] = useState<string | null>(null);
  const [awarded, setAwarded] = useState<Record<string, string>>({});
  const [customAward, setCustomAward] = useState("");
  // Replies by email: which report has the box open, its draft, and when each report was answered.
  const [replying, setReplying] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [repliedAt, setRepliedAt] = useState<Record<string, number>>({});
  // Open first, because the queue is the reason to be here. A pasted id widens it, or the
  // row somebody followed a link to would be hidden by a filter they did not choose.
  const [filter, setFilter] = useState<Filter>(initialQuery === "" ? "open" : "all");
  const [query, setQuery] = useState(initialQuery);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const found = await apiFetch<{ rows: ReportRow[]; repliedAt?: Record<string, number> }>({
      path: "/admin/reports?limit=100",
      token: await token(),
    });
    if (found.ok) { setRows(found.value.rows); setRepliedAt(found.value.repliedAt ?? {}); }
    else setError(MESSAGES[found.error]);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (reportId: string, status: string): Promise<void> => {
    setBusy(reportId);
    const result = await apiFetch<{ ok: boolean }>({
      path: `/admin/reports/${encodeURIComponent(reportId)}/status`,
      token: await token(),
      method: "POST",
      body: { status },
    });
    setBusy(null);

    if (!result.ok) {
      setError(MESSAGES[result.error]);
      return;
    }
    // Locally, rather than reloading: the list is long and the row you just acted on
    // should not jump because a hundred others were re-fetched around it.
    setRows((current) => current.map((r) => (r.reportId === reportId ? { ...r, status } : r)));
  };

  /*
   * Thank the person who filed it, into their ADCode balance - once per report, and the
   * report is closed by it. Money moves, so the amount is chosen, never defaulted.
   */
  const award = async (reportId: string, micros: string | null): Promise<void> => {
    if (micros === null) {
      setError("Enter an amount like 2.50 - at most $100.");
      return;
    }
    setBusy(reportId);
    const result = await apiFetch<{ ok: true; micros: string }>({
      path: `/admin/reports/${encodeURIComponent(reportId)}/award`,
      token: await token(),
      method: "POST",
      body: { micros },
    });
    setBusy(null);
    setAwarding(null);
    setCustomAward("");
    if (!result.ok) {
      setError(result.error === "invalid-state" ? "That report has already been thanked." : MESSAGES[result.error]);
      return;
    }
    setAwarded((current) => ({ ...current, [reportId]: result.value.micros }));
    setRows((current) => current.map((r) => (r.reportId === reportId ? { ...r, status: "closed" } : r)));
  };

  /*
   * Answer the person by email, at their account's address (the server chooses it, never this
   * page). Sending moves the report to in progress, or to done with the second button.
   */
  const reply = async (reportId: string, close: boolean): Promise<void> => {
    const message = replyText.trim();
    if (message.length === 0) return;
    setBusy(reportId);
    const result = await apiFetch<{ ok: true; status: string; repliedAt: number }>({
      path: `/admin/reports/${encodeURIComponent(reportId)}/reply`,
      token: await token(),
      method: "POST",
      body: { message, close },
    });
    setBusy(null);
    if (!result.ok) {
      setError(
        result.error === "invalid-state"
          ? "No reply can go to this person: the account has no email address, or the address bounced or marked ADCode as spam."
          : result.error === "provider-unavailable"
            ? "The email service refused the reply or is not set up. Nothing was sent."
            : MESSAGES[result.error],
      );
      return;
    }
    setReplying(null);
    setReplyText("");
    setRepliedAt((current) => ({ ...current, [reportId]: result.value.repliedAt }));
    setRows((current) => current.map((r) => (r.reportId === reportId ? { ...r, status: result.value.status } : r)));
  };

  const remove = async (reportId: string): Promise<void> => {
    setBusy(reportId);
    const result = await apiFetch<{ ok: boolean }>({
      path: `/admin/reports/${encodeURIComponent(reportId)}/delete`,
      token: await token(),
      method: "POST",
      body: {},
    });
    setBusy(null);
    setConfirming(null);

    if (!result.ok) {
      setError(MESSAGES[result.error]);
      return;
    }
    setRows((current) => current.filter((r) => r.reportId !== reportId));
  };

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (filter === "all") return true;
        if (filter === "open") return r.status !== "closed";
        return r.kind === filter;
      })
      .filter(
        (r) =>
          needle === "" ||
          [r.reportId, r.uid, r.title, r.body].some((field) =>
            field.toLowerCase().includes(needle),
          ),
      );
  }, [rows, filter, query]);

  if (loading) return <div className="skeleton skeleton-card" />;

  const openCount = rows.filter((r) => r.status !== "closed").length;
  const inProgress = rows.filter((r) => r.status === "triaged").length;
  const openBugs = rows.filter((r) => r.status !== "closed" && r.kind === "bug").length;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const thisWeek = rows.filter((r) => r.createdAt >= weekAgo).length;

  return (
    <>
      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}

      <AdminSummary items={[
        { label: "Open", value: openCount, hint: "Not marked done", ...(openCount > 0 ? { tone: "warn" as const } : {}) },
        { label: "In progress", value: inProgress, hint: "Being looked at" },
        { label: "Open bugs", value: openBugs, hint: "Of the open ones" },
        { label: "New this week", value: thisWeek, hint: `Of the ${rows.length} most recent` },
      ]} />

      <div className="admin-toolbar">
        <div className="admin-filters" role="group" aria-label="Filter feedback">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              className={`btn btn-small ${filter === option.id ? "btn-primary" : "btn-outline"}`}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
              {option.id === "open" && openCount > 0 && ` (${openCount})`}
            </button>
          ))}
        </div>

        <input
          className="input admin-toolbar-search"
          type="search"
          value={query}
          placeholder="Filter by text, uid or id"
          aria-label="Filter feedback"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <h3>{filter === "open" ? "Queue is clear" : "Nothing here"}</h3>
          <p>Reports sent from the feedback button in the editor appear here, newest first.</p>
        </div>
      ) : (
        <div className="adm-stack-list">
        {shown.map((report) => {
          const busyHere = busy === report.reportId;
          const long = report.body.length > LONG_REPORT || report.body.split("\n").length > 8;
          const open = expanded[report.reportId] === true;
          return (
          <article className="card admin-card" key={report.reportId}>
            <div className="admin-card-head">
              <div>
                <h3>{report.title}</h3>
                <p className="adm-meta">
                  <span>{KIND_LABEL[report.kind] ?? report.kind}</span>
                  <span>{when(report.createdAt)}</span>
                  <span>v{report.appVersion} · {report.platform}</span>
                  <span className="mono" title="Account id">{report.uid}</span>
                </p>
              </div>
              <span className="adm-chips">
                {repliedAt[report.reportId] !== undefined && (
                  <span className="pill" data-tone="live" title="The person was answered by email">Replied {when(repliedAt[report.reportId] ?? 0)}</span>
                )}
                <span className="pill" data-tone={STATUS_TONE[report.status] ?? "neutral"}>
                  {STATUS_LABEL[report.status] ?? report.status}
                </span>
              </span>
            </div>

            {/* Whitespace preserved: people paste stack traces and steps into this box. */}
            <p className={long && !open ? "adm-report-body adm-clamp" : "adm-report-body"}>{report.body}</p>
            {long && (
              <button type="button" className="adm-clamp-toggle" onClick={() => setExpanded((current) => ({ ...current, [report.reportId]: !open }))}>
                {open ? "Show less" : "Show all"}
              </button>
            )}

            {replying === report.reportId && (
              <div className="adm-reply">
                <label className="field-hint" htmlFor={`reply-${report.reportId}`}>
                  Reply by email - it goes to the account&apos;s own address, from adcode@bluethenics.com, and their answer comes back to the team inbox.
                </label>
                <textarea
                  id={`reply-${report.reportId}`}
                  className="input"
                  rows={5}
                  maxLength={5000}
                  value={replyText}
                  placeholder="What was wrong, what changed, and what they can do now."
                  onChange={(event) => setReplyText(event.target.value)}
                />
                <div className="actions">
                  <button className="btn btn-primary btn-small" disabled={busyHere || replyText.trim() === ""} onClick={() => void reply(report.reportId, true)}>
                    Send and mark done
                  </button>
                  <button className="btn btn-outline btn-small" disabled={busyHere || replyText.trim() === ""} onClick={() => void reply(report.reportId, false)}>
                    Send
                  </button>
                  <button className="btn btn-outline btn-small" onClick={() => { setReplying(null); setReplyText(""); }}>Cancel</button>
                </div>
              </div>
            )}

            <div className="adm-actions">
              {report.status !== "closed" ? (
                <button className="btn btn-primary btn-small" disabled={busyHere} onClick={() => void setStatus(report.reportId, "closed")}>
                  Mark done
                </button>
              ) : (
                <button className="btn btn-outline btn-small" disabled={busyHere} onClick={() => void setStatus(report.reportId, "open")}>
                  Reopen
                </button>
              )}
              {replying !== report.reportId && (
                <button className="btn btn-outline btn-small" onClick={() => { setReplying(report.reportId); setReplyText(""); }}>
                  Reply by email
                </button>
              )}
              {report.status === "open" && (
                <button className="btn btn-outline btn-small" disabled={busyHere} onClick={() => void setStatus(report.reportId, "triaged")}>
                  Mark in progress
                </button>
              )}

              <span className="adm-actions-end">
                {awarded[report.reportId] !== undefined ? (
                  <span className="pill" data-tone="live">Thanked {moneyExact(awarded[report.reportId] ?? "0")}</span>
                ) : awarding === report.reportId ? (
                  <>
                    {[["$0.50", "500000"], ["$1", "1000000"], ["$5", "5000000"]].map(([label, micros]) => (
                      <button key={label} className="btn btn-outline btn-small" disabled={busyHere} onClick={() => void award(report.reportId, micros ?? null)}>
                        {label}
                      </button>
                    ))}
                    <input
                      className="input adm-award-input"
                      aria-label="Custom award in dollars"
                      placeholder="$ other"
                      value={customAward}
                      onChange={(event) => setCustomAward(event.target.value)}
                    />
                    <button className="btn btn-primary btn-small" disabled={busyHere || customAward.trim() === ""} onClick={() => void award(report.reportId, dollarsToMicros(customAward))}>
                      Thank
                    </button>
                    <button className="btn btn-outline btn-small" onClick={() => setAwarding(null)}>Cancel</button>
                  </>
                ) : (
                  <button className="btn btn-outline btn-small" onClick={() => setAwarding(report.reportId)}>
                    Thank with an award
                  </button>
                )}

                {/* Two presses, because this one cannot be undone. Not a browser confirm():
                    that blocks the page and is the dialog people dismiss by reflex. */}
                {confirming === report.reportId ? (
                  <>
                    <button className="btn btn-danger btn-small" disabled={busyHere} onClick={() => void remove(report.reportId)}>
                      Delete for good
                    </button>
                    <button className="btn btn-outline btn-small" onClick={() => setConfirming(null)}>
                      Keep it
                    </button>
                  </>
                ) : (
                  <button className="btn btn-outline btn-small adm-quiet-danger" onClick={() => setConfirming(report.reportId)}>
                    Delete
                  </button>
                )}
              </span>
            </div>
          </article>
          );
        })}
        </div>
      )}
    </>
  );
}
