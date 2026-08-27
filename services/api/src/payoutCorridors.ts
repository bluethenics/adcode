import type { PayoutCorridorRecord, PayoutFieldKind } from "./store.ts";

const validators: Record<PayoutFieldKind, RegExp> = {
  iban: /^[A-Z]{2}[0-9A-Z]{13,32}$/,
  bic: /^[A-Z0-9]{8}(?:[A-Z0-9]{3})?$/,
  accountNumber: /^[0-9A-Z -]{3,34}$/,
  routingNumber: /^[0-9]{9}$/,
  sortCode: /^(?:[0-9]{2}-?){2}[0-9]{2}$/,
  ifsc: /^[A-Z]{4}0[A-Z0-9]{6}$/,
  bsb: /^[0-9]{3}-?[0-9]{3}$/,
  bankCode: /^[0-9A-Z -]{2,20}$/,
  branchCode: /^[0-9A-Z -]{2,20}$/,
  clabe: /^[0-9]{18}$/,
  bankName: /^[^<>]{2,120}$/,
  address: /^[^<>]{5,240}$/,
  email: /^[^@\s]+@[^@\s.]+\.[^@\s]+$/,
  phone: /^\+?[0-9 ()-]{7,24}$/,
  supplemental: /^[^<>]{1,300}$/,
};

export const PAYOUT_FIELD_KINDS = Object.freeze(Object.keys(validators) as PayoutFieldKind[]);

export function validateDestination(
  corridor: PayoutCorridorRecord,
  fields: Record<string, string>,
): { ok: true } | { ok: false; reason: string } {
  if (!corridor.enabled) return { ok: false, reason: "corridor-disabled" };
  const allowed = new Set(corridor.requiredFields);
  for (const key of Object.keys(fields)) {
    if (!allowed.has(key as PayoutFieldKind)) return { ok: false, reason: `unexpected-field:${key}` };
  }
  for (const kind of corridor.requiredFields) {
    const value = fields[kind]?.trim();
    if (value === undefined || value.length === 0) return { ok: false, reason: `missing-field:${kind}` };
    if (!validators[kind].test(value)) return { ok: false, reason: `invalid-field:${kind}` };
  }
  return { ok: true };
}
