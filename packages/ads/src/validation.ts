/**
 * Validate untrusted creatives and config from the network.
 *
 * Pure (brief §8). Every entry point takes a **raw JSON string**, not a parsed object,
 * and that is the whole reason this module is hand-rolled rather than delegated to a
 * schema library: `__proto__` has to be rejected during parsing. A schema validator
 * only ever sees an object that has already been constructed, by which point the
 * prototype pollution has already happened.
 */
import {
  err,
  micros,
  ok,
  TAG_VOCABULARY,
  type Balance,
  type Creative,
  type FrequencyPreset,
  type Micros,
  type RemoteCaps,
  type RemoteConfig,
  type Result,
  type ValidationError,
} from "./types.ts";

/* ── Limits ─────────────────────────────────────────────────────────────── */

const MAX_ADVERTISER = 40;
const MAX_HEADLINE = 80;
const MAX_BODY = 160;
const MAX_CREATIVE_ID = 64;
const MAX_URL = 2048;
const MAX_CREATIVES = 50;
/** int64 has 19 digits at most. */
const INT64_MAX = 9_223_372_036_854_775_807n;
const INT64_MIN = -9_223_372_036_854_775_808n;

const CREATIVE_ID = /^[A-Za-z0-9_-]+$/;
const DECIMAL_INT = /^-?[0-9]{1,19}$/;
const PRESETS_REQUIRED: readonly FrequencyPreset[] = ["off", "light", "standard", "max"];

const fail = (field: string, detail: string): Result<never, ValidationError> =>
  err({ kind: "validation", field, detail });

/* ── Parsing ────────────────────────────────────────────────────────────── */

const POLLUTING_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * `JSON.parse` with a reviver that refuses the polluting keys outright.
 *
 * Returning `undefined` from a reviver deletes the key, which would silently accept a
 * hostile payload. Throwing is the correct response: a server that sends `__proto__` is
 * not one whose other fields deserve the benefit of the doubt.
 */
