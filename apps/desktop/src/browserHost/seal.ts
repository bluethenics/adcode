/**
 * `safeStorage` sealing for the browser host (stands in for host/seal.ts).
 *
 * The cloud host seals saved API keys with a key its Durable Object holds outside the sandbox.
 * A browser has no such place: any key would sit in the same origin's storage as what it
 * locks. So, like any web app's saved settings, a person's own API keys stay in this browser's
 * storage for this site only, readable by nobody else. The marker keeps the format apart from
 * the cloud's sealed values, so one is never mistaken for the other.
 */
const MARK = "adcode-browser:";

export function sealString(plain: string, _key: string): Buffer {
  return Buffer.from(MARK + plain, "utf8");
}

export function unsealString(sealed: Buffer, _key: string): string {
  const text = Buffer.from(sealed).toString("utf8");
  if (!text.startsWith(MARK)) throw new Error("This value was not saved by this browser");
  return text.slice(MARK.length);
}
