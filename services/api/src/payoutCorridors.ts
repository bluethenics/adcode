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

/**
 * Kinds that are a code rather than prose, and are printed in groups on a statement.
 *
 * "GB29 NWBK 6016 1331 9268 19" is how a bank shows an IBAN and how a person types it, and
 * the validator above accepts no spaces at all. Rejecting that as malformed teaches people
 * that the form is broken; stripping the spaces is what every bank's own form does.
 */
const CODE_KINDS: ReadonlySet<string> = new Set<PayoutFieldKind>([
  "iban",
  "bic",
  "ifsc",
  "sortCode",
  "bsb",
  "bankCode",
  "branchCode",
  "routingNumber",
  "clabe",
  "accountNumber",
]);

/** One field, as it should be stored: what the human meant, not what they typed. */
export function normalizeField(kind: string, value: string): string {
  const trimmed = value.trim();
  if (!CODE_KINDS.has(kind)) return trimmed.replace(/\s+/g, " ");
  return trimmed.replace(/\s+/g, "").toUpperCase();
}

/** The same, across a whole destination. Unknown keys are passed through to be refused. */
export function normalizeFields(fields: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).map(([kind, value]) => [kind, normalizeField(kind, value)]),
  );
}

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
