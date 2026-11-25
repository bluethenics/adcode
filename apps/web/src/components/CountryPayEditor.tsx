"use client";

import { useId, useState } from "react";
import { COUNTRY_CODES } from "@adcode/api/src/regions.ts";
import { countryName, DEFAULT_SHARES, dollarsToMicros, formatUsd, importCountryPay, marginOf, toDraft, type CountryPayDraft, type Margin, type Tier } from "../lib/countryCardPay";

const SHARE_FIELDS: readonly (readonly [Tier, string])[] = [["green", "Green: pay share (%)"], ["plain", "Unmarked: pay share (%)"], ["red", "Red: pay share (%)"]];

/*
 * Admin > Ad networks > Zeekend > User pay: what a card pays in each country (2026-11-24).
 *
 * Each row shows what a card earns ADCode there, what it pays the viewer, and the margin left -
 * the margin only ever on this admin page. A row that would pay more than it earns is marked as a
 * loss and cannot be saved (the server refuses it too). A sheet pastes in through Import.
 */
const marginLabel = (margin: Margin): string => margin.state === "unknown" ? "No earnings figure" : `${formatUsd(margin.marginMicros!)} · ${Math.round(margin.share! * 100)}%`;
const marginWord: Record<Margin["state"], string> = { loss: "Loss", thin: "Thin", ok: "", unknown: "" };

export function draftMargin(draft: Pick<CountryPayDraft, "pay" | "earn">): Margin {
  const pay = dollarsToMicros(draft.pay) ?? 0;
  return marginOf(pay, draft.earn.trim() === "" ? null : dollarsToMicros(draft.earn));
}

