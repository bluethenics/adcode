/**
 * Builds the web version's page: the desktop renderer, booted by `src/web/boot.ts`.
 *
 * Same sources and the same `index.html` as the Electron renderer. A small plugin swaps the
 * page's module script for the web entry, which signs in, connects to the sandbox, installs a
 * socket-backed `window.adcode`, and only then loads the renderer. The local-package aliases
 * are imported from `electron.vite.config.ts`, not copied.
 *
 *   npx vite build -c apps/desktop/vite.web.config.ts     -> apps/cloud/public
 *   npx vite -c apps/desktop/vite.web.config.ts           -> dev server, /socket proxied to adcode-host
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { alias } from "./electron.vite.config.ts";
import { webAppHead, webPausedHead, WEB_APP_PAUSED_SPLASH, WEB_APP_SPLASH } from "./src/web/seo.ts";

const DESKTOP = import.meta.dirname;
const REPO = resolve(DESKTOP, "../..");
// Resolved the way Node would, so the build also works from a worktree sharing the main checkout's node_modules.
const DOMPURIFY = resolve(dirname(createRequire(import.meta.url).resolve("dompurify")), "purify.es.mjs");

interface FirebaseWebConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly appId: string;
}

/** Public by design - these identify the Firebase project, they authorise nothing. */
export function firebaseConfig(): FirebaseWebConfig {
  const fromFile: Record<string, string> = {};
  for (const file of [resolve(REPO, "apps/web/.env.production"), resolve(REPO, "apps/web/.env.local")]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = /^\s*NEXT_PUBLIC_FIREBASE_([A-Z_]+)\s*=\s*"?([^"\s]*)"?\s*$/.exec(line);
      if (match !== null && match[2]!.length > 0 && fromFile[match[1]!] === undefined) fromFile[match[1]!] = match[2]!;
    }
  }
  const pick = (name: string): string => process.env[`ADCODE_FIREBASE_${name}`] ?? fromFile[name] ?? "";
  return { apiKey: pick("API_KEY"), authDomain: pick("AUTH_DOMAIN"), projectId: pick("PROJECT_ID"), appId: pick("APP_ID") };
}

/*
 * The first paint, before any script or stylesheet has arrived.
 *
 * The page is the desktop renderer's `index.html`, which carries the whole workbench as plain
 * markup - explorer, status bar, Share. On a slow connection that markup showed unstyled for
 * seconds ("Explorer No folder opened Open ... Ln 1, Col 1 Share") while the module script
 * loaded. These few rules, inline in the head, keep everything but the gate invisible until
 * the shell says it is ready (`body[data-shell="ready"]`), and paint the launch screen in the
 * gate from the HTML alone: the login page's ASCII mark sweeping, the public introduction,
 * and the same progress row the gate keeps once it takes over. `visibility`, not `display`:
 * the renderer measures its layout while it boots, and a hidden-but-laid-out workbench
 * measures right.
 */
