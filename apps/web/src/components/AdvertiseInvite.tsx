"use client";

import { useEffect, useState } from "react";
import { AdvertiseSection } from "@/components/AdvertiseSection";
import { adsHeadline, rememberRef, type InviteLookup } from "@/lib/invite";

/**
 * The advertiser offer, reached through somebody's invite. The code is remembered as the
 * page opens, so the campaign builder - or a portal sign-up later - credits whoever sent it.
 */
export function AdvertiseInvite({ code }: { code: string | null }) {
  const [lookup, setLookup] = useState<InviteLookup | null>(null);

  useEffect(() => {
    if (code === null) return;
    try {
      rememberRef(window.localStorage, code, Date.now());
    } catch {
      // Storage blocked: a ?ref= on this page still reaches the sign-up.
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

  return <AdvertiseSection eyebrow={adsHeadline(lookup)} />;
}
