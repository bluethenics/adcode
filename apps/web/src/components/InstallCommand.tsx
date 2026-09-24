"use client";

import { useEffect, useState } from "react";
import { trackWebsiteEvent } from "@/lib/websiteAnalytics";

/**
 * The one-line install, with a copy button.
 *
 * The button says what it did rather than showing an icon that changed state: "Copied"
 * is unambiguous at a glance, a tick is a thing you have to interpret. It reverts after a
 * moment so the control goes back to describing what it will do next.
 */
export function InstallCommand({ command, label }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    setFailed(false);
    try {
      await navigator.clipboard.writeText(command);
      trackWebsiteEvent("install_copy");
      setCopied(true);
    } catch {
      // Clipboard access can be refused outright. The command is on screen and
      // selectable, so the honest response is to leave it alone rather than pretend.
      setCopied(false);
      setFailed(true);
    }
  };

  return (
    <div className="install-command">
      <div className="install">
        {label !== undefined && <span style={{ color: "var(--on-ink-muted)" }}>{label}</span>}
        <span className="install-prompt" aria-hidden="true">$</span>
        <code className="install-text">{command}</code>
        <button type="button" className="install-copy" onClick={() => void copy()} aria-label={label ? `Copy ${label} install command` : "Copy install command"} aria-live="polite" data-copied={copied}>
          <span aria-hidden="true" className="hero-install-copy-icon">{copied ? "✓" : "⧉"}</span>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {failed && <p className="hero-install-note" role="status">Copy was blocked. Select the command above and copy it manually.</p>}
    </div>
  );
}
