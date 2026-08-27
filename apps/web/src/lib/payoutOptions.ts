/**
 * The choices the payout form offers.
 *
 * Re-declared here rather than imported from `services/api`, following the same rule the
 * serving contract does (spec D1): a client that imports the server's list cannot catch a
 * mismatch with it. The server refuses anything outside its own list, so a value that
 * drifts out of step fails at the boundary rather than being stored and discovered by the
 * person trying to make the transfer.
 *
 * Currencies are the ones Wise can pay out in. Countries are where a recipient's account
 * can be - a much longer list, because somebody can hold a EUR account from almost
 * anywhere, and refusing a country is refusing a person.
 */
export const CURRENCIES = [
  "USD", "EUR", "GBP", "AUD", "CAD", "NZD", "SGD", "JPY", "CHF", "SEK", "NOK", "DKK",
  "PLN", "CZK", "HUF", "RON", "BGN", "TRY", "AED", "INR", "PKR", "BDT", "LKR", "NPR",
  "PHP", "IDR", "MYR", "THB", "VND", "HKD", "KRW", "CNY", "ZAR", "NGN", "KES", "GHS",
  "EGP", "MAD", "BRL", "MXN", "ARS", "CLP", "COP", "PEN", "UYU", "ILS", "SAR", "QAR",
  "UAH", "GEL", "KZT",
] as const;

export const COUNTRY_CODES = [
  "AE", "AR", "AT", "AU", "BD", "BE", "BG", "BR", "CA", "CH", "CL", "CN", "CO", "CY",
  "CZ", "DE", "DK", "EE", "EG", "ES", "FI", "FR", "GB", "GE", "GH", "GR", "HK", "HR",
  "HU", "ID", "IE", "IL", "IN", "IT", "JP", "KE", "KR", "KZ", "LK", "LT", "LU", "LV",
  "MA", "MT", "MX", "MY", "NG", "NL", "NO", "NP", "NZ", "PE", "PH", "PK", "PL", "PT",
  "QA", "RO", "RS", "SA", "SE", "SG", "SI", "SK", "TH", "TR", "UA", "US", "UY", "VN",
  "ZA",
] as const;

/**
 * A country's name in the reader's own language, falling back to the code.
 *
 * `Intl.DisplayNames` is in every browser this site supports and in Node, so the list
 * above stays a list of codes rather than a table of names nobody maintains. The fallback
 * matters on the server during static generation, where the constructor can throw.
 */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Codes with names, sorted the way a person reads them. */
export function countryOptions(): { code: string; label: string }[] {
  return COUNTRY_CODES.map((code) => ({ code, label: countryName(code) })).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}

/**
 * A dollars-and-cents string to micros.
 *
 * Returns null on anything that is not a plain amount, and refuses more than two decimal
 * places: this figure becomes a bank transfer, and a bank moves whole cents.
 */
export function dollarsToPayoutMicros(input: string): string | null {
  const match = /^\s*\$?\s*([0-9]{1,12})(?:\.([0-9]{1,2}))?\s*$/.exec(input);
  if (match === null) return null;

  const whole = BigInt(match[1] as string);
  const cents = BigInt((match[2] ?? "").padEnd(2, "0"));

  return (whole * 1_000_000n + cents * 10_000n).toString();
}

/** Micros down to the cent below, as the plain number an input should hold. */
export function microsToDollarsInput(micros: string): string {
  const value = BigInt(micros || "0");
  const abs = value < 0n ? -value : value;
  const whole = abs / 1_000_000n;
  const cents = (abs % 1_000_000n) / 10_000n;
  return `${whole}.${cents.toString().padStart(2, "0")}`;
}
