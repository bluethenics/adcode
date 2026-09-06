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
 * - **Windows** leads with the command and offers the installer underneath it. The build is
 *   unsigned, and a browser download of an unsigned installer earns the SmartScreen dialog
 *   that hides Run behind *More info*, where some people stop; a terminal fetch carries no
 *   Mark of the Web and raises nothing. So the command leads because it is the path with
 *   no warning - but refusing to offer a download at all turns away everybody who does not
 *   want a terminal, which is most people. The button says what the dialog will look like
 *   and how to get past it, which costs one line and one click.
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

        {/*
          The installer, for people who would rather click than paste - which is most
          people, and not wanting a terminal is not a reason to be turned away.

          Secondary rather than primary, and the note says why in one line rather than
          leaving somebody to meet the dialog cold. This is the same file the command
          fetches; the only difference is that a browser marks it as downloaded, and that
          mark is what Windows reacts to.
        */}
        <div className="hero-install-or">
          <a href="/dl/windows" className="marketplace-secondary hero-install-download">
            Download the installer <span aria-hidden="true">↓</span>
          </a>
          <span className="hero-install-note">
            109 MB. Windows will say <strong>“Windows protected your PC”</strong> — choose{" "}
            <strong>More info</strong>, then <strong>Run anyway</strong>. The command above
            avoids that entirely.
          </span>
        </div>
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
          macOS downloads are not available yet. Windows and Linux downloads are available
          today.
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
