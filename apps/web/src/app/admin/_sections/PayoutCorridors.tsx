"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { when } from "@/components/money";
import { apiFetch, MESSAGES, type AdminPayoutCorridorView } from "@/lib/api";

const FIELD_KINDS = [
  "iban", "bic", "accountNumber", "routingNumber", "sortCode", "ifsc", "bsb",
  "bankCode", "branchCode", "clabe", "bankName", "address", "email", "phone",
  "supplemental",
] as const;

export function PayoutCorridors() {
  const { token } = useAuth();
  const [rows, setRows] = useState<AdminPayoutCorridorView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [country, setCountry] = useState("");
  const [currency, setCurrency] = useState("");

  const load = useCallback(async () => {
    const result = await apiFetch<{ corridors: AdminPayoutCorridorView[] }>({
      path: "/admin/payout-corridors",
      token: await token(),
    });
    if (result.ok) setRows(result.value.corridors);
    else setError(MESSAGES[result.error]);
    setLoading(false);
  }, [token]);

  useEffect(() => void load(), [load]);

  const addDraft = () => {
    const normalizedCountry = country.trim().toUpperCase();
    const normalizedCurrency = currency.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(normalizedCountry) || !/^[A-Z]{3}$/.test(normalizedCurrency)) {
      setError("Use a two-letter country code and a three-letter currency code.");
      return;
    }
    if (rows.some((row) => row.country === normalizedCountry && row.currency === normalizedCurrency)) {
      setError("That payout route already exists.");
      return;
    }
    setRows((current) => [{
      country: normalizedCountry,
      currency: normalizedCurrency,
      enabled: false,
      requiredFields: ["accountNumber", "bankName"],
      sourceNote: "Verify this exact recipient route in Wise before enabling.",
      verifiedAt: null,
      updatedAt: 0,
      updatedBy: "draft",
    }, ...current]);
    setCountry("");
    setCurrency("");
    setError(null);
  };

  if (loading) return <div className="skeleton skeleton-card" />;

  return <>
    {error !== null && <div className="notice" data-tone="error" role="alert">{error}</div>}
    <div className="notice" data-tone="warning">
      Enable a route only after your India-based Wise account accepts a real recipient for
      that country and currency. Availability can change; this switch is an operational
      verification record, not a guarantee from Wise.
    </div>

    <div className="card" style={{ marginBottom: 14 }}>
      <h3>Add a country and currency route</h3>
      <div className="payout-pair">
        <div className="field"><label htmlFor="new-country">Country code</label><input id="new-country" className="input" maxLength={2} placeholder="GB" value={country} onChange={(event) => setCountry(event.target.value)} /></div>
        <div className="field"><label htmlFor="new-currency">Currency code</label><input id="new-currency" className="input" maxLength={3} placeholder="GBP" value={currency} onChange={(event) => setCurrency(event.target.value)} /></div>
      </div>
      <button className="btn btn-outline btn-small" onClick={addDraft}>Add route draft</button>
    </div>

    {rows.map((row) => <CorridorEditor key={`${row.country}:${row.currency}`} initial={row} onSaved={load} onError={setError} />)}
  </>;
}

function CorridorEditor({ initial, onSaved, onError }: {
  initial: AdminPayoutCorridorView;
  onSaved: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const { token } = useAuth();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [requiredFields, setRequiredFields] = useState(initial.requiredFields);
  const [sourceNote, setSourceNote] = useState(initial.sourceNote);
  const [busy, setBusy] = useState(false);

  const toggleField = (field: string) => setRequiredFields((current) =>
    current.includes(field) ? current.filter((value) => value !== field) : [...current, field],
  );

  const save = async () => {
    setBusy(true);
    const result = await apiFetch<AdminPayoutCorridorView>({
      path: `/admin/payout-corridors/${initial.country}/${initial.currency}`,
      token: await token(),
      method: "POST",
      body: { enabled, requiredFields, sourceNote },
    });
    setBusy(false);
    if (!result.ok) { onError(MESSAGES[result.error]); return; }
    onError(null);
    await onSaved();
  };

  return <div className="card admin-card" style={{ marginBottom: 12 }}>
    <div className="admin-card-head">
      <div><h3>{initial.country} → {initial.currency}</h3><p className="row-sub">{initial.verifiedAt === null ? "Not verified" : `Last enabled ${when(initial.verifiedAt)}`}</p></div>
      <span className="pill" data-tone={enabled ? "live" : "ended"}>{enabled ? "Enabled" : "Disabled"}</span>
    </div>
    <div className="field">
      <label>Details the recipient must provide</label>
      <div className="admin-filters">
        {FIELD_KINDS.map((field) => <button key={field} type="button" className={`btn btn-small ${requiredFields.includes(field) ? "btn-primary" : "btn-outline"}`} onClick={() => toggleField(field)}>{field}</button>)}
      </div>
    </div>
    <div className="field"><label htmlFor={`note-${initial.country}-${initial.currency}`}>Verification note</label><textarea id={`note-${initial.country}-${initial.currency}`} className="textarea" rows={3} maxLength={500} value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} /></div>
    <label className="check-row"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span><strong>Allow users to choose this route</strong><small>Confirm only after testing the recipient route in Wise.</small></span></label>
    <div className="actions"><button className="btn btn-primary btn-small" disabled={busy || requiredFields.length === 0 || sourceNote.trim().length < 10} onClick={() => void save()}>{busy ? "Saving…" : "Save route"}</button></div>
  </div>;
}
