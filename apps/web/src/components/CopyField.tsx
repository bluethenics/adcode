"use client";

import { useEffect, useState } from "react";

/**
 * A value you are meant to copy, with a button that says whether it worked.
 *
 * The confirmation is the point. `navigator.clipboard` fails silently in a few real
 * situations - an insecure origin, a browser that refuses without a user gesture it
 * recognises, a locked-down enterprise policy - and a button that looks the same either
 * way leaves someone pasting a stale clipboard into a support email. This says "Copied"
 * only when the write actually resolved, and "Press ⌘C" when it did not.
 */
export function CopyField({ label, value }: { label: string; value: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 2400);
    return () => window.clearTimeout(timer);
  }, [state]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setState("done");
    } catch {
      setState("failed");
    }
  };

  return (
    <div className="copy-field">
      <span className="copy-label">{label}</span>
      <code className="mono copy-value">{value}</code>
      <button type="button" className="copy-button" onClick={() => void copy()}>
        {state === "done" ? "Copied" : state === "failed" ? "Select and copy" : "Copy"}
      </button>
    </div>
  );
}
