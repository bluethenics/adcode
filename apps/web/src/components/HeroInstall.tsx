"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { detectPlatform, installCommand, installRoute, LINUX_DOWNLOADS, MICROSOFT_STORE, type Platform } from "@/lib/platform";
import { GITHUB_REPO, SITE } from "@/lib/site";
import { trackWebsiteEvent } from "@/lib/websiteAnalytics";

/**
 * The one thing the page asks a visitor to do, chosen for the machine they are on.
 *
 * - **Windows** gets one button: the Microsoft Store's web installer. The Store package is
 *   signed by Microsoft, so the download raises no SmartScreen dialog, and the Store keeps
 *   ADCode updated. After the click the button turns into the three steps that remain,
 *   because a download that finished in a tray nobody looked at is where installs are lost.
 * - **Linux** gets the .deb and the AppImage as direct downloads.
 * - **Phones** - most of the visitors a post brings - cannot run a desktop editor, so they
 *   get a way to send the link to their computer instead of a page of commands.
 * - **macOS** gets the truth: notarisation is pending.
 *
 * The terminal command is still one click away on Windows and Linux for people who prefer
 * it. Before hydration it renders the neutral choice, so first paint is honest and only
 * gets more specific once JavaScript runs.
 */
export function HeroInstall({ source = "hero", advertise = true }: { source?: string; advertise?: boolean }) {
  const [platform, setPlatform] = useState<Platform>("unknown");
  useEffect(() => setPlatform(detectPlatform(navigator.userAgent, navigator.maxTouchPoints)), []);

  const route = installRoute(platform);
  const secondary = advertise ? (
    <a href="/#advertise" className="marketplace-secondary" onClick={() => trackWebsiteEvent("advertise_click")}>
      Advertise to developers <span aria-hidden="true">↘</span>
    </a>
  ) : null;

  if (route === "store") return <WindowsInstall source={source} secondary={secondary} />;
  if (route === "download") return <LinuxInstall secondary={secondary} />;
  if (route === "send") return <SendToDesktop secondary={secondary} />;

  if (route === "soon") {
    return (
      <div className="hero-install">
        <div className="marketplace-hero-actions">
          <Link href="/versions" className="marketplace-primary is-soon">ADCode for macOS is coming soon</Link>
          {secondary}
        </div>
        <p className="hero-install-note">
          macOS builds are waiting on Apple notarisation. ADCode installs on Windows and Linux
          today. See <Link href="/versions">every install option</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="hero-install">
      <div className="marketplace-hero-actions">
        <Link href="/versions" className="marketplace-primary install-cta">
          Download ADCode <span aria-hidden="true">↓</span>
        </Link>
        {secondary}
      </div>
    </div>
  );
}

function WindowsLogo() {
  return (
    <svg className="install-cta-logo" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M0 2.2 6.5 1.3v6.2H0zM7.3 1.2 16 0v7.5H7.3zM0 8.3h6.5v6.3L0 13.7zM7.3 8.3H16V16l-8.7-1.2z" fill="currentColor" />
    </svg>
  );
}

function WindowsInstall({ source, secondary }: { source: string; secondary: React.ReactNode }) {
  const [started, setStarted] = useState(false);
  const [terminal, setTerminal] = useState(false);

  return (
    <div className="hero-install" data-started={started}>
      <div className="marketplace-hero-actions">
        <a
          href={MICROSOFT_STORE.installerUrl(source)}
          className="marketplace-primary install-cta"
          onClick={() => {
            trackWebsiteEvent("download_click");
            setStarted(true);
          }}
        >
          <WindowsLogo />
          <span className="install-cta-label">
            Download for Windows
            <small>Free · Microsoft Store</small>
          </span>
        </a>
        {secondary}
      </div>

      {started ? (
        <ol className="install-next" aria-live="polite">
          <li><span><strong>Open ADCode Installer.exe</strong> from your browser&apos;s downloads.</span></li>
          <li><span><strong>Click Install.</strong> The Microsoft Store downloads ADCode and keeps it updated.</span></li>
          <li><span><strong>ADCode opens.</strong> Open a folder and build. You earn from the first sponsored card, no account needed.</span></li>
          <li className="install-next-fallback">
            Download didn&apos;t start? <a href={MICROSOFT_STORE.appUrl}>Open ADCode in the Microsoft Store app</a> or <a href={MICROSOFT_STORE.pageUrl} target="_blank" rel="noreferrer">the Store website</a>.
          </li>
        </ol>
      ) : (
        <p className="hero-install-note">
          Signed by Microsoft, so Windows installs it without a warning. Windows 10 and 11.{" "}
          <button type="button" className="install-link-button" aria-expanded={terminal} onClick={() => setTerminal((open) => !open)}>
            {terminal ? "Hide the terminal command" : "Prefer a terminal?"}
          </button>
        </p>
      )}

      {terminal && !started && <TerminalCommand platform="windows" />}
    </div>
  );
}

function LinuxInstall({ secondary }: { secondary: React.ReactNode }) {
  const [terminal, setTerminal] = useState(false);
  const downloads = LINUX_DOWNLOADS(GITHUB_REPO);
  return (
    <div className="hero-install">
      <div className="marketplace-hero-actions">
        <a href={downloads.deb} className="marketplace-primary install-cta" onClick={() => trackWebsiteEvent("download_click")}>
          <span className="install-cta-label">
            Download for Ubuntu / Debian
            <small>Free · .deb · x86_64</small>
          </span>
        </a>
        {secondary}
      </div>
      <p className="hero-install-note">
        Another distribution? <a href={downloads.appImage} onClick={() => trackWebsiteEvent("download_click")}>Download the AppImage</a>.{" "}
        <button type="button" className="install-link-button" aria-expanded={terminal} onClick={() => setTerminal((open) => !open)}>
          {terminal ? "Hide the terminal command" : "Prefer a terminal?"}
        </button>
      </p>
      {terminal && <TerminalCommand platform="linux" />}
    </div>
  );
}

/**
 * A phone cannot install a desktop editor, and asking someone who tapped a post to come
 * back later on another device mostly means they will not. Sending themselves the link
 * while they still care is the next best thing - through the share sheet where there is one,
 * by copying it where there is not, or by email.
 */
function SendToDesktop({ secondary }: { secondary: React.ReactNode }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const link = `${SITE.origin}/versions?utm_source=send-to-desktop`;
  const subject = "Install ADCode on my computer";
  const body = `ADCode - the free AI code editor that pays you to build.\n\nInstall it here: ${link}`;

  async function send(): Promise<void> {
    trackWebsiteEvent("send_to_desktop");
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: subject, text: "ADCode - the free AI code editor that pays you to build.", url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      setState("copied");
    } catch (error) {
      // Dismissing the share sheet is not a failure; there is nothing to report.
      if (error instanceof DOMException && error.name === "AbortError") return;
      setState("failed");
    }
  }

  return (
    <div className="hero-install">
      <div className="marketplace-hero-actions">
        <button type="button" className="marketplace-primary install-cta" onClick={() => void send()}>
          <span className="install-cta-label">
            {state === "copied" ? "Link copied" : "Send to my computer"}
            <small>ADCode runs on Windows and Linux</small>
          </span>
        </button>
        <a
          className="marketplace-secondary"
          href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
          onClick={() => trackWebsiteEvent("send_to_desktop")}
        >
          Email me the link
        </a>
      </div>
      {state === "failed" && <p className="hero-install-note" role="status">Sharing was blocked. The link is {link}</p>}
      {secondary !== null && <p className="hero-install-note">Advertising instead? <a href="/#advertise">Reach developers while they build</a>.</p>}
    </div>
  );
}

