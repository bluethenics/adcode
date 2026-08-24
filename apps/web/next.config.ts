import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/** This file's directory. `import.meta.dirname` is not in this project's `ImportMeta` type. */
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * This deploys to a Cloudflare Worker via `@opennextjs/cloudflare`.
 *
 * No `output: "standalone"`. That existed for Cloud Run, which needed a self-contained
 * Node server in a container; the Cloudflare adapter builds its own bundle from `.next` and
 * a standalone copy alongside it is just a second, unused build of the same app.
 */
const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /*
   * `services/api` lives outside this app's directory, and `/v1/*` imports it. Next
   * refuses to bundle files from outside the project root without this.
   */
  experimental: { externalDir: true },

  /*
   * Pin the root Turbopack resolves modules against. Files outside it are not resolved at
   * all, and `@adcode/api/*` points at `../../services/api/*`, so getting this wrong fails
   * the build with a module-not-found on every adapter.
   *
   * It has to be pinned because Next infers the root from the nearest lockfile, and that
   * inference depends on the working directory: from the repository root it picks the
   * repository, but `npm run deploy` runs from `apps/web`, where it picks `apps/web` and
   * puts the API outside the project. Same code, same command, two different answers.
   */
  turbopack: { root: join(HERE, "..", "..") },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default config;
