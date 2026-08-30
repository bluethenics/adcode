"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { downloadFor } from "@/lib/downloads";
import { detectPlatform, installCommand, installRoute, type Platform } from "@/lib/platform";
import { SITE } from "@/lib/site";

/**
 * The one thing the hero asks a visitor to do, chosen for the machine they are on.
 *
 * Three different offers, because the three platforms are in genuinely different states
 * and a single "Download" button would be wrong on two of them:
 *
 * - **Windows** gets the command, not a button. The build is unsigned, and a browser
 *   download of an unsigned installer earns the SmartScreen dialog that hides Run behind
 *   *More info* - where most people stop. A terminal fetch carries no Mark of the Web and
 *   raises nothing, so it is the better path today and it is what the hero leads with.
 * - **Linux** gets the button. Nothing to sign, nothing to warn about.
 * - **macOS** gets the truth. Notarisation needs a paid Apple membership and an
 *   un-notarised app is refused outright, so a download button would hand somebody a file
 *   their machine will not open.
 *
 * Before hydration it renders the neutral choice, so the markup is honest on first paint
 * and gets more specific - never wronger - once JavaScript runs.
 */
export function HeroInstall() {
  const [platform, setPlatform] = useState<Platform>("unknown");
  const [copied, setCopied] = useState(false);

  useEffect(() => setPlatform(detectPlatform(navigator.userAgent)), []);

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
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      // A denied clipboard permission, or an insecure origin. The command is selectable
      // and visible either way, so this costs a keystroke rather than the whole path.
      setCopied(false);
    }
  }

  if (route === "terminal" && command !== null) {
    return (
      <div className="hero-install hero-install-terminal">
        <p className="hero-install-lead">Paste this into your terminal to install ADCode.</p>

        <div className="hero-install-command">
          <code>{command}</code>
          <button type="button" onClick={() => void copy()} aria-live="polite">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <p className="hero-install-note">
          Open <strong>PowerShell</strong>, paste, and press Enter. It installs for you only, so
          Windows asks for no administrator password and shows no security warning.{" "}
          <Link href="/docs/installing-adcode">What this does</Link>
        </p>
      </div>
    );
  }

  if (route === "download") {
    const target = downloadFor(platform);
    return (
      <div className="hero-install">
        <div className="marketplace-hero-actions">
          <a href={`/dl/${platform}`} className="marketplace-primary">
            Download for Linux <span aria-hidden="true">↓</span>
          </a>
          <a href="#advertise" className="marketplace-secondary">
            Advertise to developers <span aria-hidden="true">↘</span>
          </a>
        </div>
        <p className="hero-install-note">
          {target?.detail ?? "AppImage"}. Or install from a terminal:{" "}
          <code>{installCommand("linux", SITE.origin)}</code>
        </p>
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
          macOS builds need Apple notarisation before they will open at all, and that is not in
          place yet. Windows and Linux are available today.
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
