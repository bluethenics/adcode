/**
 * A deliberate firewall violation. Not real code, and never compiled or shipped:
 * excluded from tsconfig, from the main dependency-cruiser run, and from vitest.
 *
 * It exists so `firewall.test.ts` can prove the rule actually fires. A guard that has
 * never been seen to fire is not known to work.
 */
import type { MemoryRecord } from "../../../../memory/src/index.ts";

export const leak = (record: MemoryRecord): string => record.body;
