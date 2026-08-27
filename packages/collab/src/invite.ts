/**
 * The invite code: how a guest learns where to connect and proves they were invited.
 *
 * One string the host reads out or pastes into a chat. It carries an address, a port, and a
 * shared secret, because all three are needed and asking a beginner to type three fields into
 * three boxes is how a feature goes unused.
 *
 * **The token is the whole access control story on a LAN.** The host's server is reachable by
 * anything on the network - that is what makes collaboration possible and it is also the
 * exposure. Nothing else identifies a peer: there are no accounts, and an IP address is not a
 * credential. So the token is generated per session, is never reused, and a socket that fails
 * to present it is closed before it can touch any session state.
 *
 * What this cannot do, stated plainly because the UI has to say it too: LAN traffic is
 * unencrypted. Anyone positioned to read packets on the network can read the code as it goes
 * past and the file contents after it. On a home network that is the same trust boundary the
 * live preview server already assumes; on a café network it is not, and no amount of token
 * entropy changes that. TLS is the fix and it is not built.
 *
 * Pure: no `crypto`, no `Math.random`. `newToken` takes its randomness as an argument, so the
 * codec is testable and the caller decides what "random" means - which for the host is
 * `randomBytes` from `node:crypto`, never `Math.random`.
 */

export interface Invite {
  /** An IPv4 address or hostname. Never a URL: no scheme, no path, no credentials. */
  readonly host: string;
  readonly port: number;
  readonly token: string;
  /** The host's display name, so a guest sees whose session they are joining before joining. */
  readonly label: string;
}

/** Marks a code as ours, so a user pasting something else gets a clear refusal. */
const PREFIX = "adcode1:";

const MAX_LABEL = 64;
const TOKEN_BYTES = 24;

/**
 * Base64url without padding.
 *
 * A code gets pasted into chat clients, terminals and issue trackers. `+` and `/` survive
 * that trip unreliably - `/` invites line-wrapping and `+` becomes a space through some form
 * encoders - and a trailing `=` is the single most commonly truncated character in a
 * copy-paste. Avoiding all three is cheaper than diagnosing "the code does not work".
 */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9\-_]*$/.test(text)) return null;

  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = padded.length % 4;
  if (remainder === 1) return null;

  try {
    const binary = atob(padded + "=".repeat(remainder === 0 ? 0 : 4 - remainder));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * A session token from caller-supplied randomness.
 *
 * Refuses short input rather than padding it. A token silently weakened to a few bytes is
 * worse than a failure to start a session, because the session would appear to work.
 */
export function newToken(random: Uint8Array): string {
  if (random.length < TOKEN_BYTES) {
    throw new Error(`A session token needs at least ${TOKEN_BYTES} bytes of randomness.`);
  }

  return toBase64Url(random.subarray(0, TOKEN_BYTES));
}

/**
 * Is this a host we are willing to dial?
 *
 * An allow-list of shapes, not a deny-list of bad ones. The decoded host becomes a network
 * destination, so anything that could smuggle a scheme, a path, credentials, or a second host
 * past a URL constructor is refused here: `@`, `/`, `:`, `?`, `#`, whitespace and control
 * characters are all rejected by these patterns rather than stripped.
 */
function isPlausibleHost(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;

  // Dotted-quad, each octet 0-255. The overwhelmingly common case on a LAN.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return host.split(".").every((part) => {
      const value = Number(part);
      // A leading zero makes an octet ambiguous - some resolvers read `010` as octal - so a
      // padded octet is refused rather than guessed at.
      return value <= 255 && String(value) === part;
    });
  }

  /*
   * An all-numeric name is refused, having already failed the dotted-quad test above.
   *
   * `1.2.3` is a syntactically legal DNS name, so the hostname pattern below accepts it - and
   * that is the hole. The C `inet_aton` family, which a great deal of networking code still
   * reaches through, reads a three-part address by expanding the last part: `1.2.3` becomes
   * `1.2.0.3`, and `1.2.3.4.5` is rejected by some resolvers and accepted by others. So a
   * name made only of digits and dots either is an address, in which case it must be a
   * complete one, or it is something whose meaning depends on which resolver sees it. Neither
   * is a destination worth dialling on the strength of a pasted string.
   */
  if (/^[\d.]+$/.test(host)) return false;

  // Otherwise a hostname: letters, digits, hyphens and dots, with no label starting or ending
  // in a hyphen. Deliberately no `[...]` IPv6 form - it is not supported rather than
  // half-supported, and `decodeInvite` says so by refusing it.
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(host);
}

function isPlausiblePort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

/**
 * Encode an invite.
 *
 * Throws on invalid input rather than producing a code that cannot be decoded. This is called
 * with values the host itself just chose, so a failure here is a bug in this program - not
 * untrusted input - and the loud version is the useful one.
 */
export function encodeInvite(invite: Invite): string {
  if (!isPlausibleHost(invite.host)) throw new Error(`Not a usable host: ${invite.host}`);
  if (!isPlausiblePort(invite.port)) throw new Error(`Not a usable port: ${invite.port}`);
  if (invite.token.length === 0) throw new Error("An invite needs a token.");

  const payload = JSON.stringify({
    h: invite.host,
    p: invite.port,
    t: invite.token,
    l: invite.label.slice(0, MAX_LABEL),
  });

  const bytes = new TextEncoder().encode(payload);
  return `${PREFIX}${toBase64Url(bytes)}`;
}

/**
 * Decode a pasted invite, or `null`.
 *
 * `null` for everything: wrong prefix, bad base64, malformed JSON, a field of the wrong type,
 * an implausible host or port. Same single failure mode as `protocol.parse`, and this input is
 * even less trustworthy - it arrives through the clipboard, so it may have been truncated by a
 * chat client, wrapped by a terminal, or simply be a URL the user pasted by mistake.
 *
 * Surrounding whitespace is trimmed because a pasted line reliably carries some.
 */
export function decodeInvite(code: string): Invite | null {
  if (typeof code !== "string") return null;

  const trimmed = code.trim();
  if (!trimmed.startsWith(PREFIX)) return null;

  const bytes = fromBase64Url(trimmed.slice(PREFIX.length));
  if (bytes === null || bytes.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const host = record["h"];
  const port = record["p"];
  const token = record["t"];
  const label = record["l"];

  if (typeof host !== "string" || !isPlausibleHost(host)) return null;
  if (typeof port !== "number" || !isPlausiblePort(port)) return null;
  if (typeof token !== "string" || token.length === 0 || token.length > 128) return null;
  if (typeof label !== "string" || label.length > MAX_LABEL) return null;

  return { host, port, token, label };
}

/**
 * A shortened code for display.
 *
 * The full code is long enough to wrap in a status bar. This is for showing *that* there is a
 * code, never for reconstructing one - the user copies the real thing to their clipboard.
 */
export function abbreviateInvite(code: string): string {
  if (code.length <= 24) return code;
  return `${code.slice(0, 16)}…${code.slice(-4)}`;
}
