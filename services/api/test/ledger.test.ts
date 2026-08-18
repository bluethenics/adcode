import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { foldBalance, applyEntry, EMPTY_BALANCE, type LedgerEntry, type LedgerKind } from "../src/ledger.ts";

let seq = 0;
const entry = (kind: LedgerKind, micros: bigint): LedgerEntry => ({
  entryId: `e-${++seq}`,
  uid: "u-1",
  kind,
  micros,
  refId: null,
  createdAt: seq,
  description: "",
});

describe("foldBalance", () => {
  it("is empty for no entries", () => {
    expect(foldBalance([])).toEqual(EMPTY_BALANCE);
  });

  it("counts credits toward both available and lifetime", () => {
    const b = foldBalance([entry("impression", 2000n), entry("click", 3000n)]);
    expect(b.availableMicros).toBe(5000n);
    expect(b.lifetimeMicros).toBe(5000n);
  });

  it("subtracts a reversal from available and from lifetime", () => {
    // Lifetime is 'what you actually earned', so a clawback must reduce it too -
    // otherwise a fraudulent user keeps a lifetime figure they never legitimately earned.
    const b = foldBalance([entry("impression", 2000n), entry("reversal", -2000n)]);
    expect(b.availableMicros).toBe(0n);
    expect(b.lifetimeMicros).toBe(0n);
  });

  it("moves a requested withdrawal from available into pending", () => {
    const b = foldBalance([entry("impression", 5000n), entry("withdrawal_requested", -3000n)]);
    expect(b.availableMicros).toBe(2000n);
    expect(b.pendingWithdrawalMicros).toBe(3000n);
    expect(b.lifetimeMicros).toBe(5000n);
  });

  it("clears pending when a withdrawal is paid, without touching available", () => {
    const b = foldBalance([
      entry("impression", 5000n),
      entry("withdrawal_requested", -3000n),
      entry("withdrawal_paid", -3000n),
    ]);
    expect(b.availableMicros).toBe(2000n);
    expect(b.pendingWithdrawalMicros).toBe(0n);
  });

  it("returns a failed withdrawal to available", () => {
    const b = foldBalance([
      entry("impression", 5000n),
      entry("withdrawal_requested", -3000n),
      entry("withdrawal_failed", 3000n),
    ]);
    expect(b.availableMicros).toBe(5000n);
    expect(b.pendingWithdrawalMicros).toBe(0n);
  });

  it("lets an adjustment move available in either direction", () => {
    expect(foldBalance([entry("adjustment", 700n)]).availableMicros).toBe(700n);
    expect(foldBalance([entry("impression", 700n), entry("adjustment", -200n)]).availableMicros).toBe(500n);
  });

  it("leaves lifetime untouched by an adjustment", () => {
    // An adjustment corrects a balance; it is not something the user earned.
    expect(foldBalance([entry("adjustment", 700n)]).lifetimeMicros).toBe(0n);
  });
});

describe("the fold is the invariant", () => {
  it("agrees with applyEntry over any sequence", () => {
    const kinds: LedgerKind[] = ["impression", "click", "reversal", "adjustment"];
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            kind: fc.constantFrom(...kinds),
            micros: fc.bigInt({ min: -(10n ** 9n), max: 10n ** 9n }),
          }),
          { maxLength: 200 },
        ),
        (raw) => {
          const entries = raw.map((r) => entry(r.kind, r.micros));
          const folded = foldBalance(entries);
          const stepped = entries.reduce(applyEntry, EMPTY_BALANCE);
          expect(stepped).toEqual(folded);
        },
      ),
    );
  });

  it("never lets pending go negative", () => {
    fc.assert(
      fc.property(fc.array(fc.bigInt({ min: 0n, max: 10n ** 6n }), { maxLength: 50 }), (amounts) => {
        const entries = amounts.map((a) => entry("withdrawal_requested", -a));
        expect(foldBalance(entries).pendingWithdrawalMicros >= 0n).toBe(true);
      }),
    );
  });

  it("keeps a full withdrawal round trip conservative", () => {
    // Request then fail must land exactly where it started, whatever the amounts.
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 9n }), (amount) => {
        const before = foldBalance([entry("impression", 10n ** 9n)]);
        const after = foldBalance([
          entry("impression", 10n ** 9n),
          entry("withdrawal_requested", -amount),
          entry("withdrawal_failed", amount),
        ]);
        expect(after).toEqual(before);
      }),
    );
  });
});
