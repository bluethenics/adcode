/**
 * Run the service.
 *
 * Cloud Run supplies PORT; locally it defaults to 8788 so it does not collide with the
 * mock server on 8787.
 */
import { createApiServer } from "./server.ts";
import { createFirebaseVerifier } from "../adapters/firebaseAuth.ts";
import { createFirestoreStore } from "../adapters/firestoreStore.ts";

const port = Number(process.env["PORT"] ?? 8788);

const server = await createApiServer({
  port,
  store: createFirestoreStore(),
  verifier: createFirebaseVerifier(),
});

process.stdout.write(`api listening on ${server.url}\n`);
