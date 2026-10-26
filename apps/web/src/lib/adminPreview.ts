/**
 * The admin panel with made-up data, for building it - development only.
 *
 * The panel is behind an administrator's sign-in, which a local dev server does not have, so
 * every screen used to be designed blind. Visiting any admin page with `?preview=demo`,
 * `?preview=worst` or `?preview=empty` turns this on for the tab (`?preview=off` turns it off):
 * the shell skips its sign-in gate and `apiFetch` answers from `adminFixtures.ts` instead of the
 * network. `worst` is realistic worst-case data - long names, unbreakable emails, huge counts,
 * every state at once - in the spirit of Emil Kowalski's break-ui skill.
 *
 * `process.env["NODE_ENV"]` is inlined at build time, so in a production build every branch that
 * reads this is dead code and the fixtures are never bundled.
 */
export type AdminPreviewData = "demo" | "worst" | "empty";


const KEY = "adcode.admin-preview";
const isData = (value: string | null): value is AdminPreviewData => value === "demo" || value === "worst" || value === "empty";

export function adminPreviewData(): AdminPreviewData | null {
  if (process.env["NODE_ENV"] !== "development" || typeof window === "undefined") return null;
  try {
    const asked = new URLSearchParams(window.location.search).get("preview");
    if (asked === "off") sessionStorage.removeItem(KEY);
    else if (isData(asked)) sessionStorage.setItem(KEY, asked);
    const saved = sessionStorage.getItem(KEY);
    return isData(saved) ? saved : null;
  } catch {
    return null;
  }
}
