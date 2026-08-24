import type { Metadata } from "next";
import { allReleases } from "@/lib/releases";
import { renderMarkdown } from "@/lib/markdown";
import { JsonLd } from "@/components/JsonLd";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DocsSidebar } from "@/components/DocsSidebar";
import { ReadingProgress } from "@/components/ReadingProgress";
import { breadcrumbs, changelog } from "@/lib/schema";
import { url } from "@/lib/site";

export const metadata: Metadata = {
  title: "Changelog",
  description:
    "Every ADCode release, newest first: what changed, when it shipped, and which versions were security fixes. The same notes the editor shows under Help, on a page anyone can read without installing anything.",
  alternates: { canonical: url("/changelog") },
  openGraph: { title: "ADCode Changelog", url: url("/changelog"), type: "website" },
};

const dateLabel = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

/**
 * The public changelog.
 *
 * Deliberately one page rather than a page per version. A changelog is read by scrolling —
 * somebody catching up on three releases wants them in one place, and a version that is
 * only a line long does not deserve a URL of its own. Each version still gets an anchor,
 * so a link to a specific release works.
 */
export default async function Changelog() {
  const releases = await allReleases();

  return (
    <>
      <ReadingProgress />
      <JsonLd
        data={breadcrumbs([
          { name: "Home", path: "/" },
          { name: "Changelog", path: "/changelog" },
        ])}
      />
      {releases.length > 0 && <JsonLd data={changelog(releases)} />}

      <section className="docs-page band">
        <div className="wrap docs-layout">
          <DocsSidebar reading="changelog" />
          <main className="docs-content">
            <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Changelog" }]} />

            <div className="docs-header">
              <h1 style={{ fontSize: "clamp(30px, 4.2vw, 46px)" }}>What changed, and when</h1>
              <p className="lede">
                Every release, newest first. The editor shows the same notes under Help
                &rarr; What&apos;s New, and mentions a new version at most once — never
                while you are typing.
              </p>
            </div>

          {releases.length === 0 ? (
            <div className="empty" style={{ marginTop: 34 }}>
              <h3>No releases published yet</h3>
              <p>
                Release notes appear here as versions ship. Until then,{" "}
                <a href="/download">the download page</a> always has the current build.
              </p>
            </div>
          ) : (
            <div style={{ marginTop: 40 }}>
              {releases.map((release) => (
                <article
                  key={release.version}
                  id={`v${release.version}`}
                  className="rise"
                  style={{
                    paddingBottom: 34,
                    marginBottom: 34,
                    borderBottom: "1px solid var(--hairline)",
                    scrollMarginTop: 90,
                  }}
                >
                  <div
                    className="mono"
                    style={{
                      fontSize: 12,
                      color: "var(--faint)",
                      marginBottom: 10,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <a href={`#v${release.version}`} style={{ color: "inherit" }}>
                      {release.version}
                    </a>
                    <time dateTime={release.published}>{dateLabel(release.published)}</time>
                    {release.critical && (
                      <span className="pill" data-tone="live">
                        Security
                      </span>
                    )}
                  </div>

                  <h2 style={{ fontSize: "clamp(21px, 2.4vw, 27px)", marginBottom: 12 }}>
                    {release.title}
                  </h2>

                  {release.highlights.length > 0 && (
                    <ul
                      style={{
                        margin: "0 0 16px",
                        paddingLeft: 20,
                        color: "var(--muted)",
                        fontSize: 16,
                        lineHeight: 1.65,
                      }}
                    >
                      {release.highlights.map((highlight) => (
                        <li key={highlight}>{highlight}</li>
                      ))}
                    </ul>
                  )}

                  {release.body.trim().length > 0 && (
                    <div
                      className="prose"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(release.body) }}
                    />
                  )}
                </article>
              ))}
            </div>
          )}
          </main>
        </div>
      </section>
    </>
  );
}
