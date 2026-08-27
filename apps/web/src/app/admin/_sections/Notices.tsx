"use client";

import { useCallback, useEffect, useState } from "react";
import { HelpNote } from "@/components/HelpNote";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES } from "@/lib/api";
import { when } from "@/components/money";

interface NoticeRow {
  noticeId: string;
  severity: "info" | "warning";
  title: string;
  body: string;
  active: boolean;
  createdAt: number;
}

/**
 * Telling everyone running the editor that something is wrong.
 *
 * The editor's ad client fails silently by design, so when serving breaks nobody is told
 * anything. This is the way to tell them — written by a person, sent on purpose. Each
 * notice reaches a machine once and never repeats.
 */
export function NoticesBody() {
  const { token } = useAuth();
  const [rows, setRows] = useState<NoticeRow[]>([]);
  const [severity, setSeverity] = useState<"info" | "warning">("warning");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const load = useCallback(async () => {
    const found = await apiFetch<{ notices: NoticeRow[] }>({
      path: "/admin/notices",
      token: await token(),
    });
    if (found.ok) setRows(found.value.notices);
    else setError(MESSAGES[found.error]);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const publish = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;

    if (title.trim().length === 0 || body.trim().length === 0) {
      setError("A notice needs a headline and a sentence.");
      return;
    }

    setBusy(true);
    setError(null);
    setSent(false);

    const result = await apiFetch<NoticeRow>({
      path: "/admin/notices",
      token: await token(),
      method: "POST",
      body: { severity, title: title.trim(), body: body.trim() },
    });

    setBusy(false);
    if (!result.ok) {
      setError(MESSAGES[result.error]);
      return;
    }

    setSent(true);
    setTitle("");
    setBody("");
    void load();
  };

  const retract = async (noticeId: string) => {
    setBusy(true);
    const result = await apiFetch<NoticeRow>({
      path: `/admin/notices/${encodeURIComponent(noticeId)}/retract`,
      token: await token(),
      method: "POST",
    });
    setBusy(false);

    if (!result.ok) {
      setError(MESSAGES[result.error]);
      return;
    }
    void load();
  };

  if (loading) return <p className="lede">Loading…</p>;

  return (
    <>
      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}
      {sent && (
        <div className="notice" data-tone="ok">
          Published. Editors pick it up within half an hour, and each machine shows it once.
        </div>
      )}

      <HelpNote id="admin-notices">
        The editor never tells anyone an ad request failed — it fails quietly on purpose,
        because a toast about a blip nobody can fix is just noise. This is the exception:
        you decide something is worth saying, and you say it. Use it for outages and
        planned downtime, not for every error in the logs.
      </HelpNote>

      <form onSubmit={publish} style={{ maxWidth: 560, marginBottom: 34 }}>
        <h3 style={{ fontSize: 18, marginBottom: 12 }}>Send a notice</h3>

        <div className="field">
          <label htmlFor="n-sev">Weight</label>
          <select
            id="n-sev"
            className="select"
            value={severity}
            onChange={(e) => setSeverity(e.target.value === "info" ? "info" : "warning")}
          >
            <option value="warning">Warning — something is wrong right now</option>
            <option value="info">Info — worth knowing, nothing is broken</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="n-title">Headline</label>
          <span className="field-hint">{title.length}/100. Say what is happening, not that you are sorry.</span>
          <input
            id="n-title"
            className="input"
            maxLength={100}
            placeholder="Ads aren't loading right now"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="n-body">Detail</label>
          <span className="field-hint">
            {body.length}/500. What it affects, and what they should do — even if that is
            &ldquo;nothing, we&apos;re fixing it&rdquo;.
          </span>
          <textarea
            id="n-body"
            className="textarea"
            maxLength={500}
            placeholder="Your earnings aren't affected — anything you've already earned is safe. New ads will start again once we've fixed it."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        <div className="field">
          <label>Preview</label>
          <div style={{ background: "var(--ink)", padding: 22, borderRadius: "var(--radius-md)", display: "flex", justifyContent: "flex-end" }}>
            <div
              className="toast"
              style={{
                position: "static",
                animation: "none",
                borderLeft: severity === "warning" ? "3px solid var(--warn)" : undefined,
              }}
            >
              <span className="toast-head" style={{ color: severity === "warning" ? "var(--warn)" : undefined }}>
                {title || "Your headline"}
              </span>
              <span className="toast-body">{body || "Your detail."}</span>
            </div>
          </div>
        </div>

        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Send to everyone
          </button>
        </div>
      </form>

      <h3 style={{ fontSize: 18, marginBottom: 12 }}>Sent</h3>

      {rows.length === 0 ? (
        <div className="empty">
          <h3>Nothing sent</h3>
          <p>Notices you send appear here, including ones you later retract.</p>
        </div>
      ) : (
        <div className="rows">
          {rows.map((row) => (
            <div className="row" key={row.noticeId}>
              <span className="row-main">
                <span className="row-title">{row.title}</span>
                <span className="row-sub">
                  <span className="pill" data-tone={row.active ? "live" : "ended"}>
                    {row.active ? "Showing" : "Retracted"}
                  </span>{" "}
                  {row.severity} · {when(row.createdAt)}
                </span>
              </span>
              {row.active && (
                <button className="btn btn-outline btn-small" disabled={busy} onClick={() => void retract(row.noticeId)}>
                  Retract
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="field-hint" style={{ marginTop: 18, maxWidth: "64ch" }}>
        Retracting stops new machines seeing it. Anyone already shown it keeps what they
        saw — there is no way to un-tell someone something.
      </p>
    </>
  );
}