function TerminalCommand({ platform }: { platform: "windows" | "linux" }) {
  const command = installCommand(platform, SITE.origin)!;
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const isWindows = platform === "windows";

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy(): Promise<void> {
    setFailed(false);
    try {
      await navigator.clipboard.writeText(command);
      trackWebsiteEvent("install_copy");
      setCopied(true);
    } catch {
      // A denied clipboard permission. The command is selectable either way.
      setFailed(true);
    }
  }

  return (
    <div className="hero-quick-install">
      <div className="hero-quick-install-card">
        <div className="hero-install-command">
          <span className="hero-install-prompt" aria-hidden="true">{isWindows ? "PS>" : "$"}</span>
          <code>{command}</code>
          <button type="button" onClick={() => void copy()} aria-label={`Copy ${isWindows ? "PowerShell" : "terminal"} install command`} aria-live="polite" data-copied={copied}>
            <span aria-hidden="true" className="hero-install-copy-icon">{copied ? "✓" : "⧉"}</span>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      {failed && <p className="hero-install-note" role="status">Copy was blocked. Select the command above and copy it manually.</p>}
      <p className="hero-install-note">
        Paste into {isWindows ? "PowerShell" : "your shell"} and press <kbd>Enter</kbd>. It verifies the
        download against its published checksum. <Link href="/docs/installing-adcode">What this does</Link>
      </p>
    </div>
  );
}
