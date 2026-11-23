import { doneCardDocument, maskEmail, type DoneRow } from "../../../../services/api/src/doneCard.ts";

/**
 * The page the sign-in browser tab lands on once the loopback server has its answer.
 *
 * It uses the shared success card (`services/api/src/doneCard.ts`): the same design as the
 * website's `/desktop-sign-in` tab that came before it and every other ADCode "done" page, so
 * the whole round trip looks like one product. It stays complete after the loopback listener
 * closes: no script, no network, the icon drawn inline.
 *
 * No button: ADCode registers no URL scheme a browser could open it with, and a button that
 * did nothing would be worse than none. The small print says where to go instead.
 */
export function resultPage(heading: string, detail: string, ok: boolean, provider = "Google", extra: { account?: string | undefined; label?: string } = {}): string {
  const masked = maskEmail(extra.account);
  const service = extra.label ?? (provider === "GitHub" ? "Connected service" : "Sign-in provider");
  const rows: DoneRow[] = [
    ...(masked === "" ? [] : [{ label: "Account", value: masked }]),
    { label: service, value: provider },
    ok ? { label: "Signed in on", value: "ADCode on this computer" } : { label: "Status", value: "Not connected" },
  ];
  return doneCardDocument({
    tone: ok ? "ok" : "warn",
    title: heading,
    rows,
    notes: [detail, ok ? "You can close this tab." : "If you didn't start this in ADCode, close this tab."],
  }, { favicon: true });
}

/**
 * The email in a Google ID token, for the result page to show masked.
 * Display only: the token is verified later, by the API, before anything trusts it.
 */
export function emailFromIdToken(idToken: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: unknown };
    return typeof payload.email === "string" ? payload.email : undefined;
  } catch {
    return undefined;
  }
}

export const RESULT_PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
