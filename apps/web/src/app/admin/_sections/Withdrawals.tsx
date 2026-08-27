"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { CopyField } from "@/components/CopyField";
import { money, moneyExact, when } from "@/components/money";
import { countryName } from "@/lib/payoutOptions";
import { apiFetch, MESSAGES, type AdminWithdrawalView } from "@/lib/api";

type Filter = "requested" | "approved" | "paid" | "rejected" | "failed" | "all";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "requested", label: "Needs review" },
  { id: "approved", label: "Ready to send" },
  { id: "paid", label: "Paid" },
  { id: "rejected", label: "Rejected" },
  { id: "failed", label: "Failed" },
  { id: "all", label: "All" },
];

const STATUS_TONE: Record<AdminWithdrawalView["status"], string> = {
  requested: "pending",
  approved: "pending",
  paid: "live",
  rejected: "ended",
  failed: "ended",
  cancelled: "ended",
};

const STATUS_LABEL: Record<AdminWithdrawalView["status"], string> = {
  requested: "Needs review",
  approved: "Approved — send manually",
  paid: "Paid",
  rejected: "Rejected",
  failed: "Transfer failed",
  cancelled: "Cancelled by user",
};

export function Withdrawals({ initialQuery = "" }: { initialQuery?: string }) {
  const { token } = useAuth();
  const [rows, setRows] = useState<AdminWithdrawalView[]>([]);
  const [filter, setFilter] = useState<Filter>("requested");
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const path = filter === "all"
      ? "/admin/withdrawals?limit=100"
      : `/admin/withdrawals?status=${filter}&limit=100`;
    const found = await apiFetch<{ rows: AdminWithdrawalView[] }>({ path, token: await token() });
    if (found.ok) setRows(found.value.rows);
    else setError(MESSAGES[found.error]);
    setLoading(false);
  }, [filter, token]);

  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (initialQuery !== "") setFilter("all");
  }, [initialQuery]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return rows;
    return rows.filter((row) =>
      [row.withdrawalId, row.uid, row.email, row.displayName, row.destination.legalName]
        .filter((field): field is string => typeof field === "string")
        .some((field) => field.toLowerCase().includes(needle)),
    );
  }, [rows, query]);

  const inQueue = rows.filter((row) => row.status === "requested" || row.status === "approved");
  const held = inQueue.reduce((total, row) => total + BigInt(row.amountMicros), 0n);

  return (
    <>
      {error !== null && <div className="notice" data-tone="error" role="alert">{error}</div>}

      <div className="admin-toolbar">
        <div className="admin-filters" role="group" aria-label="Filter by status">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              className={`btn btn-small ${filter === option.id ? "btn-primary" : "btn-outline"}`}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <input
          className="input admin-toolbar-search"
          type="search"
          value={query}
          placeholder="Filter by name, email or id"
          aria-label="Filter withdrawals"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {(filter === "requested" || filter === "approved") && inQueue.length > 0 && (
        <p className="field-hint" style={{ marginBottom: 14 }}>
          {inQueue.length} {inQueue.length === 1 ? "request" : "requests"},{" "}
          <strong className="money">{money(held.toString())}</strong> held.
        </p>
      )}

      {loading ? (
        <div className="skeleton skeleton-card" />
      ) : shown.length === 0 ? (
        <div className="empty">
          <h3>Nothing here</h3>
          <p>No payout requests match this filter.</p>
        </div>
      ) : shown.map((row) => (
        <WithdrawalRow
          key={row.withdrawalId}
          row={row}
          expanded={open === row.withdrawalId}
          onToggle={() => setOpen((current) => current === row.withdrawalId ? null : row.withdrawalId)}
          onDone={() => { setOpen(null); void load(); }}
          onError={setError}
        />
      ))}
    </>
  );
}

function fieldLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function WithdrawalRow({ row, expanded, onToggle, onDone, onError }: {
  row: AdminWithdrawalView;
  expanded: boolean;
  onToggle: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const { token } = useAuth();
  const [providerRef, setProviderRef] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const decide = async (action: "approve" | "paid" | "reject" | "failed", body: unknown = {}) => {
    setBusy(true);
    const result = await apiFetch<unknown>({
      path: `/admin/withdrawals/${encodeURIComponent(row.withdrawalId)}/${action}`,
      token: await token(),
      method: "POST",
      body,
    });
    setBusy(false);
    if (result.ok) onDone();
    else onError(MESSAGES[result.error]);
  };

  const destination = row.destination;
  const detailFields = Object.entries(destination.fields ?? {});
  const block = [
    `Amount: ${moneyExact(row.amountMicros)} USD`,
    `Recipient currency: ${destination.currency}`,
    `Legal name: ${destination.legalName}`,
    `Country: ${countryName(destination.country)} (${destination.country})`,
    ...detailFields.map(([key, value]) => `${fieldLabel(key)}: ${value}`),
    `Reference: ${row.withdrawalId}`,
  ].join("\n");

  const canAct = row.status === "requested" || row.status === "approved";

  return (
    <div className="card admin-card" style={{ marginBottom: 12 }}>
      <div className="admin-card-head">
        <div style={{ minWidth: 0 }}>
          <h3 className="money">{money(row.amountMicros)}</h3>
          <p className="row-sub">
            {row.displayName ?? row.email ?? "Anonymous account"}
            {row.email !== null && row.displayName !== null && <> · {row.email}</>} · {when(row.createdAt)}
          </p>
        </div>
        <span className="pill" data-tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</span>
      </div>

      <dl className="admin-facts">
        <div><dt>Method</dt><dd>Bank transfer</dd></div>
        <div><dt>Recipient currency</dt><dd>{destination.currency}</dd></div>
        <div><dt>Country</dt><dd>{countryName(destination.country)}</dd></div>
        <div><dt>Available after hold</dt><dd className="money">{moneyExact(row.availableMicros)}</dd></div>
        <div><dt>Earned all time</dt><dd className="money">{moneyExact(row.lifetimeMicros)}</dd></div>
      </dl>

      {row.status === "paid" && row.providerRef !== null && (
        <p className="field-hint">Sent {row.decidedAt === null ? "" : when(row.decidedAt)} · reference <span className="mono">{row.providerRef}</span></p>
      )}
      {row.note !== null && <p className="field-hint">Outcome note: {row.note}</p>}

      {canAct && (
        <>
          <div className="actions">
            <button className="btn btn-outline btn-small" onClick={onToggle}>
              {expanded ? "Hide details" : row.status === "requested" ? "Review request" : "Transfer details"}
            </button>
          </div>

          {expanded && (
            <div className="admin-payout">
              {row.status === "requested" ? (
                <p className="field-hint">Verify the account, destination corridor, and bank details. Approval does not send money.</p>
              ) : (
                <p className="field-hint">Open Wise and make this bank transfer manually. Return here only after Wise accepts or rejects it.</p>
              )}

              <CopyField label="Legal name" value={destination.legalName} />
              {detailFields.map(([key, value]) => <CopyField key={key} label={fieldLabel(key)} value={value} />)}
              <CopyField label="Amount (USD)" value={moneyExact(row.amountMicros)} />
              <CopyField label="Everything, for one paste" value={block} />

              {row.status === "requested" && (
                <button className="btn btn-primary btn-small" disabled={busy} onClick={() => void decide("approve")}>
                  Approve for manual transfer
                </button>
              )}

              {row.status === "approved" && (
                <div className="admin-decide">
                  <div className="field">
                    <label htmlFor={`ref-${row.withdrawalId}`}>Wise transfer reference</label>
                    <input
                      id={`ref-${row.withdrawalId}`}
                      className="input"
                      value={providerRef}
                      maxLength={120}
                      placeholder="Reference shown after sending"
                      onChange={(event) => setProviderRef(event.target.value)}
                    />
                  </div>
                  <button
                    className="btn btn-primary btn-small"
                    disabled={busy || providerRef.trim() === ""}
                    onClick={() => void decide("paid", { providerRef: providerRef.trim() })}
                  >
                    Mark as paid
                  </button>
                </div>
              )}

              <div className="admin-decide">
                <div className="field">
                  <label htmlFor={`note-${row.withdrawalId}`}>
                    {row.status === "requested" ? "Reject with a reason" : "Transfer failed reason"}
                  </label>
                  <input
                    id={`note-${row.withdrawalId}`}
                    className="input"
                    value={note}
                    maxLength={400}
                    placeholder="The user will see this note"
                    onChange={(event) => setNote(event.target.value)}
                  />
                </div>
                <button
                  className="btn btn-outline btn-small"
                  disabled={busy || note.trim() === ""}
                  onClick={() => void decide(row.status === "requested" ? "reject" : "failed", { note: note.trim() })}
                >
                  {row.status === "requested" ? "Reject and release funds" : "Mark failed and release funds"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
