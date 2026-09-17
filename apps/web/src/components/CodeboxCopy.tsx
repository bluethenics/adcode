"use client";

import { useEffect } from "react";

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
    let timer: ReturnType<typeof setTimeout> | undefined;

    const copyText = async (text: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Clipboard permission denied, or an older browser. A temporary textarea and
        // `execCommand` still works where the async API does not.
        try {
          const area = document.createElement("textarea");
          area.value = text;
          area.style.position = "fixed";
          area.style.opacity = "0";
          document.body.appendChild(area);
          area.select();
          const ok = document.execCommand("copy");
          area.remove();
          return ok;
        } catch {
          return false;
        }
      }
    };

    const onClick = (event: MouseEvent): void => {
      const button = (event.target as HTMLElement | null)?.closest?.("[data-codebox-copy]");
      if (!(button instanceof HTMLButtonElement)) return;

      const code = button.closest(".codebox")?.querySelector("code");
      if (code === null || code === undefined) return;

      void copyText(code.textContent ?? "").then((ok) => {
        button.textContent = ok ? "Copied" : "Copy failed";
        button.dataset.copied = ok ? "true" : "false";
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
          button.textContent = "Copy";
          delete button.dataset.copied;
        }, 1600);
      });
    };

    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);

  return null;
}
