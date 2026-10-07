"use client";

import { useEffect, useState, type ReactNode } from "react";
import { HeroInstall } from "@/components/HeroInstall";
import { inviteHeadline, rememberRef, type InviteLookup } from "@/lib/invite";

/**
 * The top of an invite page: who sent it, the download that carries the code, and the code
 * itself for anyone whose clipboard did not make the trip.
 *
 * The lookup runs in the browser, after first paint, so the page is the ordinary hero for a
 * moment and then names the inviter. A dead or unknown code never becomes an error: it is
 * simply the homepage's hero, because a stale link should still sell ADCode.
 */
export function InviteHero({ code, children }: { code: string | null; children?: ReactNode }) {
  const [lookup, setLookup] = useState<InviteLookup | null>(null);

  useEffect(() => {
    if (code === null) return;
    try {
      rememberRef(window.localStorage, code, Date.now());
    } catch {
      // Storage blocked entirely: the clipboard and the code on the page still carry it.
    }
    let live = true;
    fetch(`/v1/invite/${encodeURIComponent(code)}`, { credentials: "omit" })
      .then((response) => (response.ok ? (response.json() as Promise<InviteLookup>) : null))
      .then((found) => {
        if (live) setLookup(found);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [code]);

  const headline = inviteHeadline(lookup);
  const carried = lookup?.valid === true && code !== null ? code : undefined;

  return (
    <section className="marketplace-hero studio-hero" id="earn">
      <div className="marketplace-wrap" id="marketplace-main">
        <div className="studio-hero-top">
          <div className="marketplace-hero-copy">
            {headline !== null && (
              <p className="marketplace-eyebrow" data-testid="invite-headline">
                <span aria-hidden="true" />
                {headline}
              </p>
            )}
            <h1>The free AI code editor<br />that pays you to build.</h1>
            <p>
              Describe your idea and watch it get built - with AI agents, real terminals and git. Free from the
              first line, with a free AI key in about a minute and no card, and it pays you half of the ad
              revenue it earns.
            </p>
            <HeroInstall source="invite" {...(carried === undefined ? {} : { invite: carried })} />
            {carried !== undefined && (
              <p className="hero-install-note" data-testid="invite-code">
                Your invite code: <strong><code>{carried}</code></strong>. ADCode picks it up by itself when it
                opens. If it asks, paste it.
              </p>
            )}
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}
