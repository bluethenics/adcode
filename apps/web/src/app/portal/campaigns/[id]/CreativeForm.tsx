"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES, type CreativeView } from "@/lib/api";

/**
 * Submitting a creative, with a live preview of the card as it will appear.
 *
 * The preview is not decoration. The card lives in the corner of someone's editor at
 * about 260px wide, and a headline that reads fine in a text input can be unreadable
 * there. Showing the real thing at the real size is the only way to know.
 *
 * Logos are https URLs rather than an upload here. Firebase Storage upload is the next
 * step; until the bucket exists, a URL is what the ad client can actually fetch.
 */
const LIMITS = { headline: 80, body: 160, advertiser: 40 } as const;

export function CreativeForm({
  campaignId,
  onCreated,
}: {
  campaignId: string;
  onCreated: () => void;
}) {
  const { token } = useAuth();

  const [advertiser, setAdvertiser] = useState("");
  const [headline, setHeadline] = useState("");
  const [body, setBody] = useState("");
  const [clickUrl, setClickUrl] = useState("https://");
  const [logoLight, setLogoLight] = useState("https://");
  const [logoDark, setLogoDark] = useState("https://");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;

    for (const [label, value] of [
      ["Link", clickUrl],
      ["Light logo", logoLight],
      ["Dark logo", logoDark],
    ] as const) {
      if (!value.startsWith("https://") || value.length < 12) {
        setError(`${label} must be an https address.`);
        return;
      }
    }

    setBusy(true);
    setError(null);

    const created = await apiFetch<CreativeView>({
      path: "/portal/creatives",
      token: await token(),
      method: "POST",
      body: {
        campaignId,
        advertiser: advertiser.trim(),
        headline: headline.trim(),
        body: body.trim().length === 0 ? null : body.trim(),
        clickUrl,
        logoLight,
        logoDark,
      },
    });

    setBusy(false);
    if (!created.ok) {
      setError(MESSAGES[created.error]);
      return;
    }

    setDone(true);
    setHeadline("");
    setBody("");
    onCreated();
  };

  return (
    <form onSubmit={submit} style={{ maxWidth: 620 }}>
      <h3 style={{ fontSize: 18, marginBottom: 12 }}>Add a creative</h3>

      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}
      {done && (
        <div className="notice" data-tone="ok">
          Submitted for review. We check creatives before they reach anyone&apos;s editor.
        </div>
      )}

      <div className="field">
        <label htmlFor="cr-advertiser">Your name, as developers see it</label>
        <input
          id="cr-advertiser"
          className="input"
          maxLength={LIMITS.advertiser}
          required
          placeholder="Acme"
          value={advertiser}
          onChange={(e) => setAdvertiser(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="cr-headline">Headline</label>
        <span className="field-hint">
          {headline.length}/{LIMITS.headline} — it sits in a small card, so shorter reads better.
        </span>
        <input
          id="cr-headline"
          className="input"
          maxLength={LIMITS.headline}
          required
          placeholder="Ship faster"
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="cr-body">Supporting line (optional)</label>
        <span className="field-hint">
          {body.length}/{LIMITS.body}
        </span>
        <input
          id="cr-body"
          className="input"
          maxLength={LIMITS.body}
          placeholder="A tool for Rust teams"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="cr-url">Where the card links to</label>
        <input
          id="cr-url"
          className="input"
          type="url"
          required
          value={clickUrl}
          onChange={(e) => setClickUrl(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="cr-light">Logo for light themes</label>
        <span className="field-hint">An https URL to a square PNG or SVG.</span>
        <input
          id="cr-light"
          className="input"
          type="url"
          required
          value={logoLight}
          onChange={(e) => setLogoLight(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="cr-dark">Logo for dark themes</label>
        <input
          id="cr-dark"
          className="input"
          type="url"
          required
          value={logoDark}
          onChange={(e) => setLogoDark(e.target.value)}
        />
      </div>

      {/* The card at the size it actually renders, on the ground it actually sits on. */}
      <div className="field">
        <label>Preview</label>
        <span className="field-hint">How it appears in the corner of the editor.</span>
        <div
          style={{
            background: "var(--ink)",
            padding: 22,
            borderRadius: "var(--radius-md)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <div className="toast" style={{ position: "static", animation: "none" }}>
            <span className="toast-tag">Sponsored · {advertiser || "Your name"}</span>
            <span className="toast-head">{headline || "Your headline"}</span>
            {body.trim().length > 0 && <span className="toast-body">{body}</span>}
          </div>
        </div>
      </div>

      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Submit for review
        </button>
      </div>
    </form>
  );
}
