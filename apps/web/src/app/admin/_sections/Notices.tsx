"use client";

import { useCallback, useEffect, useState } from "react";
import { HelpNote } from "@/components/HelpNote";
import { AdminFootnote, AdminPanel, AdminWorkspace } from "@/components/AdminUI";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES } from "@/lib/api";
import { when } from "@/components/money";
import { MAX_DATA_URL_CHARS, toWebImage } from "@/components/MarkdownEditor";

interface NoticeButton { label: string; url: string }

interface NoticeRow {
  noticeId: string;
  severity: "info" | "warning";
  title: string;
  body: string;
  imageUrl?: string;
  imageAlt?: string;
  buttons?: NoticeButton[];
  active: boolean;
  createdAt: number;
}

const isHttps = (value: string): boolean => {
  try { return new URL(value.trim()).protocol === "https:"; } catch { return false; }
};

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
  const [imageUrl, setImageUrl] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [buttons, setButtons] = useState<NoticeButton[]>([]);
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
    if (imageUrl.trim() !== "" && !isHttps(imageUrl)) {
      setError("The image address must start with https://. Or upload the image instead.");
      return;
    }
    const filled = buttons.filter((button) => button.label.trim() !== "" || button.url.trim() !== "");
    if (filled.some((button) => button.label.trim() === "" || !isHttps(button.url))) {
      setError("Each button needs a label and an https:// link.");
      return;
    }

    setBusy(true);
    setError(null);
    setSent(false);

    const result = await apiFetch<NoticeRow>({
      path: "/admin/notices",
      token: await token(),
      method: "POST",
      body: {
        severity, title: title.trim(), body: body.trim(),
        ...(imageUrl.trim() === "" ? {} : { imageUrl: imageUrl.trim(), imageAlt: imageAlt.trim() }),
        buttons: filled.map((button) => ({ label: button.label.trim(), url: button.url.trim() })),
      },
    });

    setBusy(false);
    if (!result.ok) {
      setError(MESSAGES[result.error]);
      return;
    }

    setSent(true);
    setTitle("");
    setBody("");
    setImageUrl("");
    setImageAlt("");
    setButtons([]);
    void load();
  };

  const upload = async (file: File | undefined) => {
    if (file === undefined) return;
    setUploading(true);
    setError(null);
    try {
      const image = await toWebImage(file);
      if (image.dataUrl.length > MAX_DATA_URL_CHARS) {
        setError("That image is still too large after resizing. Try a smaller one.");
        return;
      }
      const uploaded = await apiFetch<{ url: string }>({ path: "/admin/post-assets", token: await token(), method: "POST", body: { dataUrl: image.dataUrl } });
      if (!uploaded.ok) {
        setError(uploaded.error === "unauthenticated" ? "Your session expired. Sign in again, then retry the upload." : "The upload wasn't accepted. Try a smaller image.");
        return;
      }
      setImageUrl(uploaded.value.url);
    } catch {
      setError("That file could not be read as an image.");
    } finally {
      setUploading(false);
    }
  };
  const editButton = (index: number, patch: Partial<NoticeButton>) =>
    setButtons((current) => current.map((button, at) => (at === index ? { ...button, ...patch } : button)));

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

      <AdminWorkspace compose={
      <AdminPanel title="Send a notice" hint="Shown once on every machine running ADCode, within half an hour." onSubmit={publish}>

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
          <label htmlFor="n-image">Image</label>
          <span className="field-hint">Optional. Shown above the text in the editor. Upload one, or paste an https:// address.</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input id="n-image" className="input" style={{ flex: 1, minWidth: 220 }} maxLength={500} placeholder="https://" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
            <label className="btn btn-outline" style={{ cursor: uploading ? "progress" : "pointer" }}>
              {uploading ? "Uploading…" : "Upload"}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden disabled={uploading} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            {imageUrl !== "" && <button type="button" className="btn btn-outline" onClick={() => { setImageUrl(""); setImageAlt(""); }}>Remove</button>}
          </div>
          {imageUrl !== "" && (
            <input aria-label="Image description" className="input" style={{ marginTop: 8 }} maxLength={200} placeholder="What the image shows, for screen readers" value={imageAlt} onChange={(e) => setImageAlt(e.target.value)} />
          )}
        </div>

        <div className="field">
          <label>Buttons</label>
          <span className="field-hint">Optional, up to two. Each opens its link in the reader&apos;s browser; the first is the main one.</span>
          {buttons.map((button, index) => (
            <div key={index} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <input aria-label={`Button ${index + 1} label`} className="input" style={{ width: 160 }} maxLength={30} placeholder={index === 0 ? "Read more" : "Status page"} value={button.label} onChange={(e) => editButton(index, { label: e.target.value })} />
              <input aria-label={`Button ${index + 1} link`} className="input" style={{ flex: 1, minWidth: 200 }} maxLength={500} placeholder="https://" value={button.url} onChange={(e) => editButton(index, { url: e.target.value })} />
              <button type="button" className="btn btn-outline" onClick={() => setButtons((current) => current.filter((_, at) => at !== index))}>Remove</button>
            </div>
          ))}
          {buttons.length < 2 && (
            <button type="button" className="btn btn-outline btn-small" style={{ marginTop: 8, justifySelf: "start" }} onClick={() => setButtons((current) => [...current, { label: "", url: "" }])}>Add a button</button>
          )}
        </div>

        <div className="field">
          <label>Preview</label>
          <div className="adm-preview-stage">
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
              {isHttps(imageUrl) && (
                // eslint-disable-next-line @next/next/no-img-element -- an admin preview of any https image
                <img src={imageUrl.trim()} alt={imageAlt} style={{ display: "block", width: "100%", maxHeight: 160, objectFit: "cover", borderRadius: 8, margin: "6px 0" }} />
              )}
              <span className="toast-body">{body || "Your detail."}</span>
              {buttons.some((button) => button.label.trim() !== "") && (
                <span style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  {buttons.filter((button) => button.label.trim() !== "").map((button, index) => (
                    <span key={index} className={index === 0 ? "btn btn-primary btn-small" : "btn btn-outline btn-small"}>{button.label}</span>
                  ))}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Send to everyone
          </button>
        </div>
      </AdminPanel>
      }>
      <AdminPanel title="Sent" bare actions={`${rows.filter((row) => row.active).length} showing`}>

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
                  {row.severity} · {when(row.createdAt)}{row.imageUrl ? ", with image" : ""}{row.buttons?.length ? `, ${row.buttons.length} button${row.buttons.length === 1 ? "" : "s"}` : ""}
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

      <AdminFootnote>
        Retracting stops new machines seeing it. Anyone already shown it keeps what they
        saw — there is no way to un-tell someone something.
      </AdminFootnote>
      </AdminPanel>
      </AdminWorkspace>
    </>
  );
}
