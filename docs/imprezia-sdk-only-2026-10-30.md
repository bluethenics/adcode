# Imprezia SDK-only integration — 30 October 2026

Imprezia confirmed that Chat Ads must use its official SDK. Although sponsored cards under AI replies already used the SDK, the native desktop fallback and admin connection test still called the direct Chat Ads endpoint. A successful response from that endpoint did not validate the required integration.

## Changes

- Removed the direct Chat Ads adapter and handwritten impression reporting. Imprezia no longer participates in native desktop ad serving. Its sponsored chat cards use the existing opt-in browser SDK integration.
- Admin **Test** now mounts the official SDK and its card renderer with a sample conversation. The publisher key stays encrypted on the server. A five-minute permit lets the SDK preview the selected connection, including a disabled one; permits are bound to that connection and its current key.
- The SDK chooses its request paths, renders cards, and reports viewability and impressions. ADCode's server only relays the SDK's monetize and event calls with the saved publisher key.
- Already-issued native deliveries can still settle once at their recorded rates, without new provider requests. SDK cards do not automatically credit ADCode user balances; the admin panel now states this explicitly.
- Updated the guide, provider explanation, tests and demo script to match this behavior.

## Validation

- 47 focused API, storage, admin and desktop tests pass, including admin authorization, disabled-connection previews, permit expiry/tampering/key rotation, the forbidden direct route, and existing receipt settlement.
- Root and website TypeScript checks pass. The isolated Next.js/OpenNext production build passes, and its compiled server contains no direct Chat Ads endpoint reference.
- The actual SDK made one monetize request across React Strict Mode effect retries. The sandbox returned HTTP 200 with no inventory during verification; the UI displayed the no-ad state.
- A separate, labelled local fixture verified the SDK's card rendering and its three impression/telemetry requests. Fixture traffic was handled locally and billed no advertiser. These screenshots are rendering evidence, not evidence of live ad fill.

The release was prepared from the production source snapshot, compared again after the concurrent model-wallet deployment, and synchronized into the shared release source. It is live as Worker version `73602abd-8bee-4954-b177-788c7f64bafe`, build `t60e2tsSH7yC-9qLuhvzm`. A fresh upload session resolved the first asset-upload authorization failure.

Live server checks confirm the direct ad route returns 404, an expired preview permit returns 403, unauthenticated admin tests return 401, and the model-wallet catalogue remains available. Browser automation stopped because it could not confidently determine the current browser URL; live admin clicking was not repeated through that tool.
