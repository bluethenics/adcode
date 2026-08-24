/**
 * Run the service as a standalone process.
 *
 * In production the API is not started this way - it ships inside the Next app and is
 * reached through `apps/web/src/app/v1/[...segments]/route.ts`, which uses the same
 * adapters against the Fetch transport. This entry point is for running the real API
 * locally against a real Supabase project, which is worth being able to do without a
 * Cloudflare deployment in the way.
 *
 * Defaults to 8788 so it does not collide with the mock server on 8787.
 */
import { createApiServer } from "./server.ts";
import { createFirebaseJwksVerifier } from "../adapters/firebaseJwks.ts";
import { createSupabaseStore } from "../adapters/supabaseStore.ts";
import { createDodoProvider } from "../adapters/dodoPayments.ts";

const port = Number(process.env["PORT"] ?? 8788);

const server = await createApiServer({
  port,
  store: createSupabaseStore(),
  verifier: createFirebaseJwksVerifier(),
  payments: createDodoProvider(),
});

process.stdout.write(`api listening on ${server.url}\n`);
