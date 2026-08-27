import type { Metadata } from "next";
import { DOWNLOADS } from "@/lib/downloads";
import { allReleases } from "@/lib/releases";
import { GITHUB_REPO, url } from "@/lib/site";

export const metadata: Metadata = {
  title: "Versions and downloads",
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

        <div className="download-grid" aria-label="Desktop downloads">
          {DOWNLOADS.map((download) => (
            <a className="download-card glass-card" href={download.href} key={download.href}>
              <span><strong>{download.platform}</strong><small>{download.detail}</small></span>
              <b aria-hidden="true">↓</b>
            </a>
          ))}
        </div>

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
