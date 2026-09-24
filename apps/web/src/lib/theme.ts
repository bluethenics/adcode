export type Theme = "system" | "light" | "dark";
export const THEME_KEY = "adcode-appearance";
export function parseTheme(value: string | null): Theme {
  return value === "light" || value === "dark" ? value : "system";
}
// Runs before paint. No user content is interpolated into this script.
export const THEME_SCRIPT = `(()=>{let t='system';try{const v=localStorage.getItem('${THEME_KEY}');if(v==='light'||v==='dark')t=v}catch{}document.documentElement.dataset.theme=t})()`;