const CRITICAL_CSS = [
  "html,body{margin:0;height:100%;background:#111110;color:#ebe8e1}",
  "body[data-surface=web]:not([data-shell=ready])>:not(#web-gate):not(.web-account-dialog){visibility:hidden!important}",
  "#web-gate.web-gate-splash{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:radial-gradient(ellipse 60% 50% at 50% 42%,#1c1b19 0%,#111110 70%)}",
  // The three faces, declared here so the splash's first paint is already in them (the files are preloaded with the page).
  "@font-face{font-family:'Manrope';src:url('/fonts/manrope.woff2') format('woff2');font-weight:200 800;font-style:normal;font-display:swap}",
  "@font-face{font-family:'Space Grotesk';src:url('/fonts/space-grotesk.woff2') format('woff2');font-weight:300 700;font-style:normal;font-display:swap}",
  "@font-face{font-family:'Geist Mono';src:url('/fonts/geist-mono.woff2') format('woff2');font-weight:100 900;font-style:normal;font-display:swap}",
  ".web-splash{display:grid;box-sizing:border-box;max-width:600px;justify-items:center;gap:20px;padding:32px 24px;font-family:'Manrope',ui-sans-serif,system-ui,sans-serif;font-size:15px;font-weight:400;line-height:1.5;color:#ebe8e1;text-align:center;letter-spacing:.005em}",
  // The mark: the lightest sweep, with the heaviest laid over it and revealed by a travelling band.
  ".web-splash-mark{position:relative;width:100%;max-width:440px}",
  ".web-splash-mark pre{margin:0;white-space:pre;font-family:'Geist Mono',ui-monospace,monospace;font-size:min(9px,calc((100vw - 64px)/45));font-weight:400;line-height:1;color:#8f8c85;text-align:left}",
  ".web-splash-mark pre+pre{position:absolute;inset:0;color:#ece9e2;-webkit-mask-image:linear-gradient(100deg,transparent 36%,#000 50%,transparent 64%);mask-image:linear-gradient(100deg,transparent 36%,#000 50%,transparent 64%);-webkit-mask-size:300% 100%;mask-size:300% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:150% 0;mask-position:150% 0;animation:web-splash-sweep 4.8s linear infinite}",
  "@keyframes web-splash-sweep{from{-webkit-mask-position:150% 0;mask-position:150% 0}to{-webkit-mask-position:-150% 0;mask-position:-150% 0}}",
  ".web-splash-copy{display:grid;justify-items:center;gap:10px;max-width:46ch}",
  ".web-splash h1{margin:0;font-family:'Space Grotesk','Manrope',sans-serif;font-size:clamp(24px,3.4vw,30px);font-weight:500;line-height:1.15;letter-spacing:-0.03em;text-wrap:balance}",
  ".web-splash p{margin:0;color:#8f8c85;font-size:14px;line-height:1.6;text-wrap:pretty}",
  ".web-splash nav{display:flex;flex-wrap:wrap;justify-content:center;gap:18px;font-size:13.5px}",
  ".web-splash a{color:#b2d8bd;text-underline-offset:4px}",
  // The paused page's one action, in the same palette as the launch page.
  ".web-paused-actions{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:14px;margin-top:6px}",
  ".web-splash .web-paused-primary{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 20px;border-radius:11px;background:#6fb98f;color:#10140f;font-size:14px;font-weight:700;text-decoration:none;box-shadow:0 8px 24px rgb(111 185 143 / .22)}",
  ".web-splash .web-paused-link{color:#b2d8bd;font-size:13.5px;text-underline-offset:4px}",
  ".web-splash-loading{display:grid;justify-items:center;gap:10px;margin-top:4px}",
  ".web-splash-loading [role=status]{font-size:13px;font-weight:500;color:#8f8c85}",
  ".web-splash-bar{width:160px;height:2px;border-radius:2px;overflow:hidden;background:#2d2b28}",
  ".web-splash-bar::after{content:'';display:block;width:40%;height:100%;border-radius:inherit;background:linear-gradient(90deg,transparent,#6fb98f,transparent);animation:web-splash-scan 1.1s cubic-bezier(.77,0,.175,1) infinite}",
  "@keyframes web-splash-scan{from{transform:translateX(-100%)}to{transform:translateX(250%)}}",
  "@media (prefers-reduced-motion:reduce){.web-splash-mark pre+pre,.web-splash-bar::after{animation:none}}",
].join("");

const SPLASH = WEB_APP_SPLASH;

/** The app's three faces, fetched with the page so text never reflows into them later. */
const FONT_PRELOADS = ["manrope", "space-grotesk", "geist-mono"]
  .map((name) => `    <link rel="preload" href="/fonts/${name}.woff2" as="font" type="font/woff2" crossorigin />`)
  .join("\n");

/**
 * Swap the Electron renderer's entry for the web one; everything else in the page stays.
 *
 * Production is paused until the release is ready: it ships a static notice instead of the
 * app and its workbench markup. Development (`npm run web:vibe`, the browser smoke) keeps the
 * real entry so the app can still be worked on locally.
 */
