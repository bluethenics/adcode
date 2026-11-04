"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { SideIcon } from "./AppShell";
import { ADMIN_NAV, jumpTarget, type AdminNavItem } from "./AdminShell";

/**
 * Ctrl/⌘ K: every admin destination by name, and the jump box's id routing as the last row.
 *
 * Twenty destinations in a rail is a lot of scanning for somebody who knows where they are
 * going. Typing "pay" and pressing Enter is faster than finding Payouts, and on a phone it saves
 * opening the sheet at all. It opens with a 140ms fade - short, because it is a keyboard action
 * somebody repeats - and closes instantly.
 */
export function AdminPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const items = useMemo(() => {
    const all = ADMIN_NAV.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })));
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const found = words.length === 0 ? all : all.filter((item) => {
      const text = `${item.label} ${item.hint} ${item.group}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
    // A label that starts with what was typed is almost always the one meant.
    return found.sort((a, b) => Number(!a.label.toLowerCase().startsWith(words[0] ?? "")) - Number(!b.label.toLowerCase().startsWith(words[0] ?? "")));
  }, [query]);
  const jump = jumpTarget(query);
  const count = items.length + (jump === null ? 0 : 1);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    input.current?.focus();
  }, [open]);
  useEffect(() => setActive(0), [query]);

  if (!open) return null;

  const go = (href: string): void => {
    onClose();
    router.push(href);
  };
  const choose = (index: number): void => {
    const item: AdminNavItem | undefined = items[index];
    if (item !== undefined) go(item.href);
    else if (jump !== null) go(jump);
  };

  return (
    <div className="admin-palette" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="admin-palette-panel" role="dialog" aria-modal="true" aria-label="Go to an admin page">
        <input
          ref={input}
          className="admin-palette-input"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={count > 0 ? `${id}-${active}` : undefined}
          placeholder="Go to a page, or paste an id or email"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); onClose(); }
            else if (event.key === "ArrowDown") { event.preventDefault(); setActive((at) => (at + 1) % Math.max(1, count)); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setActive((at) => (at - 1 + Math.max(1, count)) % Math.max(1, count)); }
            else if (event.key === "Enter") { event.preventDefault(); choose(active); }
          }}
        />
        <ul className="admin-palette-list" id={`${id}-list`} role="listbox" aria-label="Destinations">
          {items.map((item, index) => (
            <li
              key={item.href}
              id={`${id}-${index}`}
              role="option"
              aria-selected={index === active}
              className="admin-palette-item"
              onMouseMove={() => setActive(index)}
              onClick={() => choose(index)}
            >
              <SideIcon name={item.icon} />
              <span><b>{item.label}</b><small>{item.hint}</small></span>
              <em>{item.group}</em>
            </li>
          ))}
          {jump !== null && (
            <li id={`${id}-${items.length}`} role="option" aria-selected={active === items.length} className="admin-palette-item" onMouseMove={() => setActive(items.length)} onClick={() => choose(items.length)}>
              <SideIcon name="list" />
              <span><b>Look up &ldquo;{query.trim()}&rdquo;</b><small>Routes by its prefix: wd-, rep-, adv-, camp-, or a person</small></span>
              <em>Jump</em>
            </li>
          )}
        </ul>
        <p className="admin-palette-foot" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> to move <kbd>Enter</kbd> to open <kbd>Esc</kbd> to close</p>
      </div>
    </div>
  );
}
