"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Globe, Monitor } from "lucide";
import { Icon } from "@/components/Icon";
import { SponsoredToastPreview } from "@/components/SponsoredToastPreview";
import { WEB_VERSION_URL } from "@/lib/site";

export interface PreviewAd {
  brand: string;
  headline: string;
  body: string;
  logo: string | null;
}

const CODE = `export async function deploy(env: Env) {
  const build = await bundle("./src");
  await upload(build, env.bucket);
  return verify(env.url);
}`;

const PLACEMENTS = [
  { key: "desktop", name: "Desktop app", icon: Monitor, bar: "ADCode" },
  { key: "browser", name: "Browser editor", icon: Globe, bar: hostOf(WEB_VERSION_URL) },
] as const;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "ADCode in the browser";
  }
}

/**
 * Every ad in every place it serves, one ad at a time with an "Ad 1 of N" pager.
 *
 * The card inside each frame is `SponsoredToastPreview`, the markup that mirrors the
 * editor's own toast, so what is shown here is what a developer sees, at the same size.
 */
export function AdPreviews({ ads, compact = false }: { ads: readonly PreviewAd[]; compact?: boolean }) {
  const [index, setIndex] = useState(0);
  const count = Math.max(ads.length, 1);
  const at = Math.min(index, count - 1);
  const ad = ads[at] ?? { brand: "", headline: "", body: "", logo: null };

  return (
    <section className="ap-previews" data-compact={compact || undefined} aria-label="Ad previews">
      <header className="ap-previews-head">
        <h2>Ad previews</h2>
        {count > 1 && (
          <div className="ap-pager" role="group" aria-label="Choose an ad to preview">
            <button type="button" className="ap-icon-button" aria-label="Previous ad" disabled={at === 0} onClick={() => setIndex(at - 1)}>
              <Icon node={ChevronLeft} />
            </button>
            <span aria-live="polite">Ad {at + 1} of {count}</span>
            <button type="button" className="ap-icon-button" aria-label="Next ad" disabled={at === count - 1} onClick={() => setIndex(at + 1)}>
              <Icon node={ChevronRight} />
            </button>
          </div>
        )}
      </header>
      <div className="ap-placements">
        {PLACEMENTS.map((place) => (
          <figure key={place.key} className="ap-placement">
            <figcaption><Icon node={place.icon} />{place.name}</figcaption>
            <div className="ap-frame" data-kind={place.key}>
              <div className="ap-frame-bar" aria-hidden="true"><i /><i /><i /><span>{place.bar}</span></div>
              <div className="ap-frame-body">
                <pre aria-hidden="true">{CODE}</pre>
                <div className="ap-frame-card">
                  <SponsoredToastPreview brand={ad.brand} headline={ad.headline} body={ad.body} logo={ad.logo} />
                </div>
              </div>
            </div>
          </figure>
        ))}
      </div>
    </section>
  );
}