function webEntry(paused: boolean): Plugin {
  return {
    name: "adcode-web-entry",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const script = '<script type="module" src="./main.ts"></script>';
        if (!html.includes(script)) throw new Error("adcode-web-entry: the renderer's module script moved; update vite.web.config.ts");
        // Installable as an app (manifest.webmanifest); the paused notice is not something to install.
        const install = paused ? "" : `\n    <link rel="manifest" href="/manifest.webmanifest" />\n    <link rel="apple-touch-icon" href="/phone/icon-180.png" />`;
        const head = `${paused ? webPausedHead() : webAppHead()}\n    <meta name="theme-color" content="#111110" />\n    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />${install}\n${FONT_PRELOADS}\n    <style id="web-critical">${CRITICAL_CSS}</style>`;
        if (paused) {
          // The paused notice is the whole document: no entry, no workbench, no scripts.
          return html
            .replace("<title>ADCode</title>", head)
            .replace(/<body>[\s\S]*<\/body>/, `<body data-surface="web">\n    <div id="web-gate" class="web-gate web-gate-splash">${WEB_APP_PAUSED_SPLASH}</div>\n  </body>`);
        }
        return html
          .replace(script, '<script type="module" src="/@web/boot.ts"></script>')
          .replace("<title>ADCode</title>", head)
          .replace("<body>", `<body data-surface="web">\n    <div id="web-gate" class="web-gate web-gate-splash">${SPLASH}</div>`);
      },
    },
  };
}

export default defineConfig(({ mode }) => ({
  root: resolve(DESKTOP, "src/renderer"),
  publicDir: resolve(DESKTOP, "src/renderer/public"),
  // Its own cache, so this dev server never fights the desktop's electron-vite over one folder.
  cacheDir: resolve(DESKTOP, "out/.vite-web"),
  plugins: [webEntry(mode === "production")],
  esbuild: { jsx: "automatic" },
  optimizeDeps: {
    // The scanner reads the page's raw HTML, which still names the desktop's `./main.ts`; the web
    // entry's own imports (Firebase) would otherwise be found mid-load, and Vite's re-optimise
    // breaks the first visit's dynamic import of the renderer.
    entries: ["index.html", "main.ts", "../web/boot.ts"],
    // The renderer loads after sign-in. Prebundle its browser dependencies now so Vite
    // cannot invalidate that first dynamic import by discovering them mid-startup.
    include: [
      "firebase/app", "firebase/auth", "react", "react-dom/client",
      "react/jsx-runtime", "react/jsx-dev-runtime", "lucide",
      "monaco-editor",
      "monaco-editor/languages/features/typescript/register.js",
      "monaco-editor/languages/features/json/register.js",
      "monaco-editor/languages/features/css/register.js",
      "monaco-editor/languages/features/html/register.js",
      "yjs", "web-tree-sitter", "@xterm/xterm", "@xterm/addon-fit",
      "@xterm/addon-search", "@xterm/addon-web-links", "@xterm/addon-webgl",
    ],
  },
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${resolve(REPO, "apps/web/src")}/` },
      { find: /^\/@web\//, replacement: `${resolve(DESKTOP, "src/web")}/` },
      // Monaco vendors its own DOMPurify copy; resolve it to the audited lockfile version, as the desktop does.
      { find: "./dompurify/dompurify.js", replacement: DOMPURIFY },
      ...Object.entries(alias).map(([find, replacement]) => ({ find, replacement })),
    ],
  },
  define: {
    "process.env": JSON.stringify({}),
    __ADCODE_WEB_DEV__: JSON.stringify(mode === "development"),
    __ADCODE_FIREBASE__: JSON.stringify(firebaseConfig()),
  },
  server: {
    port: 5180,
    strictPort: true,
    fs: { allow: [REPO] },
    /*
     * The grammar blobs are copied in, not authored: `scripts/grammars.mjs` writes megabytes of
     * `.wasm` into `public/grammars`, and while anything has one of them open - another dev
     * server, a running app, a build copying them - the watcher's `fs.watch` on that file fails
     * with EBUSY. Vite raises that as an unhandled error and the dev server exits. So the folder
     * is left unwatched: nothing edits it by hand, and no reload is lost that anyone wants.
     */
    watch: { ignored: [resolve(DESKTOP, "src/renderer/public/grammars/**")] },
    proxy: {
      "/v1": { target: process.env["ADCODE_ACCOUNT_API_ORIGIN"] ?? "https://adcode.bluethenics.com", changeOrigin: true },
      "/socket": { target: `ws://127.0.0.1:${process.env["ADCODE_HOST_PORT"] ?? "7300"}`, ws: true },
      "/__adcode": { target: `http://127.0.0.1:${process.env["ADCODE_HOST_PORT"] ?? "7300"}` },
    },
  },
  build: {
    outDir: resolve(REPO, "apps/cloud/public"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: { manualChunks: { monaco: ["monaco-editor"] } },
    },
  },
  worker: { format: "es" as const },
}));
