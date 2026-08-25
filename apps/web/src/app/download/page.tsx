import type { Metadata } from "next";
import { InstallCommand } from "@/components/InstallCommand";
import { JsonLd } from "@/components/JsonLd";
import { DownloadButton } from "@/components/DownloadButton";
import { DesktopMockup } from "@/components/DesktopMockup";
import { breadcrumbs } from "@/lib/schema";
import { SITE_ORIGIN, url } from "@/lib/site";

/** Built from SITE_ORIGIN so the domain is stated once, in site.ts. */
const PS_INSTALL = `irm ${SITE_ORIGIN}/install.ps1 | iex`;
const SH_INSTALL = `curl -fsSL ${SITE_ORIGIN}/install.sh | sh`;

export const metadata: Metadata = {
  title: "Download",
  description:
    "Download ADCode for Windows, macOS, or Linux. One click, no account required, and it updates itself.",
  alternates: { canonical: url("/download") },
};

/**
 * Every build, by name.
 *
 * The hrefs point at this site's own `/dl/*`, which streams the file back. Where the
 * build is actually published is an implementation detail of the release process and has
 * no business in a download link.
 */
const BUILDS = [
  { id: "windows", name: "Windows", note: "Windows 10 or later · 64-bit installer" },
  { id: "macos", name: "macOS", note: "Apple silicon · macOS 12 or later" },
  { id: "macos-intel", name: "macOS", note: "Intel · macOS 12 or later" },
  { id: "linux", name: "Linux", note: "AppImage · x86-64" },
  { id: "linux-deb", name: "Linux", note: "Debian and Ubuntu · .deb" },
] as const;

export default function DownloadPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbs([
          { name: "Home", path: "/" },
          { name: "Download", path: "/download" },
        ])}
      />

      <section className="download-hero band-night">
        <div className="wrap download-hero-grid">
          <div>
            <div className="section-head">
              <p className="eyebrow">Download</p>
              <h1 className="page-title">Download the editor. Keep the upside.</h1>
              <p className="lede">
                Free, no account required to start, and it keeps itself up to date. One
                button — we already know which build you need.
              </p>
            </div>

            <div className="hero-actions" style={{ marginBottom: 22 }}>
              <DownloadButton className="btn btn-primary btn-large hero-download">
                <span aria-hidden="true">↓</span> Download ADCode <i>· free</i>
              </DownloadButton>
            </div>

            <DesktopMockup className="desktop-mockup--compact" />
          </div>

          <div className="ios-card download-card">
            <h3>Every build</h3>
            <p className="field-hint" style={{ marginBottom: 14 }}>
              On a different machine than this one? Take the file straight from here.
            </p>

            <ul className="ios-group">
              {BUILDS.map((build) => (
                <li key={build.id}>
                  <a href={`/dl/${build.id}`} className="ios-row">
                    <span>
                      <strong>{build.name}</strong>
                      <small>{build.note}</small>
                    </span>
                    <span className="ios-row-action" aria-hidden="true">
                      ↓
                    </span>
                  </a>
                </li>
              ))}
            </ul>

            {/*
              The terminal path is real and stays available - it verifies the download
              against the published checksum, which a browser download cannot. It is
              folded away because it is the answer to a question most people are not
              asking, and putting a shell command in front of everyone teaches them that
              installing this is a technical operation.
            */}
            <details className="ios-disclosure">
              <summary>Install from a terminal instead</summary>
              <p className="field-hint">
                Checks the download against its published SHA-256 before running anything.
              </p>
              <p className="field-hint" style={{ marginTop: 12, marginBottom: 4 }}>
                Windows · PowerShell
              </p>
              <InstallCommand command={PS_INSTALL} />
              <p className="field-hint" style={{ marginTop: 12, marginBottom: 4 }}>
                macOS and Linux · Terminal
              </p>
              <InstallCommand command={SH_INSTALL} />
            </details>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head">
            <h2>What happens after you install</h2>
          </div>

          <dl className="rule-list">
            <div className="rule">
              <dt className="rule-term">It updates itself</dt>
              <dd className="rule-desc" style={{ margin: 0 }}>
                New versions install in the background and apply on the next restart. You can
                turn automatic updates off in settings and update on your own schedule.
              </dd>
            </div>
            <div className="rule">
              <dt className="rule-term">No account, no wall</dt>
              <dd className="rule-desc" style={{ margin: 0 }}>
                An anonymous account is created on first launch so earnings have somewhere to
                go. There is nothing to sign up for and nothing to dismiss.
              </dd>
            </div>
            <div className="rule">
              <dt className="rule-term">Ads start off quiet</dt>
              <dd className="rule-desc" style={{ margin: 0 }}>
                The default cadence is six cards an hour, none of them during typing or
                debugging. Change it, or switch it off, in settings at any time.
              </dd>
            </div>
            <div className="rule">
              <dt className="rule-term">Windows will warn you the first time</dt>
              <dd className="rule-desc" style={{ margin: 0 }}>
                Builds are not yet code-signed, so SmartScreen shows an &ldquo;unrecognised
                app&rdquo; notice. Choose <strong>More info</strong> then{" "}
                <strong>Run anyway</strong>. We would rather say this here than have it
                surprise you.
              </dd>
            </div>
          </dl>
        </div>
      </section>
    </>
  );
}
