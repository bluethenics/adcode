import { IMPACT_LABELS, INCIDENT_STATUS_LABELS, readStatus } from "@/lib/status";
import { SITE, url } from "@/lib/site";

/**
 * `/status/feed.xml` - incident updates, for people who want to be told.
 *
 * The status page's "Subscribe to updates" points here. Same reasoning as `/feed.xml`:
 * RSS 2.0 because every reader accepts it, one item per update because that is the unit
 * somebody needs to know about, and a channel that stays valid with no items so a reader
 * polling during a quiet week is not handed an error it might unsubscribe over.
 *
 * The API is read through the same cached reader the page uses, so the feed and the page
 * can never tell two different stories about one incident.
 */
export const dynamic = "force-static";
/** Kept rendered, and re-rendered at most once a minute so an update posted in the panel shows up. */
export const revalidate = 60;

/** XML has five characters that cannot appear raw, and a sentence will contain them. */
const escape = (raw: string): string =>
  raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const rfc822 = (ms: number): string => new Date(ms).toUTCString();

export async function GET(): Promise<Response> {
  const status = await readStatus();

  const items = (status?.incidents ?? [])
    .flatMap((incident) =>
      incident.updates.map((update) => ({
        title: `${incident.title}: ${INCIDENT_STATUS_LABELS[update.status] ?? update.status}`,
        link: url(`/status#${incident.incidentId}`),
        guid: `${url("/status")}#${update.updateId}`,
        description: `${update.body} (${IMPACT_LABELS[incident.impact] ?? incident.impact} impact.)`,
        date: update.createdAt,
      })),
    )
    .sort((a, b) => b.date - a.date)
    .slice(0, 50)
    .map(
      (item) => `    <item>
      <title>${escape(item.title)}</title>
      <link>${escape(item.link)}</link>
      <guid isPermaLink="false">${escape(item.guid)}</guid>
      <pubDate>${rfc822(item.date)}</pubDate>
      <description>${escape(item.description)}</description>
    </item>`,
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escape(`${SITE.name} status`)}</title>
    <link>${url("/status")}</link>
    <atom:link href="${url("/status/feed.xml")}" rel="self" type="application/rss+xml" />
    <description>${escape("Incident updates for ADCode, published as they are posted.")}</description>
    <language>${SITE.locale.replace("_", "-")}</language>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
}
