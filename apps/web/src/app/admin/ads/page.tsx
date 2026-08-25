"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES, type CreativeView } from "@/lib/api";

/**
 * Sending a test ad to a running editor.
 *
 * Honest about what it can and cannot do: the server can put a creative at the front of
 * the queue for one user, but it cannot make the editor interrupt them. The editor's own
 * scheduler decides that, and it will not interrupt typing or a debug session no matter
 * who asks. So the copy says "next ad slot", not "instantly".
 */
export default function AdminAds() {
  return (
    <AdminShell title="Test delivery" subtitle="Send a card to your own editor without billing anybody.">
      <TestAdsBody />
    </AdminShell>
  );
}

function TestAdsBody() {
  const { token, user } = useAuth();
  const [creatives, setCreatives] = useState<CreativeView[]>([]);
  const [targetUid, setTargetUid] = useState("");
  const [creativeId, setCreativeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  const load = useCallback(async () => {
    const t = await token();

    // Both queues, because testing an unapproved creative before letting it live is
    // exactly what this screen is for.
    const [pending, approved] = await Promise.all([
      apiFetch<{ creatives: CreativeView[] }>({ path: "/admin/creatives", token: t }),
      apiFetch<{ creatives: CreativeView[] }>({ path: "/admin/creatives?status=approved", token: t }),
    ]);

    const all = [
      ...(pending.ok ? pending.value.creatives : []),
      ...(approved.ok ? approved.value.creatives : []),
    ];
    setCreatives(all);
    if (all[0] !== undefined) setCreativeId(all[0].creativeId);

    if (!pending.ok) setError(MESSAGES[pending.error]);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (user !== null && targetUid.length === 0) setTargetUid(user.uid);
  }, [user, targetUid.length]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || creativeId.length === 0) return;

    setBusy(true);
    setError(null);
    setQueued(false);

    const result = await apiFetch<{ ok: boolean }>({
      path: "/admin/test-serve",
      token: await token(),
      method: "POST",
      body: { uid: targetUid.trim(), creativeId },
    });

    setBusy(false);
    if (!result.ok) {
      setError(MESSAGES[result.error]);
      return;
    }
    setQueued(true);
  };

  if (loading) return <p className="lede">Loading…</p>;

  return (
    <>
      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}
      {queued && (
        <div className="notice" data-tone="ok">
          Queued. It appears at that editor&apos;s next ad slot — set the cadence to
          &ldquo;max&rdquo; in ADCode&apos;s settings if you don&apos;t want to wait.
        </div>
      )}

      <h3 style={{ fontSize: 18, marginBottom: 6 }}>Send a test ad</h3>
      <p className="field-hint" style={{ marginBottom: 20, maxWidth: "64ch" }}>
        Puts one creative at the front of the queue for a single account, ignoring
        targeting, budget, and whether its campaign is live. It fires once. The resulting
        view is recorded but charges no advertiser and credits no user, so testing
        delivery never moves real money.
      </p>

      {creatives.length === 0 ? (
        <div className="empty">
          <h3>No creatives to test</h3>
          <p>Once an advertiser submits a creative, you can send it to yourself from here.</p>
        </div>
      ) : (
        <form onSubmit={send} style={{ maxWidth: 520 }}>
          <div className="field">
            <label htmlFor="t-creative">Creative</label>
            <select
              id="t-creative"
              className="select"
              value={creativeId}
              onChange={(e) => setCreativeId(e.target.value)}
            >
              {creatives.map((creative) => (
                <option key={creative.creativeId} value={creative.creativeId}>
                  {creative.headline} — {creative.advertiser} ({creative.status})
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="t-uid">Send to which account</label>
            <span className="field-hint">
              Defaults to you. Paste another account&apos;s ID from the Users tab to send
              it there instead.
            </span>
            <input
              id="t-uid"
              className="input mono"
              style={{ fontSize: 13 }}
              required
              value={targetUid}
              onChange={(e) => setTargetUid(e.target.value)}
            />
          </div>

          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Queue test ad
            </button>
          </div>
        </form>
      )}

      <div className="notice" data-tone="info" style={{ marginTop: 26, maxWidth: "64ch" }}>
        <strong>If ads aren&apos;t arriving at all</strong>, check in this order: the kill
        switch in server config, whether the campaign is live and funded, whether its
        creative is approved, and whether the user&apos;s cadence is set to off. A test ad
        skips the middle two, so if the test arrives but real ads don&apos;t, the problem
        is the campaign, not delivery.
      </div>
    </>
  );
}
