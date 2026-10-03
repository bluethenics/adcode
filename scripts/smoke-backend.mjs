/**
 * A backend for smoke runs that is not production.
 *
 * With `ADCODE_AD_SERVER` unset the app talks to production and Firebase, and a smoke run
 * launches from a fresh `--user-data-dir` every time - so every run signed up a brand-new
 * anonymous account, reported its activity, and showed up in /v1/stats and the admin Growth
 * panel as one more developer.
 *
 * The mock server answers the ad contract and, through `ADCODE_AUTH_EMULATOR`, Firebase Auth
 * at its emulator's paths. So the account button, the account id and the earnings presets
 * still have something real-shaped to show, and `server.signUpCount()` proves where the
 * account was made.
 */
import { createMockServer } from "../mock-server/src/server.ts";

export async function startSmokeBackend() {
  const server = await createMockServer();

  // No inventory. Ads have their own run, `smoke-ads.mjs`; a toast arriving here would land
  // on top of whichever check happened to be running.
  server.seed([]);

  return {
    server,
    env: { ADCODE_AD_SERVER: server.url, ADCODE_AUTH_EMULATOR: server.url },
  };
}
