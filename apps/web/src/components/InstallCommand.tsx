"use client";

import { useState } from "react";

/**
 * The one-line install, with a copy button.
 *
 * The button says what it did rather than showing an icon that changed state: "Copied"
 * is unambiguous at a glance, a tick is a thing you have to interpret. It reverts after a
 * moment so the control goes back to describing what it will do next.
 */
export function InstallCommand({ command, label }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be refused outright. The command is on screen and
      // selectable, so the honest response is to leave it alone rather than pretend.
      setCopied(false);
    }
  };

  return (
    <div className="install">
      {label !== undefined && <span style={{ color: "var(--on-ink-muted)" }}>{label}</span>}
      <code className="install-text">{command}</code>
      <button type="button" className="install-copy" onClick={() => void copy()}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