function parseJson(raw: string): Result<unknown, ValidationError> {
  if (typeof raw !== "string" || raw.length === 0) return fail("$", "empty body");

  try {
    const value: unknown = JSON.parse(raw, function reviver(key, val: unknown) {
      if (POLLUTING_KEYS.has(key)) throw new Error(`polluting key: ${key}`);
      return val;
    });
    return ok(value);
  } catch (error) {
    return fail("$", error instanceof Error ? error.message : "malformed JSON");
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Rejects unknown fields rather than ignoring them (§9). */
function onlyKnownKeys(
  object: Record<string, unknown>,
  known: readonly string[],
  field: string,
): Result<true, ValidationError> {
  for (const key of Object.keys(object)) {
    if (!known.includes(key)) return fail(`${field}.${key}`, "unknown field");
  }
  return ok(true);
}

/* ── Scalars ────────────────────────────────────────────────────────────── */

/**
 * Strip markup and control characters, then length-check.
 *
 * Order matters: stripping first and checking length second means a payload cannot use
 * markup as padding to smuggle a long string past the cap.
 */
function text(
  value: unknown,
  field: string,
  max: number,
): Result<string, ValidationError> {
  if (typeof value !== "string") return fail(field, "expected a string");

  const stripped = value
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim();

  if (stripped.length === 0) return fail(field, "empty after stripping");
  if (value.length > max) return fail(field, `longer than ${max}`);
  return ok(stripped);
}

/**
 * §1: creative assets are `https` only, from an allowlisted host. The host check is
 * exact hostname equality - `endsWith` would accept `evil-cdn.adcode.test`, and
 * `includes` would accept `cdn.adcode.test.evil.test`.
 */
function url(
  value: unknown,
  field: string,
  requiredHost: string | null,
): Result<string, ValidationError> {
  if (typeof value !== "string") return fail(field, "expected a string");
  if (value.length > MAX_URL) return fail(field, "URL too long");

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fail(field, "malformed URL");
  }

  if (parsed.protocol !== "https:") return fail(field, `scheme ${parsed.protocol} is not https`);
  if (parsed.username !== "" || parsed.password !== "") return fail(field, "credentials in URL");
  if (requiredHost !== null && parsed.hostname !== requiredHost) {
    return fail(field, `host ${parsed.hostname} is not the allowlisted host`);
  }
  return ok(parsed.toString());
}

/**
 * Money arrives as a decimal string because JSON has no bigint. A JSON *number* is
 * rejected outright: by the time `JSON.parse` hands it over it is already a double, and
 * any precision it had beyond 2^53 is already gone.
 */
function money(value: unknown, field: string): Result<Micros, ValidationError> {
  if (typeof value === "number") return fail(field, "money must be a decimal string, not a number");
  if (typeof value !== "string") return fail(field, "expected a decimal string");
  if (!DECIMAL_INT.test(value)) return fail(field, "not a decimal integer string");

  const parsed = BigInt(value);
  if (parsed > INT64_MAX || parsed < INT64_MIN) return fail(field, "outside int64");
  return ok(micros(parsed));
}

function integer(
  value: unknown,
  field: string,
  min: number,
  max: number,
): Result<number, ValidationError> {
  if (typeof value !== "number" || !Number.isInteger(value)) return fail(field, "expected an integer");
  if (value < min || value > max) return fail(field, `outside [${min}, ${max}]`);
  return ok(value);
}

/* ── Creatives ──────────────────────────────────────────────────────────── */

const CREATIVE_KEYS = [
  "creativeId", "advertiser", "headline", "body", "clickUrl", "logoLight", "logoDark", "ttlMs",
  // Admin test cards carry this. It has to be listed: `onlyKnownKeys` rejects the whole
  // response over one unrecognised field, which is the right strictness and means every
  // new wire field must be admitted here before the server may send it.
  "test",
] as const;

function creative(value: unknown, index: number, assetHost: string): Result<Creative, ValidationError> {
  const at = `creatives[${index}]`;
  if (!isPlainObject(value)) return fail(at, "expected an object");

  const known = onlyKnownKeys(value, CREATIVE_KEYS, at);
  if (!known.ok) return known;

  const id = value["creativeId"];
  if (typeof id !== "string" || id.length === 0 || id.length > MAX_CREATIVE_ID || !CREATIVE_ID.test(id)) {
    return fail(`${at}.creativeId`, "must match [A-Za-z0-9_-]+");
  }

  const advertiser = text(value["advertiser"], `${at}.advertiser`, MAX_ADVERTISER);
  if (!advertiser.ok) return advertiser;

  const headline = text(value["headline"], `${at}.headline`, MAX_HEADLINE);
  if (!headline.ok) return headline;

  // §9 names a missing dark asset explicitly: a toast that goes invisible when the OS
  // flips at sunset is a broken ad, so both variants are required.
  const logoLight = url(value["logoLight"], `${at}.logoLight`, assetHost);
  if (!logoLight.ok) return logoLight;

  const logoDark = url(value["logoDark"], `${at}.logoDark`, assetHost);
  if (!logoDark.ok) return logoDark;

  const clickUrl = url(value["clickUrl"], `${at}.clickUrl`, null);
  if (!clickUrl.ok) return clickUrl;

  const ttlMs = integer(value["ttlMs"], `${at}.ttlMs`, 0, 7 * 24 * 60 * 60 * 1000);
  if (!ttlMs.ok) return ttlMs;

  let body: string | null = null;
  const rawBody = value["body"];
  if (rawBody !== null && rawBody !== undefined) {
    const parsed = text(rawBody, `${at}.body`, MAX_BODY);
    if (!parsed.ok) return parsed;
    body = parsed.value;
  }

  /*
   * Only a literal `true` counts.
   *
   * This flag lets a card skip the pacing rules, so anything ambiguous - a string, a 1,
   * a missing field - has to mean "no". Coercing here would let a malformed response
   * bypass the daily cap, which is precisely the shape of thing §1 refuses to allow a
   * server to do.
   */
  const test = value["test"] === true;

  return ok({
    creativeId: id,
    advertiser: advertiser.value,
    headline: headline.value,
    body,
    clickUrl: clickUrl.value,
    logoLight: logoLight.value,
    logoDark: logoDark.value,
    ttlMs: ttlMs.value,
    // `exactOptionalPropertyTypes` is on: an optional field cannot be set to `undefined`,
    // it has to be absent.
    ...(test ? { test: true } : {}),
  });
}

export function parseServeResponse(
  raw: string,
  assetHost: string,
): Result<Creative[], ValidationError> {
  const parsed = parseJson(raw);
  if (!parsed.ok) return parsed;
  if (!isPlainObject(parsed.value)) return fail("$", "expected an object");

  const known = onlyKnownKeys(parsed.value, ["creatives"], "$");
  if (!known.ok) return known;

  const list = parsed.value["creatives"];
  if (!Array.isArray(list)) return fail("creatives", "expected an array");
  if (list.length > MAX_CREATIVES) return fail("creatives", `more than ${MAX_CREATIVES}`);

  const out: Creative[] = [];
  for (let i = 0; i < list.length; i++) {
    const one = creative(list[i], i, assetHost);
    if (!one.ok) return one;
    out.push(one.value);
  }
  return ok(out);
}

/* ── Balance ────────────────────────────────────────────────────────────── */

export function parseBalanceResponse(raw: string): Result<Balance, ValidationError> {
  const parsed = parseJson(raw);
  if (!parsed.ok) return parsed;
  if (!isPlainObject(parsed.value)) return fail("$", "expected an object");

  const known = onlyKnownKeys(parsed.value, ["availableMicros", "lifetimeMicros"], "$");
  if (!known.ok) return known;

  const available = money(parsed.value["availableMicros"], "availableMicros");
  if (!available.ok) return available;

  const lifetime = money(parsed.value["lifetimeMicros"], "lifetimeMicros");
  if (!lifetime.ok) return lifetime;

  return ok({ availableMicros: available.value, lifetimeMicros: lifetime.value });
}

/* ── Config ─────────────────────────────────────────────────────────────── */

function caps(value: unknown): Result<RemoteCaps, ValidationError> {
  if (!isPlainObject(value)) return fail("caps", "expected an object");

  const known = onlyKnownKeys(value, ["minIntervalMs", "dailyCap"], "caps");
  if (!known.ok) return known;

  const out: { minIntervalMs?: number; dailyCap?: number } = {};

  if (value["minIntervalMs"] !== undefined) {
    const parsed = integer(value["minIntervalMs"], "caps.minIntervalMs", 0, 24 * 60 * 60 * 1000);
    if (!parsed.ok) return parsed;
    out.minIntervalMs = parsed.value;
  }

  if (value["dailyCap"] !== undefined) {
    const parsed = integer(value["dailyCap"], "caps.dailyCap", 0, 1000);
    if (!parsed.ok) return parsed;
    out.dailyCap = parsed.value;
  }

  // Note that `scheduler.tightenCaps` will discard anything hostile that reaches it
  // anyway. This is the outer of two layers, not the only one.
  return ok(out);
}

function projections(value: unknown): Result<Record<FrequencyPreset, Micros>, ValidationError> {
  if (!isPlainObject(value)) return fail("projections", "expected an object");

  const known = onlyKnownKeys(value, PRESETS_REQUIRED, "projections");
  if (!known.ok) return known;

  const out = {} as Record<FrequencyPreset, Micros>;
  for (const preset of PRESETS_REQUIRED) {
    const parsed = money(value[preset], `projections.${preset}`);
    if (!parsed.ok) return parsed;
    out[preset] = parsed.value;
  }
  return ok(out);
}

export function parseConfigResponse(raw: string): Result<RemoteConfig, ValidationError> {
  const parsed = parseJson(raw);
  if (!parsed.ok) return parsed;
  if (!isPlainObject(parsed.value)) return fail("$", "expected an object");

  const known = onlyKnownKeys(parsed.value, ["killSwitch", "caps", "projections"], "$");
  if (!known.ok) return known;

  const killSwitch = parsed.value["killSwitch"];
  if (typeof killSwitch !== "boolean") return fail("killSwitch", "expected a boolean");

  const parsedCaps = caps(parsed.value["caps"]);
  if (!parsedCaps.ok) return parsedCaps;

  const parsedProjections = projections(parsed.value["projections"]);
  if (!parsedProjections.ok) return parsedProjections;

  return ok({
    killSwitch,
    caps: parsedCaps.value,
    projections: parsedProjections.value,
  });
}

/* ── Receipts ───────────────────────────────────────────────────────────── */

export function parseReceiptsResponse(raw: string): Result<string[], ValidationError> {
  const parsed = parseJson(raw);
  if (!parsed.ok) return parsed;
  if (!isPlainObject(parsed.value)) return fail("$", "expected an object");

  const known = onlyKnownKeys(parsed.value, ["acked"], "$");
  if (!known.ok) return known;

  const acked = parsed.value["acked"];
  if (!Array.isArray(acked)) return fail("acked", "expected an array");

  const out: string[] = [];
  for (let i = 0; i < acked.length; i++) {
    const id: unknown = acked[i];
    if (typeof id !== "string" || !CREATIVE_ID.test(id) || id.length > MAX_CREATIVE_ID) {
      return fail(`acked[${i}]`, "malformed receipt id");
    }
    out.push(id);
  }
  return ok(out);
}

/** Re-exported so callers can assert a served tag set never left the vocabulary. */
export const KNOWN_TAGS: readonly string[] = TAG_VOCABULARY;
