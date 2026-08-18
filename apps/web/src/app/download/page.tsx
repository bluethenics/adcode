import type { Metadata } from "next";
import { InstallCommand } from "@/components/InstallCommand";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbs } from "@/lib/schema";
import { GITHUB_REPO, url } from "@/lib/site";

export const metadata: Metadata = {
  title: "Download",
  description:
    "Install ADCode on Windows, macOS, or Linux with one line in a terminal. Free, no account required, and it updates itself.",
  alternates: { canonical: url("/download") },
};

const PLATFORMS = [
  {
    id: "windows",
    name: "Windows",
    note: "Windows 10 or later, 64-bit",
    shell: "PowerShell",
    command: "irm https://adcode.dev/install.ps1 | iex",
    direct: `https://github.com/${GITHUB_REPO}/releases/latest`,
  },
  {
    id: "macos",
    name: "macOS",
    note: "macOS 12 or later, Apple silicon and Intel",
    shell: "Terminal",
    command: "curl -fsSL https://adcode.dev/install.sh | sh",
    direct: `https://github.com/${GITHUB_REPO}/releases/latest`,
  },
  {
    id: "linux",
    name: "Linux",
    note: "AppImage and .deb, x86-64",
    shell: "Terminal",
    command: "curl -fsSL https://adcode.dev/install.sh | sh",
    direct: `https://github.com/${GITHUB_REPO}/releases/latest`,
  },
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

      <section className="band band-ink">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Download</p>
            <h1 style={{ fontSize: "clamp(32px, 4.6vw, 52px)" }}>One line, then you are editing.</h1>
            <p className="lede">
              Free, no account required to start, and it keeps itself up to date. Pick your
              platform.
            </p>
          </div>

          <div className="grid grid-3">
            {PLATFORMS.map((platform) => (
              <div
                key={platform.id}
                className="card"
                style={{
                  background: "var(--ink-raised)",
                  borderColor: "var(--ink-hairline)",
                  color: "var(--on-ink)",
                }}
              >
                <h3 style={{ color: "var(--on-ink)" }}>{platform.name}</h3>
                <p style={{ color: "var(--on-ink-muted)", marginBottom: 16 }}>{platform.note}</p>

                <div style={{ marginBottom: 12 }}>
                  <InstallCommand command={platform.command} />
                </div>

                <p style={{ color: "var(--on-ink-muted)", fontSize: 13 }}>
                  Paste into {platform.shell}, or{" "}
                  <a href={platform.direct} style={{ color: "var(--accent)" }}>
                    download the installer
                  </a>
                  .
                </p>
              </div>
            ))}
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
                The default cadence is four cards an hour, none of them during typing or
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
