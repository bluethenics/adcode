import { describe, expect, it } from "vitest";
import { validateDestination } from "../src/payoutCorridors.ts";
import type { PayoutCorridorRecord } from "../src/store.ts";

const corridor: PayoutCorridorRecord = {
  country: "IN",
  currency: "INR",
  enabled: true,
  requiredFields: ["accountNumber", "ifsc", "bankName"],
  sourceNote: "Verified manually in Wise recipient flow",
  verifiedAt: 1,
  updatedAt: 1,
  updatedBy: "admin-1",
};

describe("payout corridor validation", () => {
  it("accepts the exact bank fields required for an enabled corridor", () => {
    expect(
      validateDestination(corridor, {
        accountNumber: "1234567890",
        ifsc: "HDFC0001234",
        bankName: "HDFC Bank",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects disabled corridors, missing fields, unknown fields, and invalid IFSC", () => {
    const fields = { accountNumber: "1234567890", ifsc: "HDFC0001234", bankName: "HDFC" };
    expect(validateDestination({ ...corridor, enabled: false }, fields)).toMatchObject({ ok: false });
    expect(validateDestination(corridor, { ...fields, ifsc: "bad" })).toMatchObject({ ok: false });
    expect(validateDestination(corridor, { accountNumber: "123", ifsc: "HDFC0001234" })).toMatchObject({ ok: false });
    expect(validateDestination(corridor, { ...fields, password: "secret" })).toMatchObject({ ok: false });
  });
});
