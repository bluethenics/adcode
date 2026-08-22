"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES } from "@/lib/api";
import { when } from "@/components/money";
import { ADMIN_TABS } from "../tabs";

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

export default function AdminReports() {
  return (
    <AppShell title="Admin" tabs={ADMIN_TABS} requireAdmin>
      <ReportsBody />
    </AppShell>
  );
}

function ReportsBody() {
  const { token } = useAuth();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

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

  if (loading) return <p className="lede">Loading…</p>;

  const shown = filter === "all" ? rows : rows.filter((r) => r.kind === filter);

  return (
    <>
      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}

      <div className="actions" style={{ marginTop: 0, marginBottom: 18 }}>
        {["all", "bug", "feature", "help", "other"].map((kind) => (
          <button
            key={kind}
            className={`btn btn-small ${filter === kind ? "btn-primary" : "btn-outline"}`}
            onClick={() => setFilter(kind)}
          >
            {kind === "all" ? "All" : KIND_LABEL[kind]}
            {kind !== "all" && ` (${rows.filter((r) => r.kind === kind).length})`}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <h3>Nothing filed</h3>
          <p>
            Reports sent from the feedback button in the editor appear here, newest first.
          </p>
        </div>
      ) : (
        shown.map((report) => (
          <div className="card" key={report.reportId} style={{ marginBottom: 12 }}>
            <h3>{report.title}</h3>
            <p className="row-sub" style={{ marginBottom: 12 }}>
              <span className="pill">{KIND_LABEL[report.kind] ?? report.kind}</span>{" "}
              {when(report.createdAt)} · v{report.appVersion} · {report.platform} ·{" "}
              <span className="mono" style={{ fontSize: 12 }}>
                {report.uid}
              </span>
            </p>
            {/* Whitespace preserved: people paste stack traces and steps into this box. */}
            <p style={{ whiteSpace: "pre-wrap", color: "var(--text)" }}>{report.body}</p>
          </div>
        ))
      )}
    </>
  );
}
