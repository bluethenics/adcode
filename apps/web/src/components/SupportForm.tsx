"use client";

import { useState } from "react";
import { apiFetch, MESSAGES } from "@/lib/api";
import { buildSupportRequest, type SupportKind } from "@/lib/support";
import { useAuth } from "./AuthProvider";

interface ReportResponse { reportId: string }

export function SupportForm() {
  const { token } = useAuth();
  const [kind, setKind] = useState<SupportKind>("help");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [reference, setReference] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setReportId(null);

    let body;
    try {
      body = buildSupportRequest({ kind, subject, message, reference, platform: navigator.platform });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the form and try again.");
      return;
    }

    setSending(true);
    const result = await apiFetch<ReportResponse>({ path: "/reports", token: await token(), method: "POST", body });
    setSending(false);
    if (!result.ok) {
      setError(MESSAGES[result.error]);
      return;
    }

    setReportId(result.value.reportId);
    setSubject("");
    setMessage("");
    setReference("");
  };

  return (
    <form className="support-form glass-card" onSubmit={(event) => void submit(event)}>
      <div className="support-form-head">
        <div><span className="glass-kicker">Message support</span><h2>How can we help?</h2></div>
        <p>Your signed-in account is attached automatically. Never include passwords, API keys, or complete bank details.</p>
      </div>

      {reportId !== null && (
        <div className="glass-notice" data-tone="success" role="status">
          Message sent. Your reference is <strong>{reportId}</strong>.
        </div>
      )}
      {error !== null && <div className="glass-notice" data-tone="error" role="alert">{error}</div>}

      <div className="support-fields">
        <label className="glass-field">
          <span>Category</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as SupportKind)}>
            <option value="help">Account help</option>
            <option value="bug">Report a problem</option>
            <option value="feature">Suggest an improvement</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="glass-field">
          <span>Reference <small>optional</small></span>
          <input value={reference} maxLength={100} onChange={(event) => setReference(event.target.value)} placeholder="Campaign, withdrawal, or order ID" />
        </label>
        <label className="glass-field glass-field-wide">
          <span>Subject</span>
          <input required value={subject} maxLength={120} onChange={(event) => setSubject(event.target.value)} placeholder="A short description" />
        </label>
        <label className="glass-field glass-field-wide">
          <span>Message <small>{message.length} / 3,850</small></span>
          <textarea required value={message} maxLength={3850} rows={8} onChange={(event) => setMessage(event.target.value)} placeholder="Tell us what happened and what you expected." />
        </label>
      </div>

      <button type="submit" className="glass-submit" disabled={sending}>{sending ? "Sending…" : "Send to support"}</button>
    </form>
  );
}
