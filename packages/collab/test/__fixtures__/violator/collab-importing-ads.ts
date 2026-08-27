/**
 * A deliberate firewall violation. Not real code, and never compiled or shipped:
 * excluded from tsconfig, from the main dependency-cruiser run, and from vitest.
 *
 * It exists so `firewall.test.ts` can prove the `collab-must-not-import-ads` rule actually
 * fires. The rule matters because `packages/collab` exists to send the user's source code to
 * another machine, and `packages/ads` promises that nothing from the user's code leaves the
 * machine through an ad request - so an import in either direction would put a transport built
 * for shipping source code inside reach of the pipeline that promises not to ship it.
 *
 * A guard that has never been seen to fire is not known to work.
 */
import type { Balance } from "../../../../ads/src/index.ts";

export const leak = (balance: Balance): bigint => balance.availableMicros;
