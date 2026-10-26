"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES, type CreativeView } from "@/lib/api";
import { AdminPanel } from "@/components/AdminUI";

/**
 * The creative safety valve.
 *
 * Cards go live without human review - automated checks run on submit - so this queue
 * is normally empty. It exists for the exception: a reported or abusive card can be
 * rejected here, which pulls it out of serving immediately, and the decision is
 * audited against the admin who made it.
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

      <AdminPanel
        bare
        title="Waiting for review"
        hint="Nothing here reaches a developer's editor until you approve it. Check the claim is truthful, the link goes where it says, and the logos load."
        actions={queue.length === 0 ? "All clear" : `${queue.length} waiting`}
      >
      <div className="adm-stack-list">

      {queue.length === 0 ? (
        <div className="empty">
          <h3>Queue is clear</h3>
          <p>No creatives are waiting. New submissions appear here straight away.</p>
        </div>
      ) : (
        queue.map((creative) => (
          <div className="card admin-card" key={creative.creativeId}>
            <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                <h3>{creative.headline}</h3>
                <p>{creative.body ?? <em>No supporting line.</em>}</p>

                <dl className="adm-pairs">
                  <div>
                    <dt>Advertiser</dt>
                    <dd>{creative.advertiser}</dd>
                  </div>
                  <div>
                    <dt>Links to</dt>
                    <dd>
                      {/* noopener/noreferrer: an unreviewed advertiser URL is untrusted. */}
                      <a href={creative.clickUrl} target="_blank" rel="noopener noreferrer nofollow">
                        {creative.clickUrl}
                      </a>
                    </dd>
                  </div>
                </dl>
              </div>

              {/* The card at the size it will actually appear. */}
              <div className="adm-preview-stage adm-creative-preview">
                <div className="toast">
                  <span className="toast-tag">Sponsored · {creative.advertiser}</span>
                  <span className="toast-head">{creative.headline}</span>
                  {creative.body !== null && <span className="toast-body">{creative.body}</span>}
                </div>
              </div>
            </div>

            <div className="adm-actions">
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
      </div>
      </AdminPanel>
    </>
  );
}
