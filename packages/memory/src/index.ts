/**
 * Shared AI memory store.
 *
 * Deliberately empty in slice 1. It exists so the firewall rule in
 * `.dependency-cruiser.cjs` has a real target to guard, and so the planted-violation
 * test has something real to import. The store itself is slice 2.
 *
 * Brief §1: `packages/ads` may not import from here, and no memory content may reach
 * any `/v1/*` endpoint. The ad side promises that nothing from the user's code ever
 * leaves the machine; this package is full of exactly that.
 */

export interface MemoryRecord {
  readonly name: string;
  readonly description: string;
  readonly type: "decision" | "convention" | "preference" | "session" | "index";
  readonly created: string;
  readonly agents: readonly string[];
  readonly body: string;
}
