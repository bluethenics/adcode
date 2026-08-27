"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES, type CreativeView } from "@/lib/api";

/**
 * The creative review queue.
 *
 * This is the admin panel's home because it is the only screen with a queue that blocks
 * someone else: an advertiser cannot go live until a human looks at their card. Users,
 * feedback, and the blog can all wait; this cannot.
 */
export function ReviewQueue() {
  const { token } = useAuth();
  const [queue, setQueue] = useState<CreativeView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const found = await apiFetch<{ creatives: CreativeView[] }>({
      path: "/admin/creatives",
      token: await token(),
    });
    if (found.ok) setQueue(found.value.creatives);
    else setError(MESSAGES[found.error]);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (creativeId: string, status: "approved" | "rejected") => {
    setBusy(creativeId);
    setError(null);

    const result = await apiFetch<CreativeView>({
      path: `/admin/creatives/${encodeURIComponent(creativeId)}/status`,
      token: await token(),
      method: "POST",
      body: { status },
    });

    setBusy(null);
    if (!result.ok) {
      setError(MESSAGES[result.error]);
      return;
    }
    setQueue((current) => current.filter((c) => c.creativeId !== creativeId));
  };

  if (loading) return <p className="lede">Loading…</p>;

  return (
    <>
      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}

      <h3 style={{ fontSize: 18, marginBottom: 6 }}>Creatives waiting for review</h3>
      <p className="field-hint" style={{ marginBottom: 18, maxWidth: "64ch" }}>
        Nothing here reaches a developer&apos;s editor until you approve it. Check the
        claim is truthful, the link goes where it says, and the logos load.
      </p>

      {queue.length === 0 ? (
        <div className="empty">
          <h3>Queue is clear</h3>
          <p>No creatives are waiting. New submissions appear here straight away.</p>
        </div>
      ) : (
        queue.map((creative) => (
          <div className="card" key={creative.creativeId} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                <h3>{creative.headline}</h3>
                <p>{creative.body ?? <em>No supporting line.</em>}</p>

                <dl style={{ margin: "14px 0 0", fontSize: 13.5 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <dt style={{ color: "var(--muted)", minWidth: 78 }}>Advertiser</dt>
                    <dd style={{ margin: 0 }}>{creative.advertiser}</dd>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <dt style={{ color: "var(--muted)", minWidth: 78 }}>Links to</dt>
                    <dd style={{ margin: 0, minWidth: 0, overflowWrap: "anywhere" }}>
                      {/* noopener/noreferrer: an unreviewed advertiser URL is untrusted. */}
                      <a href={creative.clickUrl} target="_blank" rel="noopener noreferrer nofollow">
                        {creative.clickUrl}
                      </a>
                    </dd>
                  </div>
                </dl>
              </div>

              {/* The card at the size it will actually appear. */}
              <div
                style={{
                  flex: "0 0 auto",
                  background: "var(--ink)",
                  padding: 16,
                  borderRadius: "var(--radius-md)",
                }}
              >
                <div className="toast" style={{ position: "static", animation: "none" }}>
                  <span className="toast-tag">Sponsored · {creative.advertiser}</span>
                  <span className="toast-head">{creative.headline}</span>
                  {creative.body !== null && <span className="toast-body">{creative.body}</span>}
                </div>
              </div>
            </div>

            <div className="actions">
              <button
                className="btn btn-primary btn-small"
                disabled={busy === creative.creativeId}
                onClick={() => void decide(creative.creativeId, "approved")}
              >
                Approve
              </button>
              <button
                className="btn btn-outline btn-small"
                disabled={busy === creative.creativeId}
                onClick={() => void decide(creative.creativeId, "rejected")}
              >
                Reject
              </button>
            </div>
          </div>
        ))
      )}
    </>
  );
}
