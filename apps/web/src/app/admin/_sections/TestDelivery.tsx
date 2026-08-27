"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPicker } from "@/components/UserPicker";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES, type CreativeView } from "@/lib/api";

/**
 * Sending a test ad to a running editor.
 *
 * Honest about what it can and cannot do: the server can put a creative at the front of
 * the queue for one user, but it cannot make the editor interrupt them. The editor's own
 * scheduler decides that, and it will not interrupt typing or a debug session no matter
 * who asks.
 *
 * It no longer has to wait out the *cadence*, though. A test card is flagged on the wire
 * and skips the minimum gap and the daily cap - so the copy no longer advises turning the
 * frequency up to Max, which was a workaround for a gap in the product printed inside the
 * product. What it still waits for is a pause, which is the thing that must not change.
 */
export function TestAdsBody() {
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
    /*
     * Deliberately no default any more.
     *
     * This used to preselect the admin's own web uid, which looks helpful and is the
     * reason test cards vanished: the person driving admin is signed in on the website
     * and their editor is signed in as something else - often an anonymous account made
     * silently on first launch. The card was queued to an account that never asks for
     * one, and the screen said "Queued." Making it an explicit choice costs one click
     * and removes a failure with no symptom.
     */
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
          Queued. The editor picks it up the next time it asks for cards — within about ten
          minutes, and sooner if it has run out. A test card then skips the frequency
          limits, but it will not appear while they are debugging, or while their editor is
          not the window in front. Typing does not hold it back — a card arrives mid-work
          without taking the caret.
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

          <UserPicker
            value={targetUid}
            onChange={setTargetUid}
            hint="The account signed in to the editor you want the card to appear in - which is usually not the one you are signed in as here. Search by name or address, or paste the id. An editor that has never been signed in to has neither, so it shows its own id under the earnings button in its status bar - that is the only way to identify it."
          />

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
