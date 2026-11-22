/*
 * The web version, on this computer: the page on Vite, with its main process in the tab.
 *
 *   npm run web:vibe                 -> http://localhost:5180
 *   npm run web:vibe -- --no-build   (reuse apps/desktop/out/browser-host)
 *
 * The desktop's main process runs in a Web Worker in the page (src/browserHost); this builds it
 * and serves the page. The sign-in screen offers "Continue in dev mode", which only a
 * development build can show. /v1 goes to the live API; ADCODE_WEB_API_ORIGIN stands something
 * in for the cloud Worker's /api (GitHub), as smoke-web.mjs does.
 *
 * Env: ADCODE_WEB_PORT (5180), ADCODE_WEB_API_ORIGIN, ADCODE_ACCOUNT_API_ORIGIN.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const REPO = process.cwd();
const require = createRequire(join(REPO, "package.json"));
const vite = join(dirname(require.resolve("vite/package.json")), "bin", "vite.js");
const webPort = process.env["ADCODE_WEB_PORT"] ?? "5180";

if (!process.argv.includes("--no-build")) {
  const built = spawnSync(process.execPath, [vite, "build", "-c", "apps/desktop/vite.browserHost.config.ts", "--logLevel", "warn"], { stdio: "inherit" });
  if (built.status !== 0) process.exit(built.status ?? 1);
}

const page = spawn(process.execPath, [vite, "--config", "apps/desktop/vite.web.config.ts", "--port", webPort, "--strictPort"], { stdio: "inherit", env: process.env });
console.log(`
ADCode on the web, locally: http://localhost:${webPort}
`);

const stop = () => {
  if (page.exitCode === null) page.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
page.on("exit", (code) => {
  if (code !== 0 && code !== null) console.error(`[web:vibe] the page server exited with ${code}`);
  process.exit(code ?? 0);
});
