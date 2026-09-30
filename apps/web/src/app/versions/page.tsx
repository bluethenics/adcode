import type { Metadata } from "next";
import { allReleases } from "@/lib/releases";
import { GITHUB_REPO, SITE, url } from "@/lib/site";
import { InstallCommand } from "@/components/InstallCommand";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbs, changelog, faqPage, installHowTo } from "@/lib/schema";
import { pageMetadata } from "@/lib/seo";
import { renderMarkdown } from "@/lib/markdown";

const WINDOWS_COMMAND = `irm ${url("/install.ps1")} | iex`;
const LINUX_COMMAND = `curl -fsSL ${url("/install.sh")} | sh`;

/*
 * "Download" leads the title because it is the word in the query. Nobody searches for
 * "versions"; the people who land here typed "download <editor>" or "install <editor> on
 * linux", and a title that names neither loses to one that does.
 */
export const metadata: Metadata = pageMetadata({
  path: "/versions",
  title: { absolute: `Download ${SITE.name} for Windows and Linux - free AI code editor` },
  socialTitle: `Download ${SITE.name}`,
  description:
    "Install ADCode, the free AI code editor, on Windows or Linux with one terminal command. Checksum-verified, and it updates itself. Release notes for every version.",
});

/** The install, as steps. Printed on the page and serialised as `HowTo` from this one list. */
const STEPS: readonly { name: string; text: string }[] = [
  {
    name: "Open a terminal",
    text: "On Windows open PowerShell - no administrator rights needed. On Linux open any shell.",
  },
  {
    name: "Run the install command",
    text: `On Windows run: ${WINDOWS_COMMAND}. On Linux run: ${LINUX_COMMAND}. The script downloads the latest release and checks its SHA-256 checksum before running anything.`,
  },
  {
    name: "Start ADCode",
    text: "Launch ADCode from the Start menu on Windows, or from your applications menu or the adcode command on Linux. Open a project folder, and connect an AI provider with your own key when you want the assistant.",
  },
];

/*
 * Questions this page is the answer to. Rendered below *and* emitted as FAQPage from the
 * same array, because Google treats marked-up questions that are not visible on the page
 * as a structured-data violation.
 */
const INSTALL_FAQ: readonly { q: string; a: string }[] = [
  {
    q: "What do I need to run ADCode?",
    a: "64-bit Windows 10 or 11, or a 64-bit x86 Linux desktop. On Debian and Ubuntu the installer uses the .deb package; on other distributions it installs an AppImage. There is no arm64 Linux build yet, and macOS is not published yet.",
  },
  {
    q: "Is ADCode free to download?",
    a: "Yes. ADCode is free with no subscription, trial or paid tier. It is funded by an occasional sponsored card in the corner of the editor, and half of that ad revenue is credited to you.",
  },
  {
    q: "Is the ADCode install command safe to run?",
    a: "The script is served from this site, and you can read it at /install.ps1 or /install.sh before running it. It downloads the latest published release and refuses to install it unless its SHA-256 checksum matches the one published with it. Windows installers are not code-signed yet, which is why the terminal install is the recommended route.",
  },
  {
    q: "How does ADCode update?",
    a: "ADCode checks for new releases by itself. When an update has downloaded, a Restart to update button appears in the status bar, and it never restarts over unsaved work.",
  },
  {
    q: "When will ADCode be available for macOS?",
    a: "macOS builds are waiting on Apple notarisation. Until then ADCode installs on Windows and Linux only, and this page will carry the macOS command as soon as it exists.",
  },
];

export default async function VersionsPage() {
  const releases = await allReleases();
  const latest = releases[0] ?? null;

  return (
    <section className="public-glass-page">
      <JsonLd
        data={breadcrumbs([
          { name: "Home", path: "/" },
          { name: "Download", path: "/versions" },
        ])}
      />
      <JsonLd data={installHowTo(STEPS)} />
      <JsonLd data={faqPage(INSTALL_FAQ)} />
      {releases.length > 0 && <JsonLd data={changelog(releases.slice(0, 10))} />}
      <div className="marketplace-wrap">
        <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Download" }]} />
        <header className="public-glass-hero">
          <span className="glass-kicker">ADCode desktop · free AI code editor</span>
          <h1>Download ADCode</h1>
          <p>ADCode installs from a terminal with one command on Windows and Linux. It fetches the latest published release, checks it against the checksum published with it, and installs it - no account and nothing to pay.</p>
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
            <p>Windows installers are not code-signed yet. The install command verifies the downloaded file against its published checksum.</p>
          </div>
          <dl>
            <div>
              <dt>Windows, in PowerShell</dt>
              <dd><InstallCommand command={WINDOWS_COMMAND} /></dd>
            </div>
            <div>
              <dt>Linux</dt>
              <dd><InstallCommand command={LINUX_COMMAND} /></dd>
            </div>
            <div>
              <dt>macOS</dt>
              <dd>Coming soon — notarisation is still pending.</dd>
            </div>
          </dl>
        </section>

        <section className="install-terminal glass-card" aria-label="Remove from a terminal">
          <div>
            <strong>Remove from a terminal</strong>
            <p>Close ADCode first, then run the command for your installation in an external terminal. Your projects and your account are left alone.</p>
          </div>
          <dl>
            <div>
              <dt>Windows, in PowerShell</dt>
              <dd><code>winget uninstall --name ADCode</code></dd>
            </div>
            <div>
              <dt>Linux, from the Debian package</dt>
              <dd><code>sudo apt remove adcode</code></dd>
            </div>
            <div>
              <dt>Linux, AppImage installed by the command above</dt>
              <dd><code>rm -- &quot;$HOME/.local/bin/adcode&quot;</code></dd>
            </div>
          </dl>
        </section>

        {/* The same steps the HowTo data states, with the anchors its step URLs point at. */}
        <section className="install-terminal glass-card" aria-labelledby="install-steps-heading">
          <div>
            <strong id="install-steps-heading">How to install {SITE.name}, step by step</strong>
            <p>About two minutes, start to finish.</p>
          </div>
          <dl>
            {STEPS.map((step, index) => (
              <div key={step.name} id={`step-${String(index + 1)}`}>
                <dt>Step {index + 1} · {step.name}</dt>
                <dd>{step.text}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="landing-faq" aria-labelledby="install-faq-heading">
          <h2 id="install-faq-heading">Install questions</h2>
          <dl>
            {INSTALL_FAQ.map((item) => (
              <div key={item.q}>
                <dt>{item.q}</dt>
                <dd>{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="release-history">
          <div className="release-history-head"><span className="glass-kicker">Release history</span><a href={`https://github.com/${GITHUB_REPO}/releases`} rel="noreferrer">View source releases ↗</a></div>
          {releases.length === 0 ? (
            <div className="glass-card release-empty"><h2>No published notes yet</h2><p>The install commands above always fetch the latest published release. Release notes will appear here after they are published.</p></div>
          ) : releases.map((release, index) => (
            <article className="glass-card release-card" key={`${release.version}-${release.publishedAt}`}>
              <div className="release-meta"><span>{index === 0 ? "Latest" : "Release"}</span><time dateTime={release.published}>{release.published}</time></div>
              {/* Release notes are written in markdown in the admin panel; printed raw, a crawler indexed the `###`. */}
              <div><h2>{release.version} · {release.title}</h2><div className="release-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(release.body) }} />
                {release.highlights.length > 0 && <ul>{release.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul>}
              </div>
            </article>
          ))}
        </section>
      </div>
    </section>
  );
}
