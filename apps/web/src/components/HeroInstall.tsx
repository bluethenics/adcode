"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { detectPlatform, installCommand, installRoute, type Platform } from "@/lib/platform";
import { SITE } from "@/lib/site";
import { trackWebsiteEvent } from "@/lib/websiteAnalytics";

/**
 * The one thing the hero asks a visitor to do, chosen for the machine they are on.
 *
 * Every install is a terminal command. There is no file download: the build is
 * unsigned, and a browser download of an unsigned installer earns the SmartScreen dialog
 * that hides Run behind *More info*, where some people stop; a terminal fetch carries no
 * Mark of the Web and raises nothing. So the command is the install, on every platform.
 *
 * - **Windows** gets its PowerShell one-liner with a copy button.
 * - **Linux** gets its shell one-liner with a copy button.
 * - **macOS** gets the truth. Notarisation needs a paid Apple membership and an
 *   un-notarised app is refused outright, so there is no command to offer yet.
 *
 * Before hydration it renders the neutral choice, so the markup is honest on first paint
 * and gets more specific - never wronger - once JavaScript runs.
 */
export function HeroInstall() {
  const [platform, setPlatform] = useState<Platform>("unknown");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => setPlatform(detectPlatform(navigator.userAgent, navigator.maxTouchPoints)), []);

  // The confirmation has to clear itself, or the button reads "Copied" forever and stops
  // being a button that says what it will do.
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const route = installRoute(platform);
  const command = installCommand(platform, SITE.origin);

  async function copy(): Promise<void> {
    if (command === null) return;
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(command);
      trackWebsiteEvent("install_copy");
      setCopied(true);
    } catch {
      // A denied clipboard permission, or an insecure origin. The command is selectable
      // and visible either way, so this costs a keystroke rather than the whole path.
      setCopied(false);
      setCopyFailed(true);
    }
  }

  if (route === "terminal" && command !== null) {
    const isWindows = platform === "windows";
    const shellName = isWindows ? "PowerShell" : "Terminal";
    return (
      <div className="hero-install hero-install-terminal">
        <div className="marketplace-hero-actions">
          <Link href="/versions" className="marketplace-primary">Install for {isWindows ? "Windows" : "Linux"} <span aria-hidden="true">↓</span></Link>
          <a href="#advertise" className="marketplace-secondary">Reach developers <span aria-hidden="true">↗</span></a>
        </div>
        <div className="hero-quick-install">
          <p className="hero-quick-install-label">
            <span className="hero-quick-install-kicker">Quick install</span>
            <span aria-hidden="true"> · </span>copy and paste into {isWindows ? "PowerShell" : "your terminal"}
          </p>
          <div className="hero-quick-install-card">
            <div className="hero-quick-install-bar" aria-hidden="true">
              <span className="hero-quick-install-dots"><i /><i /><i /></span>
              <span className="hero-quick-install-shell">{shellName}</span>
              <span className="hero-quick-install-meta">1 line · ~30s · verified</span>
            </div>
            <div className="hero-install-command">
              <span className="hero-install-prompt" aria-hidden="true">{isWindows ? "PS>" : "$"}</span>
              <code>{command}</code>
              <button type="button" onClick={() => void copy()} aria-label={`Copy ${isWindows ? "PowerShell" : "terminal"} install command`} aria-live="polite" data-copied={copied}>
                <span aria-hidden="true" className="hero-install-copy-icon">{copied ? "✓" : "⧉"}</span>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
          {copyFailed && <p className="hero-install-note" role="status">Copy was blocked. Select the command above and copy it manually.</p>}

          <p className="hero-install-note">
            {isWindows ? (
              <>
                Open <strong>PowerShell</strong>, paste, and press <kbd>Enter</kbd>. It installs for you
                only and checks the download against its published checksum.{" "}
              </>
            ) : (
              <>
                Paste into your shell and press <kbd>Enter</kbd>. It picks the right package for your
                system and verifies it before installing.{" "}
              </>
            )}
            <Link href="/docs/installing-adcode">What this does</Link>
          </p>
        </div>
      </div>
    );
  }

  if (route === "soon") {
    return (
      <div className="hero-install">
        <div className="marketplace-hero-actions">
          <Link href="/versions" className="marketplace-primary is-soon">
            ADCode for macOS — coming soon
          </Link>
          <a href="#advertise" className="marketplace-secondary">
            Advertise to developers <span aria-hidden="true">↘</span>
          </a>
        </div>
        <p className="hero-install-note">
          macOS installs are not available yet. Windows and Linux install from a terminal
          today — see <Link href="/versions">all install options</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="hero-install">
      <div className="marketplace-hero-actions">
        <Link href="/versions" className="marketplace-primary">
          Get ADCode <span aria-hidden="true">↓</span>
        </Link>
        <a href="#advertise" className="marketplace-secondary">
          Advertise to developers <span aria-hidden="true">↘</span>
        </a>
      </div>
    </div>
  );
}
