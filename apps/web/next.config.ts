import type { NextConfig } from "next";

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
