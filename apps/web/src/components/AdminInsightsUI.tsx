"use client";

/**
 * The small pieces Admin > Analytics and the Models data share: a range picker, figures with
 * their comparison, skeletons shaped like what is coming, a problem line with Retry, and
 * export buttons that fetch a file the server built.
 *
 * Skeletons hold the same height as the content they stand in for, so nothing below them jumps
 * when the numbers arrive.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";
import { RANGE_PRESETS, downloadInsightsExport, insightsFailure, type RangePreset } from "@/lib/adminInsights";
import { useCachedResource, type CachedResource } from "@/lib/adminCache";

export interface InsightFailure { kind: "migration" | "range" | "auth" | "server" | "offline"; message: string }

/**
 * An admin insights read: the last copy this browser saw shows at once with its age, a fresh
 * one replaces it, a changed `path` cancels the request in flight, and a failure says why.
 */
export function useInsightResource<T>(path: string | null): CachedResource<T> & { failure: InsightFailure | null } {
  const { token } = useAuth();
  const [failure, setFailure] = useState<InsightFailure | null>(null);
  const load = useCallback(async (signal: AbortSignal): Promise<T | null> => {
    if (path === null) return null;
    const idToken = await token();
    if (idToken === null) { setFailure({ kind: "auth", message: "Sign in again as an administrator." }); return null; }
    let response: Response;
    try {
      response = await fetch(`/v1${path}`, { headers: { authorization: `Bearer ${idToken}` }, signal });
    } catch {
      if (!signal.aborted) setFailure({ kind: "offline", message: "Could not reach the server. Check the connection and retry." });
      return null;
    }
    if (signal.aborted) return null;
    if (!response.ok) { setFailure(await insightsFailure(response)); return null; }
    setFailure(null);
    return await response.json() as T;
  }, [path, token]);
  const resource = useCachedResource<T>(path === null ? "insights:none" : `insights:${path}`, load);
  useEffect(() => { setFailure(null); }, [path]);
  return { ...resource, failure: resource.failed ? failure : null };
}
import "./adminConsole.css";
import "./adminInsights.css";

export function RangeSelect({ value, onChange, label = "Range", id }: { value: RangePreset; onChange: (next: RangePreset) => void; label?: string; id?: string }) {
  return (
    <label className="insight-field">
      <span>{label}</span>
      <select id={id} className="select" value={value} onChange={(event) => onChange(event.target.value as RangePreset)}>
        {RANGE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
      </select>
    </label>
  );
}

/** One figure: the number, what it is, and how it moved against the window before. */
export function InsightStat({ label, value, note, delta, tone }: { label: string; value: ReactNode; note?: ReactNode; delta?: string | null; tone?: "good" | "bad" | null }) {
  return (
    <div className="insight-stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {(delta !== undefined && delta !== null) || note !== undefined ? (
        <p>{delta !== undefined && delta !== null && <span className="insight-delta" data-tone={tone ?? undefined}>{delta}</span>}{note}</p>
      ) : null}
    </div>
  );
}

export function StatSkeleton({ count = 4 }: { count?: number }) {
  return (
    <dl className="insight-stats" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="insight-stat adm-skel" style={{ animationDelay: `${index * 60}ms` }}>
          <span className="adm-skel-bar" style={{ width: "46%" }} />
          <span className="adm-skel-bar adm-skel-big" style={{ width: "62%" }} />
          <span className="adm-skel-bar adm-skel-thin" style={{ width: "38%" }} />
        </div>
      ))}
    </dl>
  );
}

export function ChartSkeleton({ height = 220 }: { height?: number }) {
  return <div className="insight-chart-skeleton adm-skel" style={{ height }} aria-hidden="true"><span className="adm-skel-bar" style={{ width: "30%" }} /></div>;
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="insight-table-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="adm-skel insight-table-skeleton-row" style={{ gridTemplateColumns: `2fr repeat(${columns - 1}, 1fr)`, animationDelay: `${row * 50}ms` }}>
          {Array.from({ length: columns }, (_, column) => <span key={column} className="adm-skel-bar" style={{ width: column === 0 ? `${55 + ((row * 13) % 30)}%` : "60%" }} />)}
        </div>
      ))}
    </div>
  );
}

/** Loading, announced once for the whole block. */
export function Loading({ label, children }: { label: string; children: ReactNode }) {
  return <div role="status" aria-live="polite" aria-busy="true"><span className="sr-only">{label}</span>{children}</div>;
}

/**
 * Why a block has no figures, and what to do. `migration` is the honest empty state for tables
 * that are not in the database yet: no numbers, and what will fill them.
 */
export function InsightProblem({ kind, message, onRetry, fills }: { kind: "migration" | "range" | "auth" | "server" | "offline"; message: string; onRetry?: () => void; fills?: string }) {
  if (kind === "migration") {
    return (
      <div className="insight-empty" role="status">
        <strong>No data yet</strong>
        <p>{fills ?? "These figures come from summary tables that are not in the database yet."}</p>
        <p className="insight-muted">{message}</p>
        {onRetry !== undefined && <button type="button" className="btn btn-small" onClick={onRetry}>Check again</button>}
      </div>
    );
  }
  return (
    <div className="notice insight-problem" data-tone="error" role="alert">
      <span>{message}</span>
      {onRetry !== undefined && <button type="button" className="btn btn-small" onClick={onRetry}>Retry</button>}
    </div>
  );
}

/** "No data yet" for a range with nothing in it, saying what will fill it. */
export function InsightEmpty({ title = "No data yet", children }: { title?: string; children: ReactNode }) {
  return <div className="insight-empty" role="status"><strong>{title}</strong><p>{children}</p></div>;
}

/**
 * CSV and JSON buttons for one export. The file is built on the server; the button shows
 * "Preparing…" with a way to cancel, and a failure says why.
 */
export function ExportButtons({ query, label = "Export", formats = ["csv", "json"], disabled = false }: { query: string; label?: string; formats?: readonly ("csv" | "json")[]; disabled?: boolean }) {
  const { token } = useAuth();
  const [busy, setBusy] = useState<"csv" | "json" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  // A changed view means the file being prepared is no longer the one on screen.
  useEffect(() => { controller.current?.abort(); setNote(null); }, [query]);

  const run = async (format: "csv" | "json"): Promise<void> => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(format); setNote(null);
    const result = await downloadInsightsExport(`${query}&format=${format}`, await token(), current.signal);
    if (controller.current !== current) return;
    setBusy(null);
    setNote(result.ok ? null : result.message);
  };

  return (
    <div className="insight-export" role="group" aria-label={label}>
      {busy !== null ? (
        <>
          <span className="insight-muted" role="status">Preparing {busy.toUpperCase()}…</span>
          <button type="button" className="btn btn-small" onClick={() => { controller.current?.abort(); setBusy(null); }}>Cancel</button>
        </>
      ) : formats.map((format) => (
        <button key={format} type="button" className="btn btn-small" disabled={disabled} onClick={() => void run(format)}>
          {formats.length === 1 ? label : `${label} ${format.toUpperCase()}`}
        </button>
      ))}
      {note !== null && <span className="insight-export-note" role="alert">{note}</span>}
    </div>
  );
}
