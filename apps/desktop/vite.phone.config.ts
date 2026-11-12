/**
 * Builds ADCode Remote, the Phone link page: web.bluethenics.com/phone.
 *
 * A small app of its own - no workbench, no Monaco - so a phone on a slow connection loads a
 * few kilobytes, not the editor. It shares Buck, the sign-in and the protocol with the rest of
 * the app through the same sources. Run after the web build, which empties `apps/cloud/public`.
 *
 *   npx vite build -c apps/desktop/vite.phone.config.ts   ->   apps/cloud/public/phone
 *   npx vite -c apps/desktop/vite.phone.config.ts         ->   dev server on :5181
 */
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { alias } from "./electron.vite.config.ts";
import { firebaseConfig } from "./vite.web.config.ts";

const DESKTOP = import.meta.dirname;
const REPO = resolve(DESKTOP, "../..");

export default defineConfig(({ mode }) => ({
  root: resolve(DESKTOP, "src/phone"),
  base: "/phone/",
  publicDir: resolve(DESKTOP, "src/phone/public"),
  cacheDir: resolve(DESKTOP, "out/.vite-phone"),
  resolve: {
    alias: Object.entries(alias).map(([find, replacement]) => ({ find, replacement })),
  },
  define: {
    __ADCODE_FIREBASE__: JSON.stringify(firebaseConfig()),
    __ADCODE_RELAY__: JSON.stringify(process.env["ADCODE_COLLAB_ORIGIN"] ?? "https://projects.bluethenics.com"),
    __ADCODE_WEB_DEV__: JSON.stringify(mode === "development"),
  },
  server: {
    port: 5181,
    strictPort: true,
    fs: { allow: [REPO] },
    // The fonts live with the web version's page.
    proxy: {},
  },
  build: {
    outDir: resolve(REPO, "apps/cloud/public/phone"),
    emptyOutDir: true,
    target: "es2022",
  },
}));
