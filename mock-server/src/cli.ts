/**
 * Standalone entry point: `npm run mock-server`.
 *
 * Node 24 runs this TypeScript directly, so there is no build step (brief §10).
 */
import { createMockServer, PUBLIC_ASSET_HOST } from "./server.ts";

const port = Number(process.env["PORT"] ?? 8787);
const server = await createMockServer({ port });

process.stdout.write(
  [
    `ADCode mock server`,
    `  api           ${server.url}/v1`,
    `  assets        ${server.assetOrigin}`,
    `  advertised as ${server.publicAssetOrigin}  (allowlist host: ${PUBLIC_ASSET_HOST})`,
    `  reset         POST ${server.url}/__test__/reset`,
    ``,
  ].join("\n"),
);

const shutdown = (): void => {
  void server.close().then(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