export function CountryPayEditor({ rows, onChange, defaultPay, defaultCap, defaultEarn, onDefaultEarn }: {
  rows: CountryPayDraft[];
  onChange: (rows: CountryPayDraft[]) => void;
  defaultPay: string;
  defaultCap: string;
  defaultEarn: string;
  onDefaultEarn: (value: string) => void;
}) {
  const [adding, setAdding] = useState("");
  const [paste, setPaste] = useState("");
  const percentOf = (share: number | null): string => share === null ? "" : String(Math.round(share * 100));
  const [shares, setShares] = useState<Record<Tier, string>>({ green: percentOf(DEFAULT_SHARES.green), plain: percentOf(DEFAULT_SHARES.plain), red: percentOf(DEFAULT_SHARES.red) });
  const [importNote, setImportNote] = useState<{ text: string[]; error: boolean } | null>(null);
  const importId = useId();
  const listed = new Set(rows.map((row) => row.country));
  const margins = rows.map(draftMargin);
  const losses = margins.filter((margin) => margin.state === "loss").length;
  const thin = margins.filter((margin) => margin.state === "thin").length;
  const unknown = margins.filter((margin) => margin.state === "unknown").length;
  const defaultMargin = draftMargin({ pay: defaultPay, earn: defaultEarn });
  const update = (index: number, patch: Partial<CountryPayDraft>): void => onChange(rows.map((row, at) => at === index ? { ...row, ...patch } : row));

  function runImport(mode: "replace" | "merge"): void {
    if (SHARE_FIELDS.some(([tier]) => shares[tier].trim() !== "" && (!/^\d{1,3}$/.test(shares[tier].trim()) || Number(shares[tier]) > 100))) { setImportNote({ text: ["Each pay share must be a whole percentage from 0 to 100, or blank to keep the default pay."], error: true }); return; }
    const share = (tier: Tier): number | null => shares[tier].trim() === "" ? null : Number(shares[tier]) / 100;
    const result = importCountryPay(paste, { green: share("green"), plain: share("plain"), red: share("red") }, dollarsToMicros(defaultPay) ?? 2_000);
    if (result.rows.length === 0) { setImportNote({ text: result.problems.length > 0 ? result.problems : ["No country rows were found."], error: true }); return; }
    const incoming = result.rows.map(toDraft);
    const next = mode === "replace" ? incoming : [...rows.filter((row) => !incoming.some((item) => item.country === row.country)), ...incoming].sort((a, b) => a.country.localeCompare(b.country));
    onChange(next);
    setImportNote({ text: [`Imported ${result.rows.length} ${result.rows.length === 1 ? "country" : "countries"}. Check the table, then Save connection: nothing is paid differently until you save.`, ...result.problems], error: false });
  }

  return <div className="country-pay">
    <div className="country-pay-summary" role="status">
      <strong>{rows.length === 0 ? "One rate everywhere" : `${rows.length} ${rows.length === 1 ? "country has" : "countries have"} their own rate`}</strong>
      <span>Everywhere else pays the default above{defaultMargin.state === "unknown" ? "." : `, leaving ${marginLabel(defaultMargin)} a card.`}</span>
      {losses > 0 && <span className="country-pay-flag" data-state="loss">{losses} would lose money: lower their pay to save</span>}
      {thin > 0 && <span className="country-pay-flag" data-state="thin">{thin} keep under 20%</span>}
      {unknown > 0 && <span className="country-pay-flag" data-state="unknown">{unknown} without an earnings figure</span>}
    </div>
    <label className="tagflow-field country-pay-default-earn"><span>A card earns ADCode, elsewhere (USD, optional)</span><input className="input" inputMode="decimal" value={defaultEarn} onChange={(event) => onDefaultEarn(event.target.value)} placeholder="e.g. 0.0015" /><small>What one card earns in countries without their own row, for the margin. The default pay above may not exceed it. Only administrators see it.</small></label>
    {rows.length > 0 && <div className="admin-models-scroll country-pay-scroll" role="region" aria-label="Pay by country" tabIndex={0}><table className="admin-models-table country-pay-table">
      <caption className="sr-only">Pay per Zeekend card by country</caption>
      <thead><tr><th scope="col">Country</th><th scope="col">A card earns ADCode</th><th scope="col">Pays the viewer</th><th scope="col">Paid cards a day</th><th scope="col">ADCode keeps</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
      <tbody>{rows.map((row, index) => {
        const margin = margins[index]!;
        const name = countryName(row.country);
        return <tr key={row.country} data-state={margin.state}>
          <th scope="row"><span className="country-pay-code">{row.country}</span> {name}</th>
          <td><input className="input" inputMode="decimal" aria-label={`What a card earns ADCode in ${name}, USD`} value={row.earn} placeholder="unknown" onChange={(event) => update(index, { earn: event.target.value })} /></td>
          <td><input className="input" inputMode="decimal" aria-label={`Pay per card in ${name}, USD`} value={row.pay} onChange={(event) => update(index, { pay: event.target.value })} /></td>
          <td><input className="input" inputMode="numeric" aria-label={`Paid cards a day in ${name}`} value={row.cap} placeholder={defaultCap} onChange={(event) => update(index, { cap: event.target.value })} /></td>
          <td className="country-pay-margin">{marginLabel(margin)}{marginWord[margin.state] !== "" && <span className="country-pay-flag" data-state={margin.state}>{marginWord[margin.state]}</span>}</td>
          <td><button type="button" className="btn btn-ghost" aria-label={`Remove ${name}`} onClick={() => onChange(rows.filter((_, at) => at !== index))}>Remove</button></td>
        </tr>;
      })}</tbody>
    </table></div>}
    <div className="country-pay-add">
      <label className="tagflow-field"><span>Add a country</span><select className="select" value={adding} onChange={(event) => setAdding(event.target.value)}>
        <option value="">Choose a country…</option>
        {[...COUNTRY_CODES].filter((code) => !listed.has(code)).map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name)).map(({ code, name }) => <option key={code} value={code}>{name} ({code})</option>)}
      </select></label>
      <button type="button" className="btn" disabled={adding === ""} onClick={() => { onChange([...rows, { country: adding, pay: defaultPay, earn: "", cap: "" }].sort((a, b) => a.country.localeCompare(b.country))); setAdding(""); }}>Add country</button>
    </div>
    <details className="country-pay-import">
      <summary>Import from a sheet</summary>
      <p className="row-sub">Copy the rows from the sheet, header line included, and paste them here. The header needs a <strong>Country</strong> column (a code like US or a name) and what a card earns: a <strong>CPM</strong> (per 1,000 cards) or a per-card <strong>earnings</strong> column. A <strong>Pay</strong> column is used as it is; without one, each country pays a share of what its card earns, rounded down to $0.0001. Pasting loses the sheet&apos;s colours, so add a <strong>Tier</strong> column saying <em>green</em> or <em>red</em> (blank for the rest): each tier gets its own share below. A <strong>Cap</strong> or <strong>per day</strong> column sets that country&apos;s daily cap.</p>
      <label className="tagflow-field" htmlFor={importId}><span>Rows from the sheet</span></label>
      <textarea id={importId} className="textarea ad-network-json" rows={6} value={paste} spellCheck={false} placeholder={"Country\tCPM\tTier\nUnited States\t$9.60\tgreen\nIndia\t$3.51\tred\nBrazil\t$3.50"} onChange={(event) => setPaste(event.target.value)} />
      <div className="country-pay-add">
        {SHARE_FIELDS.map(([tier, label]) => <label key={tier} className="tagflow-field country-pay-share" data-tier={tier}><span>{label}</span><input className="input" inputMode="numeric" value={shares[tier]} placeholder="keep default" onChange={(event) => setShares({ ...shares, [tier]: event.target.value })} /></label>)}
        <small className="country-pay-share-note">Used only for rows without a Pay column. 45 pays 45% of what a card earns and ADCode keeps the rest; blank keeps the default pay above (never more than the card earns). Proposed: green 45, red 30, the rest unchanged.</small>
        <div className="ad-network-actions"><button type="button" className="btn" disabled={paste.trim() === ""} onClick={() => runImport("replace")}>Replace the table</button><button type="button" className="btn" disabled={paste.trim() === ""} onClick={() => runImport("merge")}>Add to the table</button></div>
      </div>
      {importNote && <div className="notice" data-tone={importNote.error ? "error" : "success"} role={importNote.error ? "alert" : "status"}>{importNote.text.map((line, index) => <p key={index}>{line}</p>)}</div>}
    </details>
  </div>;
}
