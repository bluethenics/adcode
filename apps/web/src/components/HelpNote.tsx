"use client";

import { useEffect, useState } from "react";

/**
 * An explanation you only need once.
 *
 * The admin pages each carry a standing note - what gets audited, why names are missing,
 * what a test serve does. They are worth reading the first time and pure furniture every
 * time after, and they sat permanently above the content on a screen somebody uses daily.
 *
 * So they close, and stay closed. The dismissal is per note and per browser, in
 * `localStorage`, because it is a preference about reading rather than a fact about the
 * account - it should not follow an admin onto a machine where a colleague is learning
 * the panel for the first time.
 *
 * Renders nothing until storage has been read, so a note that was dismissed months ago
 * never flashes up and disappears on every navigation.
 */
const KEY = "adcode.admin.dismissed";

function dismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    // Private browsing, or storage switched off. Showing the note is the safe side.
    return new Set();
  }
}

export function HelpNote({
  id,
  tone = "info",
  children,
}: {
  /** Stable across edits to the wording - changing it un-dismisses the note for everyone. */
  id: string;
  tone?: "info" | "warning";
  children: React.ReactNode;
}) {
  const [state, setState] = useState<"unknown" | "show" | "hide">("unknown");

  useEffect(() => setState(dismissed().has(id) ? "hide" : "show"), [id]);

  if (state !== "show") return null;

  const close = (): void => {
    setState("hide");
    try {
      const all = dismissed();
      all.add(id);
      window.localStorage.setItem(KEY, JSON.stringify([...all]));
    } catch {
      // It closes for this page load either way.
    }
  };

  return (
    <div className="notice help-note" data-tone={tone}>
      <div>{children}</div>
      <button type="button" className="help-note-close" onClick={close} aria-label="Dismiss this note">
        ×
      </button>
    </div>
  );
}
