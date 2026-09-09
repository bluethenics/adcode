import type { Metadata } from "next";
import { allReleases } from "@/lib/releases";
import { GITHUB_REPO, url } from "@/lib/site";

export const metadata: Metadata = {
  title: "Install on Windows and Linux",
  description: "Install ADCode on Windows or Linux with one terminal command, and review release history.",
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
          <h1>Versions &amp; install</h1>
          <p>ADCode installs from a terminal with one command. It fetches the latest published release, checks it against the checksum published with it, and installs it.</p>
          {latest !== null && <small>Latest release · {latest.version} · <time dateTime={latest.published}>{latest.published}</time></small>}
        </header>

        {/*
          The terminal install is the install, not an alternative to one.
          A file fetched by Invoke-WebRequest or curl carries no Mark of the Web, so
          Windows SmartScreen does not interpose the "Windows protected your PC" dialog
          that an unsigned installer otherwise earns. Combined with a per-user install,
          which needs no elevation, this is a clean install today on builds that are not
          code-signed.
        */}
        <section className="install-terminal glass-card" aria-label="Install from a terminal">
          <div>
            <strong>Install from a terminal</strong>
            <p>One command per platform. macOS is not published yet.</p>
          </div>
          <dl>
            <div>
              <dt>Windows, in PowerShell</dt>
              <dd><code>irm https://adcode.bluethenics.com/install.ps1 | iex</code></dd>
            </div>
            <div>
              <dt>Linux</dt>
              <dd><code>curl -fsSL https://adcode.bluethenics.com/install.sh | sh</code></dd>
            </div>
            <div>
              <dt>macOS</dt>
              <dd>Coming soon — notarisation is still pending.</dd>
            </div>
          </dl>
        </section>

        <section className="release-history">
          <div className="release-history-head"><span className="glass-kicker">Release history</span><a href={`https://github.com/${GITHUB_REPO}/releases`} rel="noreferrer">View source releases ↗</a></div>
          {releases.length === 0 ? (
            <div className="glass-card release-empty"><h2>No published notes yet</h2><p>The install commands above always fetch the latest published release. Release notes will appear here after they are published.</p></div>
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
