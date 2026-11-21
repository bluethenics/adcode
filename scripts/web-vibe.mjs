/*
 * The web version, on this computer: adcode-host plus the web renderer on Vite.
 *
 *   npm run web:vibe            -> http://localhost:5180
 *   npm run web:vibe -- --no-build   (reuse apps/desktop/out/host)
 *
 * No cloud and no container: adcode-host runs straight on this machine with its home in
 * `.tmp/web-vibe-home`, and Vite proxies the page's `/socket` to it. The sign-in screen offers
 * "Continue in dev mode", which only a development build can show.
 *
 * Env: ADCODE_HOST_PORT (7300), ADCODE_WEB_PORT (5180), ADCODE_HOME (.tmp/web-vibe-home).
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const REPO = process.cwd();
const require = createRequire(join(REPO, "package.json"));
const vite = join(dirname(require.resolve("vite/package.json")), "bin", "vite.js");
const hostPort = process.env["ADCODE_HOST_PORT"] ?? "7300";
const webPort = process.env["ADCODE_WEB_PORT"] ?? "5180";
const home = process.env["ADCODE_HOME"] ?? join(REPO, ".tmp", "web-vibe-home");
mkdirSync(home, { recursive: true });

/*
 * In the cloud each person's sealing key comes from their Durable Object. Locally there is none,
 * so one is made once per dev home and kept beside it - otherwise saved API keys could not be
 * read back after a restart.
 */
const sealFile = join(home, ".dev-seal-key");
if (!existsSync(sealFile)) writeFileSync(sealFile, randomBytes(32).toString("base64"));
const sealKey = process.env["ADCODE_SEAL_KEY"] ?? readFileSync(sealFile, "utf8").trim();

if (!process.argv.includes("--no-build")) {
  const built = spawnSync(process.execPath, [vite, "build", "-c", "apps/desktop/vite.host.config.ts", "--logLevel", "warn"], { stdio: "inherit" });
  if (built.status !== 0) process.exit(built.status ?? 1);
  // The web version runs its main process in the tab (src/browserHost); the page loads this build.
  const browserHost = spawnSync(process.execPath, [vite, "build", "-c", "apps/desktop/vite.browserHost.config.ts", "--logLevel", "warn"], { stdio: "inherit" });
  if (browserHost.status !== 0) process.exit(browserHost.status ?? 1);
}

const children = [
  spawn(process.execPath, ["apps/desktop/out/host/index.js"], {
    stdio: "inherit",
    env: { ...process.env, ADCODE_HOME: home, ADCODE_CLOUD_DEV: "1", ADCODE_HOST_PORT: hostPort, ADCODE_SEAL_KEY: sealKey },
  }),
  spawn(process.execPath, [vite, "--config", "apps/desktop/vite.web.config.ts", "--port", webPort, "--strictPort"], {
    stdio: "inherit",
    env: { ...process.env, ADCODE_HOST_PORT: hostPort },
  }),
];

console.log(`\nADCode on the web, locally: http://localhost:${webPort}  (adcode-host on ${hostPort}, home ${home})\n`);

const stop = () => {
  for (const child of children) if (child.exitCode === null) child.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) child.on("exit", (code) => {
  if (code !== 0 && code !== null) console.error(`[web:vibe] a process exited with ${code}`);
  stop();
});
