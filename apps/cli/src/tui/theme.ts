/**
 * The command deck's palette.
 *
 * Near-black ground, block-white ink, one quiet blue for intent, and a peach selection
 * borrowed from the terminal tools this interface learned from. Money stays green; the
 * other themes are deliberate alternatives, not the house style.
 */

export interface Theme {
  readonly id: string;
  readonly label: string;
  readonly blurb: string;
  readonly isLight: boolean;
  readonly ink: string;
  readonly muted: string;
  readonly faint: string;
  readonly panel: string;
  readonly panelSoft: string;
  readonly selected: string;
  readonly selectedText: string;
  readonly border: string;
  readonly borderSoft: string;
  readonly accent: string;
  readonly accentText: string;
  readonly money: string;
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
  readonly info: string;
  readonly gradient: readonly string[];
}

export const THEMES: Readonly<Record<string, Theme>> = {
  midnight: {
    id: "midnight",
    label: "Midnight",
    blurb: "Near-black, block white, and one quiet blue.",
    isLight: false,
    ink: "#e9e9e9",
    muted: "#a1a1a1",
    faint: "#6d6d6d",
    panel: "#0a0a0a",
    panelSoft: "#151515",
    selected: "#f0d3a4",
    selectedText: "#141414",
    border: "#2b2b2b",
    borderSoft: "#1b1b1b",
    accent: "#8ab4f8",
    accentText: "#0a0a0a",
    money: "#7ee2b8",
    success: "#7ee2b8",
    warning: "#f6c177",
    danger: "#f38ba8",
    info: "#8ab4f8",
    gradient: ["#4a4a4a", "#7d7d7d", "#b8b8b8", "#f2f2f2", "#ffffff"],
  },
  paper: {
    id: "paper",
    label: "Paper",
    blurb: "Warm paper, near-black ink, quiet green.",
    isLight: true,
    ink: "#26251e",
    muted: "#5f5e57",
    faint: "#6b6a62",
    panel: "#f3f1ec",
    panelSoft: "#eae8e1",
    selected: "#dedbd2",
    selectedText: "#26251e",
    border: "#c9c6bc",
    borderSoft: "#dedbd2",
    accent: "#26251e",
    accentText: "#f7f7f4",
    money: "#14785a",
    success: "#14785a",
    warning: "#946009",
    danger: "#c33748",
    info: "#1d4ed8",
    gradient: ["#8a877c", "#5f5e57", "#26251e", "#111111", "#5f5e57"],
  },
  aurora: {
    id: "aurora",
    label: "Aurora",
    blurb: "Violet, cyan, and a little electric mint.",
    isLight: false,
    ink: "#f1f5f9",
    muted: "#9aa7b8",
    faint: "#718198",
    panel: "#0d1220",
    panelSoft: "#141b2e",
    selected: "#202b45",
    selectedText: "#f1f5f9",
    border: "#2b3853",
    borderSoft: "#1b2438",
    accent: "#f5f3ff",
    accentText: "#1a1025",
    money: "#86efac",
    success: "#86efac",
    warning: "#fcd34d",
    danger: "#fb7185",
    info: "#67e8f9",
    gradient: ["#a78bfa", "#67e8f9", "#f1f5f9", "#86efac", "#67e8f9"],
  },
  ember: {
    id: "ember",
    label: "Ember",
    blurb: "Warm ink, amber light, a rose afterglow.",
    isLight: false,
    ink: "#f7ede2",
    muted: "#b7a99a",
    faint: "#897a6c",
    panel: "#160f0c",
    panelSoft: "#211612",
    selected: "#33211a",
    selectedText: "#fff7ed",
    border: "#422e24",
    borderSoft: "#2a1d17",
    accent: "#fff7ed",
    accentText: "#1b0f08",
    money: "#86efac",
    success: "#86efac",
    warning: "#fbbf24",
    danger: "#fb7185",
    info: "#facc15",
    gradient: ["#fb923c", "#fbbf24", "#f7ede2", "#fb7185", "#fbbf24"],
  },
  graphite: {
    id: "graphite",
    label: "Graphite",
    blurb: "No colour at all, except when it means something.",
    isLight: false,
    ink: "#e5e7eb",
    muted: "#9ca3af",
    faint: "#6b7280",
    panel: "#0f1011",
    panelSoft: "#17181a",
    selected: "#232529",
    selectedText: "#f9fafb",
    border: "#303236",
    borderSoft: "#1e2023",
    accent: "#f9fafb",
    accentText: "#111827",
    money: "#86efac",
    success: "#86efac",
    warning: "#fcd34d",
    danger: "#fb7185",
    info: "#cbd5e1",
    gradient: ["#6b7280", "#d1d5db", "#f9fafb", "#ffffff", "#d1d5db"],
  },
};

export const THEME_ORDER = ["midnight", "paper", "aurora", "ember", "graphite"] as const;
export const DEFAULT_THEME = "midnight";

export type ThemeName = (typeof THEME_ORDER)[number];

export function isThemeName(name: string): name is ThemeName {
  return (THEME_ORDER as readonly string[]).includes(name);
}

export function resolveTheme(name: string): Theme {
  return THEMES[name] ?? THEMES[DEFAULT_THEME] ?? THEMES["midnight"]!;
}

export function themeNames(): readonly string[] {
  return THEME_ORDER;
}

export type ThemeTone =
  | "ink"
  | "muted"
  | "faint"
  | "panel"
  | "panelSoft"
  | "selected"
  | "selectedText"
  | "border"
  | "borderSoft"
  | "accent"
  | "accentText"
  | "money"
  | "success"
  | "warning"
  | "danger"
  | "info";
