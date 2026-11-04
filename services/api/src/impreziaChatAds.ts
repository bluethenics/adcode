/** Environment selection for the SDK relay. Ad requests and measurement belong to the SDK. */
export function impreziaBaseUrl(key: string): string {
  if (key.startsWith("api_pub_sandbox_")) return "https://api-sandbox.imprezia.ai";
  if (key.startsWith("api_pub_beta_")) return "https://api-beta.imprezia.ai";
  return "https://api.imprezia.ai";
}

/**
 * Which of Imprezia's environments a publisher key belongs to. The admin sees this word, never
 * the key: "sandbox" serves test ads with no revenue, "live" is the production key that earns.
 */
export type ImpreziaKeyMode = "sandbox" | "beta" | "live";
export function impreziaKeyMode(key: string): ImpreziaKeyMode {
  return key.startsWith("api_pub_sandbox_") ? "sandbox" : key.startsWith("api_pub_beta_") ? "beta" : "live";
}

/** Sandbox ads are house ads with no revenue behind them; they never pay a user. */
export const isImpreziaSandboxKey = (key: string): boolean => key.startsWith("api_pub_sandbox_");

/** Read-only compatibility for deliveries issued before the SDK-only integration. */
export interface ImpreziaImpression { uuid: string; token: string; issuedAt: number; kid: string }
const PREFIX = "imprezia1:";
export function unpackImpression(raw: string): ImpreziaImpression | null {
  if (!raw.startsWith(PREFIX)) return null;
  try {
    const [uuid, token, issuedAt, kid] = JSON.parse(raw.slice(PREFIX.length)) as unknown[];
    return typeof uuid === "string" && typeof token === "string" && typeof kid === "string" && Number.isSafeInteger(issuedAt)
      ? { uuid, token, issuedAt: issuedAt as number, kid } : null;
  } catch { return null; }
}
