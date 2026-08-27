"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES } from "@/lib/api";
import { when } from "@/components/money";

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
  // Open first, because the queue is the reason to be here. A pasted id widens it, or the
  // row somebody followed a link to would be hidden by a filter they did not choose.
  const [filter, setFilter] = useState<Filter>(initialQuery === "" ? "open" : "all");
  const [query, setQuery] = useState(initialQuery);

  const load = useCallback(async () => {
    const found = await apiFetch<{ rows: ReportRow[] }>({
      path: "/admin/reports?limit=100",
      token: await token(),
    });
    if (found.ok) setRows(found.value.rows);
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

  return (
    <>
      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}

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
        shown.map((report) => (
          <div className="card admin-card" key={report.reportId} style={{ marginBottom: 12 }}>
            <div className="admin-card-head">
              <div style={{ minWidth: 0 }}>
                <h3>{report.title}</h3>
                <p className="row-sub">
                  {KIND_LABEL[report.kind] ?? report.kind} · {when(report.createdAt)} · v
                  {report.appVersion} · {report.platform} ·{" "}
                  <span className="mono" style={{ fontSize: 12 }}>
                    {report.uid}
                  </span>
                </p>
              </div>
              <span className="pill" data-tone={STATUS_TONE[report.status] ?? "neutral"}>
                {STATUS_LABEL[report.status] ?? report.status}
              </span>
            </div>

            {/* Whitespace preserved: people paste stack traces and steps into this box. */}
            <p style={{ whiteSpace: "pre-wrap", color: "var(--text)" }}>{report.body}</p>

            <div className="actions">
              {report.status !== "triaged" && (
                <button
                  className="btn btn-outline btn-small"
                  disabled={busy === report.reportId}
                  onClick={() => void setStatus(report.reportId, "triaged")}
                >
                  Mark in progress
                </button>
              )}
              {report.status !== "closed" ? (
                <button
                  className="btn btn-primary btn-small"
                  disabled={busy === report.reportId}
                  onClick={() => void setStatus(report.reportId, "closed")}
                >
                  Mark done
                </button>
              ) : (
                <button
                  className="btn btn-outline btn-small"
                  disabled={busy === report.reportId}
                  onClick={() => void setStatus(report.reportId, "open")}
                >
                  Reopen
                </button>
              )}

              {/* Two presses, because this one cannot be undone. Not a browser confirm():
                  that blocks the page and is the dialog people dismiss by reflex. */}
              {confirming === report.reportId ? (
                <>
                  <button
                    className="btn btn-danger btn-small"
                    disabled={busy === report.reportId}
                    onClick={() => void remove(report.reportId)}
                  >
                    Delete for good
                  </button>
                  <button className="btn btn-outline btn-small" onClick={() => setConfirming(null)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-outline btn-small"
                  onClick={() => setConfirming(report.reportId)}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </>
  );
}
