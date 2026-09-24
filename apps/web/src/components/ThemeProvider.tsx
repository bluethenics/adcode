"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { parseTheme, THEME_KEY, type Theme } from "@/lib/theme";

const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void }>({ theme: "system", setTheme: () => {} });

/** Switch surfaces and text together, without intermediate low-contrast colors. */
function applyAppearance(value: Theme) {
  const root = document.documentElement;
  root.dataset.themeSwitching = "true";
  root.dataset.theme = value;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    delete root.dataset.themeSwitching;
  }));
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, updateTheme] = useState<Theme>("system");
  useEffect(() => {
    updateTheme(parseTheme(document.documentElement.dataset.theme ?? null));
    const sync = (event: StorageEvent) => {
      if (event.key !== THEME_KEY && event.key !== null) return;
      const value = parseTheme(event.newValue);
      applyAppearance(value);
      updateTheme(value);
    };
    window.addEventListener("storage", sync);
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystem = () => {
      if (parseTheme(document.documentElement.dataset.theme ?? null) === "system") applyAppearance("system");
    };
    system.addEventListener("change", syncSystem);
    return () => { window.removeEventListener("storage", sync); system.removeEventListener("change", syncSystem); };
  }, []);

  useEffect(() => {
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
      const dark = theme === "dark" || (theme === "system" && meta.media.includes("dark"));
      meta.content = dark ? "#14120b" : "#f7f7f4";
    });
  }, [theme]);

  function setTheme(value: Theme) {
    applyAppearance(value);
    updateTheme(value);
    try { localStorage.setItem(THEME_KEY, value); } catch { /* Appearance still works when storage is unavailable. */ }
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function ThemePicker() {
  const { theme, setTheme } = useContext(ThemeContext);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const options: { value: Theme; label: string }[] = [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  return (
    <div className="appearance" ref={root} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <button ref={trigger} type="button" className="appearance-trigger" aria-label={`Appearance: ${theme}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
      }}>
        <ThemeIcon theme={theme} />
        <span>{options.find((option) => option.value === theme)?.label}</span>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      {open && <div ref={menu} id={id} role="menu" aria-label="Appearance" className="appearance-menu" onKeyDown={onKeyDown}>
        <span className="appearance-menu-label">Appearance</span>
        {options.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={theme === option.value} tabIndex={-1} onClick={() => {
          setTheme(option.value);
          setOpen(false);
          trigger.current?.focus();
        }}>
          <ThemeIcon theme={option.value} /><span>{option.label}</span>
          {theme === option.value && <svg className="appearance-check" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>}
        </button>)}
      </div>}
    </div>
  );
}

function ThemeIcon({ theme }: { theme: Theme }) {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {theme === "system" ? <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></> : theme === "light" ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></> : <path d="M20.5 14a8.6 8.6 0 0 1-10.5-10.5A8.7 8.7 0 1 0 20.5 14Z" />}
  </svg>;
}
