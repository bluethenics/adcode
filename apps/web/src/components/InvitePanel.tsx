"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { CopyField } from "@/components/CopyField";
import { moneyExact } from "@/components/money";
import { apiFetch, type ReferralView } from "@/lib/api";
import { clearRef, invitePeopleLine, inviteShareLinks, inviteTerms, progressPost, readRef } from "@/lib/invite";

/**
 * The dashboard's invites: the same link, numbers and terms as the editor's Invite & earn.
 *
 * It also finishes an invite that started on this browser. Someone who followed `/i/<code>`
 * and then signed in here - rather than letting the editor pick the code off the clipboard -
 * has the code remembered by the invite page; it is claimed once, here, and then forgotten.
 */
export function InvitePanel({ progress }: { progress?: { activeMs: number; lifetimeMicros: string } }) {
  const { token } = useAuth();
  const [view, setView] = useState<ReferralView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const t = await token();
    let found = await apiFetch<ReferralView>({ path: "/referrals", token: t });
    if (!found.ok) {
      setState("unavailable");
      return;
    }

    let remembered: string | null = null;
    try {
      remembered = readRef(window.localStorage, Date.now());
    } catch {
      remembered = null;
    }
    if (found.value.canClaim && remembered !== null) {
      const claim = await apiFetch<{ ok: true }>({ path: "/referrals/claim", token: t, method: "POST", body: { code: remembered, how: "web" } });
      // Any definite answer ends it; only a network failure keeps the code for next time.
      if (claim.ok || claim.error !== "offline") {
        try {
          clearRef(window.localStorage);
        } catch {
          // Nothing more to do.
        }
      }
      if (claim.ok) {
        const again = await apiFetch<ReferralView>({ path: "/referrals", token: t });
        if (again.ok) found = again;
      }
    }

    setView(found.value);
    setState("ready");
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleName(showName: boolean): Promise<void> {
    setBusy(true);
    const result = await apiFetch<ReferralView>({ path: "/referrals", token: await token(), method: "PATCH", body: { showName } });
    if (result.ok) setView(result.value);
    setBusy(false);
  }

  if (state === "loading") return <p className="lede">Loading…</p>;
  if (state === "unavailable" || view === null) {
    return <p className="lede">Invites aren&apos;t available right now. Try again in a little while.</p>;
  }

  const share = inviteShareLinks(view.link);
  // Something true and specific to post, with the link in it - shown once there is an hour to mention.
  const post = progress === undefined ? null : progressPost({ ...progress, link: view.link });
  const earned = view.earnedMicros === "0" ? null : `${moneyExact(view.earnedMicros)} earned from invites`;

  return (
    <div className="ios-card invite-panel">
      <CopyField label="Your invite link" value={view.link} />
      <div className="invite-panel-share">
        <a className="btn btn-small" href={share.x} target="_blank" rel="noreferrer">Post on X</a>
        <a className="btn btn-small" href={share.threads} target="_blank" rel="noreferrer">Post on Threads</a>
        <a className="btn btn-small" href={share.email}>Email it</a>
      </div>
      <p className="invite-panel-people"><strong>{invitePeopleLine(view)}</strong></p>
      {earned !== null && (
        <p className="invite-panel-earned money">
          {earned}
          {view.last30Micros !== "0" && <> · {moneyExact(view.last30Micros)} in the last 30 days</>}
        </p>
      )}
      <ul className="invite-panel-terms">
        {inviteTerms(view.rates).map((line) => <li key={line}>{line}</li>)}
      </ul>
      {view.claimed && <p className="invite-panel-invited">{view.invitedBy === null ? "You joined with an invite." : `Invited by ${view.invitedBy}.`}</p>}
      {post !== null && (
        <div className="invite-panel-progress">
          <p className="invite-panel-progress-text">{post}</p>
          <div className="invite-panel-share">
            <button type="button" className="btn btn-small" onClick={() => void navigator.clipboard.writeText(post).catch(() => undefined)}>Copy</button>
            <a className="btn btn-small" href={`https://x.com/intent/post?text=${encodeURIComponent(post)}`} target="_blank" rel="noreferrer">Post on X</a>
          </div>
        </div>
      )}
      <label className="invite-panel-name">
        <input type="checkbox" checked={view.showName} disabled={busy} onChange={(event) => void toggleName(event.target.checked)} />{" "}
        Show my first name on my invite page
      </label>
      <p className="invite-panel-preview">Your invite page says: “{view.inviterPreview}”</p>
    </div>
  );
}
