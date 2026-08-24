/**
 * Reading "what is listening on this machine" out of the tools that already know.
 *
 * There is no cross-platform Node API for enumerating listening sockets, so this shells
 * out - `netstat` on Windows, `lsof` everywhere else - and parses. Parsing is the whole
 * risk: the commands differ per OS, their columns differ per version, and none of that is
 * reproducible on a developer's machine on demand.
 *
 * So the parsing lives here, pure, with no `child_process`, no `electron` and no I/O of
 * any kind. `ports.ts` runs the commands and calls in. That is what lets the awkward cases
 * - IPv6 rows, a header line, a process name containing a space, the same port bound on
 * two address families - be tested from captured fixtures rather than hoped about.
 */

/** One row as the OS reported it, before ownership and deduplication are applied. */
export interface RawListener {
  readonly port: number;
  readonly pid: number | null;
  /** The bound address, e.g. `127.0.0.1`, `0.0.0.0` or `::`. */
  readonly address: string;
  /** The process image name, when the source knew it. `lsof` does; `netstat` does not. */
  readonly process: string | null;
}

/**
 * Split `127.0.0.1:5173` or `[::]:5173` into address and port.
 *
 * Splits on the *last* colon: an IPv6 address is full of them, and splitting on the first
 * turns `[::1]:8080` into a port of `:1]:8080`.
 */
function splitAddress(value: string): { address: string; port: number } | null {
  const colon = value.lastIndexOf(":");
  if (colon <= 0) return null;

  const port = Number(value.slice(colon + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

  // `[::]` and `[::1]` keep their brackets in both tools' output; nobody wants to read
  // those in a table.
  const address = value.slice(0, colon).replace(/^\[|\]$/g, "");
  return { address, port };
}

/**
 * `netstat -ano -p TCP` on Windows.
 *
 * Only `LISTENING` rows matter - the same command reports every established connection,
 * and a browser with thirty tabs open would otherwise fill the panel with rows that are
 * not ports anybody is serving. The state column is localised on non-English Windows, so
 * the match is on the row *shape* (five columns, foreign address `0.0.0.0:0` or `[::]:0`)
 * rather than on the English word where that is possible.
 */
export function parseNetstat(output: string): RawListener[] {
  const listeners: RawListener[] = [];

  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    // Proto, local, foreign, state, pid.
    if (columns.length < 5) continue;

    const [proto, local, foreign, , pidText] = columns as [string, string, string, string, string];
    if (proto.toUpperCase() !== "TCP") continue;

    // A listening socket has no peer. This is the localisation-proof half of the check.
    if (foreign !== "0.0.0.0:0" && foreign !== "[::]:0" && foreign !== "*:*") continue;

    const parsed = splitAddress(local);
    if (parsed === null) continue;

    const pid = Number(pidText);
    listeners.push({
      port: parsed.port,
      address: parsed.address,
      pid: Number.isInteger(pid) && pid > 0 ? pid : null,
      // netstat knows the pid and not the name; `parseTasklist` supplies the other half.
      process: null,
    });
  }

  return listeners;
}

/**
 * `tasklist /FO CSV /NH`, which names the pids `netstat` only numbered.
 *
 * CSV rather than the table format because an image name can contain spaces, and the
 * table format has no way to say where the name ends.
 */
export function parseTasklist(output: string): Map<number, string> {
  const names = new Map<number, string>();

  for (const line of output.split(/\r?\n/)) {
    // "image name","pid","session","session#","mem usage"
    const fields = line.match(/"([^"]*)"/g);
    if (fields === null || fields.length < 2) continue;

    const name = fields[0]?.slice(1, -1) ?? "";
    const pid = Number(fields[1]?.slice(1, -1) ?? "");
    if (name !== "" && Number.isInteger(pid) && pid > 0) names.set(pid, name);
  }

  return names;
}

/**
 * `lsof -nP -iTCP -sTCP:LISTEN` on macOS and Linux.
 *
 * The flags matter: `-n` and `-P` stop lsof resolving names and ports, which is both slow
 * and lossy - a resolved `localhost:http-alt` cannot be turned back into `8080`.
 *
 * The address is taken from the last column that parses as one rather than by index,
 * because the column count varies with the address family and whether the row carries a
 * `(LISTEN)` suffix.
 */
export function parseLsof(output: string): RawListener[] {
  const listeners: RawListener[] = [];

  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 8) continue;

    const command = columns[0] ?? "";
    // The header row starts with COMMAND and would otherwise parse as a process by that
    // name listening on nothing.
    if (command === "COMMAND" || command === "") continue;

    const pid = Number(columns[1]);
    if (!Number.isInteger(pid) || pid <= 0) continue;

    // Walk back from the end: the NAME column is last except when `(LISTEN)` follows it.
    let parsed: { address: string; port: number } | null = null;
    for (let i = columns.length - 1; i >= 2 && parsed === null; i -= 1) {
      const candidate = columns[i] ?? "";
      if (candidate.startsWith("(")) continue;
      parsed = splitAddress(candidate);
    }
    if (parsed === null) continue;

    // lsof writes a wildcard bind as `*`, which is the same thing netstat calls 0.0.0.0.
    const address = parsed.address === "*" ? "0.0.0.0" : parsed.address;
    listeners.push({ port: parsed.port, address, pid, process: command });
  }

  return listeners;
}

/**
 * Collapse the raw rows into one entry per port.
 *
 * A dev server bound to both address families produces two identical-looking rows, and a
 * table that lists `5173` twice reads as a bug. Where rows disagree, the more useful one
 * wins: a loopback bind is reported over a wildcard one because that is the address the
 * user can actually open, and a row with a pid beats a row without.
 */
export function mergeListeners(
  raw: readonly RawListener[],
  names: ReadonlyMap<number, string> = new Map(),
): RawListener[] {
  const byPort = new Map<number, RawListener>();

  for (const listener of raw) {
    const named =
      listener.process !== null
        ? listener
        : { ...listener, process: listener.pid === null ? null : (names.get(listener.pid) ?? null) };

    const existing = byPort.get(listener.port);
    if (existing === undefined) {
      byPort.set(listener.port, named);
      continue;
    }

    const better =
      (existing.pid === null && named.pid !== null) ||
      (isLoopback(named.address) && !isLoopback(existing.address));

    if (better) byPort.set(listener.port, named);
  }

  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

function isLoopback(address: string): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "localhost";
}

/**
 * The address to put in a URL.
 *
 * A wildcard bind is reachable on loopback, and `http://0.0.0.0:5173` is a link that fails
 * on Windows and works by accident elsewhere. `localhost` is what the user would have
 * typed.
 */
export function browsableHost(address: string): string {
  if (address === "0.0.0.0" || address === "::" || address === "*") return "localhost";
  if (address === "::1") return "[::1]";
  return address;
}
