import { downloadFor } from "@/lib/downloads";
import { GITHUB_REPO } from "@/lib/site";

/**
 * The download, served from this domain.
 *
 * Releases live on GitHub because that is where the build publishes them, but nobody
 * downloading an editor should have to know that. Before this, every download button was
 * a link to `github.com/.../releases/latest/download/...`: the URL flashed in the status
 * bar, the file landed in the browser's download list attributed to another site, and
 * anyone behind a network that blocks GitHub simply could not install the product.
 *
 * So the Worker fetches the asset and streams it back. The response body is piped, never
 * buffered - the Windows installer is around a hundred megabytes and a Worker has a few
 * dozen of memory, so `await response.arrayBuffer()` here would work on a developer's
 * machine and fail in production on the largest and most-downloaded file.
 *
 * A redirect would have been simpler and is not enough: the browser follows it, and the
 * address it records is the one it ends up at.
 */

/*
 * The platform list lives in `@/lib/downloads` now.
 *
 * It was duplicated here and in the download cards, with the asset filenames written out
 * twice - which is two places to update and one place to forget, on the strings that
 * decide whether a download 404s.
 */
export type Platform = string;


/**
 * Streamed rather than cached at the edge.
 *
 * `force-dynamic` because the upstream is "whatever `latest` points at", and a build-time
 * snapshot of that would serve the release that was current when the site was deployed
 * for as long as it stayed deployed.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ platform: string }> },
): Promise<Response> {
  const { platform } = await params;
  const target = downloadFor(platform);

  if (target === undefined) {
    return new Response("Unknown platform.", { status: 404 });
  }

  /*
   * A platform we list but cannot ship yet.
   *
   * 503 rather than 404: the URL is right and will work later, which is what a "Retry-After
   * unknown" service-unavailable says and what a "no such thing" does not. A crawler that
   * saw a 404 here would drop the URL.
   */
  if (!target.available) {
    return new Response(
      `ADCode for ${target.platform} (${target.detail}) is not published yet. See /versions.`,
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const upstream = `https://github.com/${GITHUB_REPO}/releases/latest/download/${target.asset}`;

  let response: Response;
  try {
    response = await fetch(upstream, { redirect: "follow" });
  } catch {
    return new Response("Could not reach the download server. Try again shortly.", {
      status: 502,
    });
  }

  if (!response.ok || response.body === null) {
    // The usual cause is a release that has not published this platform's asset yet, and
    // the download page is where someone can see which ones exist.
    return new Response("That build isn't published yet. See /versions for what is.", {
      status: 404,
    });
  }

  const headers = new Headers({
    "content-type": target.type,
    "content-disposition": `attachment; filename="${target.asset}"`,
    // The installer for a given release never changes; `latest` pointing somewhere else
    // is a different URL as far as this cache is concerned only if we say so, hence the
    // short window rather than a long one.
    "cache-control": "public, max-age=300",
    "x-content-type-options": "nosniff",
  });

  // Passed through so the browser can draw a real progress bar instead of a spinner.
  const length = response.headers.get("content-length");
  if (length !== null) headers.set("content-length", length);

  return new Response(response.body, { status: 200, headers });
}
