import type { NextConfig } from "next";

/**
 * `standalone` because this deploys to Cloud Run next to `services/api` - the output
 * carries its own trimmed node_modules, so the container does not need the repo's root
 * install (which includes Electron and Monaco, neither of which the site has any use for).
 */
const config: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,

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
