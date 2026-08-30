import type { Metadata } from "next";
import { DOWNLOADS, downloadHref } from "@/lib/downloads";
import { allReleases } from "@/lib/releases";
import { GITHUB_REPO, url } from "@/lib/site";

export const metadata: Metadata = {
  title: "Download for Windows, macOS and Linux",
  description: "Download ADCode for Windows, macOS, or Linux and review release history.",
  alternates: { canonical: url("/versions") },
};

export default async function VersionsPage() {
  const releases = await allReleases();
  const latest = releases[0] ?? null;

  return (
    <section className="public-glass-page">
      <div className="marketplace-wrap">
        <header className="public-glass-hero">
          <span className="glass-kicker">ADCode desktop</span>
          <h1>Versions &amp; downloads</h1>
          <p>Choose the build for your machine. Downloads are delivered through ADCode from the project&apos;s latest published release.</p>
          {latest !== null && <small>Latest release · {latest.version} · <time dateTime={latest.published}>{latest.published}</time></small>}
        </header>

        {/*
          A platform we cannot ship yet is listed and labelled, not hidden and not linked.
          Hiding it answers "does this run on my Mac?" with silence; linking it hands
          somebody an app Gatekeeper will refuse to open.
        */}
        <div className="download-grid" aria-label="Desktop downloads">
          {DOWNLOADS.map((download) =>
            download.available ? (
              <a className="download-card glass-card" href={downloadHref(download)} key={download.id}>
                <span><strong>{download.platform}</strong><small>{download.detail}</small></span>
                <b aria-hidden="true">↓</b>
              </a>
            ) : (
              <div className="download-card glass-card is-soon" key={download.id} aria-disabled="true">
                <span><strong>{download.platform}</strong><small>{download.detail}</small></span>
                <em>Coming soon</em>
              </div>
            ),
          )}
        </div>

        {/*
          The terminal install, given equal billing rather than buried.

          It is not a convenience here, it is the path that works: a file fetched by
          Invoke-WebRequest or curl carries no Mark of the Web, so Windows SmartScreen does
          not interpose the "Windows protected your PC" dialog that an unsigned installer
          otherwise earns. Combined with a per-user NSIS install, which needs no elevation,
          this is a clean install today on builds that are not code-signed.
        */}
        <section className="install-terminal glass-card" aria-label="Install from a terminal">
          <div>
            <strong>Or install from a terminal</strong>
            <p>Fetches the same release, checks it against the checksum published with it, and skips the browser download warning.</p>
          </div>
          <dl>
            <div>
              <dt>Windows</dt>
              <dd><code>irm https://adcode.bluethenics.com/install.ps1 | iex</code></dd>
            </div>
            <div>
              <dt>Linux</dt>
              <dd><code>curl -fsSL https://adcode.bluethenics.com/install.sh | sh</code></dd>
            </div>
          </dl>
        </section>

        <section className="release-history">
          <div className="release-history-head"><span className="glass-kicker">Release history</span><a href={`https://github.com/${GITHUB_REPO}/releases`} rel="noreferrer">View source releases ↗</a></div>
          {releases.length === 0 ? (
            <div className="glass-card release-empty"><h2>No published notes yet</h2><p>The download links above always request the latest available installer. Release notes will appear here after they are published.</p></div>
          ) : releases.map((release, index) => (
            <article className="glass-card release-card" key={`${release.version}-${release.publishedAt}`}>
              <div className="release-meta"><span>{index === 0 ? "Latest" : "Release"}</span><time dateTime={release.published}>{release.published}</time></div>
              <div><h2>{release.version} · {release.title}</h2><p>{release.body}</p>
                {release.highlights.length > 0 && <ul>{release.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul>}
              </div>
            </article>
          ))}
        </section>
      </div>
    </section>
  );
}
