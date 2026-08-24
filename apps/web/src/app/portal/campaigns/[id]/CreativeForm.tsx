"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { LogoDrop } from "@/components/LogoDrop";
import { apiFetch, MESSAGES, type CreativeView } from "@/lib/api";

/**
 * Adding another card to a campaign that already exists.
 *
 * The first card is created with the campaign on one screen; this is for the second one,
 * for replacing one that was rejected, and for running two messages against the same
 * budget. Same fields, same live preview, same logo drop - nothing here asks anyone to
 * host a PNG somewhere first.
 */
const LIMITS = { headline: 80, body: 160, advertiser: 40 } as const;

export function CreativeForm({
  campaignId,
  defaultAdvertiser,
  onCreated,
}: {
  campaignId: string;
  defaultAdvertiser?: string;
  onCreated: () => void;
}) {
  const { token } = useAuth();

  const [advertiser, setAdvertiser] = useState(defaultAdvertiser ?? "");
  const [headline, setHeadline] = useState("");
  const [body, setBody] = useState("");
  const [clickUrl, setClickUrl] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [darkLogo, setDarkLogo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;

    if (!clickUrl.startsWith("https://") || clickUrl.length < 12) {
      setError("The link has to be an https address.");
      return;
    }
    if (logo === null) {
      setError("Add a logo — the card has a space for it and looks broken without one.");
      return;
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
        logoLight: logo,
        logoDark: darkLogo ?? logo,
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
    <form onSubmit={submit} className="ios-card">
      <header className="ios-card-head">
        <h2>Add another card</h2>
        <p>Two messages can share one budget. Each is reviewed on its own.</p>
      </header>

      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}
      {done && (
        <div className="notice" data-tone="ok">
          Submitted for review. We check cards before they reach anyone&apos;s editor.
        </div>
      )}

      <div className="field">
        <label htmlFor="cr-advertiser">Brand name</label>
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
        <label htmlFor="cr-headline">Your message</label>
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
        <label htmlFor="cr-body">Supporting line</label>
        <span className="field-hint">
          Optional. {body.length}/{LIMITS.body}
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
        <label htmlFor="cr-url">Where it goes</label>
        <input
          id="cr-url"
          className="input"
          type="url"
          required
          placeholder="https://acme.com/developers"
          value={clickUrl}
          onChange={(e) => setClickUrl(e.target.value)}
        />
      </div>

      <LogoDrop label="Logo" value={logo} onChange={setLogo} />

      <details className="ios-disclosure">
        <summary>Different logo for dark themes</summary>
        <LogoDrop
          label="Logo for dark themes"
          hint="Only needed if your logo disappears on a dark background."
          value={darkLogo}
          onChange={setDarkLogo}
        />
      </details>

      <div className="field">
        <label>Preview</label>
        <span className="field-hint">How it appears in the corner of the editor.</span>
        <div className="card-preview-ground">
          <div className="toast" style={{ position: "static", animation: "none" }}>
            <span className="toast-tag">Sponsored · {advertiser || "Your brand"}</span>
            <span className="toast-headline">
              {logo !== null && (
                // eslint-disable-next-line @next/next/no-img-element -- a data: URL at its
                // rendered size; next/image would proxy it for nothing.
                <img src={logo} alt="" className="toast-logo" width={28} height={28} />
              )}
              <span className="toast-head">{headline || "Your message"}</span>
            </span>
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
