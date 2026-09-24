"use client";

import { useEffect } from "react";
import { isInstallCommand } from "@/lib/platform";
import { SITE } from "@/lib/site";
import { trackWebsiteEvent } from "@/lib/websiteAnalytics";

/**
 * The hands behind every code box's Copy button.
 *
 * Code boxes arrive as static HTML from `renderMarkdown` - docs, terms, privacy, the
 * admin preview - so there is no React button to hand an `onClick`. One delegated
 * listener on the document covers all of them: it finds the box's `<code>`, copies its
 * text, and briefly says "Copied". Mounted once in the root layout, so any surface
 * that renders prose gets working copy buttons without asking.
 */
export function CodeboxCopy() {
  useEffect(() => {
    const timers = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>();

    const copyText = async (text: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Clipboard permission denied, or an older browser. A temporary textarea and
        // `execCommand` still works where the async API does not.
        const area = document.createElement("textarea");
        const focused = document.activeElement;
        try {
          area.value = text;
          area.style.position = "fixed";
          area.style.opacity = "0";
          document.body.appendChild(area);
          area.select();
          return document.execCommand("copy");
        } catch {
          return false;
        } finally {
          area.remove();
          if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
        }
      }
    };

    const onClick = (event: MouseEvent): void => {
      const button = (event.target as HTMLElement | null)?.closest?.("[data-codebox-copy]");
      if (!(button instanceof HTMLButtonElement)) return;

      const code = button.closest(".codebox")?.querySelector("code");
      if (code === null || code === undefined) return;

      const text = code.textContent ?? "";
      const path = location.pathname;
      void copyText(text).then((ok) => {
        if (ok && isInstallCommand(text, SITE.origin)) trackWebsiteEvent("install_copy", 0, path);
        button.textContent = ok ? "Copied" : "Copy failed";
        button.dataset.copied = ok ? "true" : "false";
        clearTimeout(timers.get(button));
        timers.set(button, setTimeout(() => {
          button.textContent = "Copy";
          delete button.dataset.copied;
          timers.delete(button);
        }, 1600));
      });
    };

    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  return null;
}
