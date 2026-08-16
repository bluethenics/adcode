/**
 * Real implementations of the ad client's six ports.
 *
 * `packages/ads` has no Electron, Node, or DOM imports at all (brief §2) - it names what
 * it needs as interfaces and receives them. This file is where those interfaces meet the
 * actual machine, and it is the only place in the ad path that touches the network or
 * the disk.
 */
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Clock, FileStore, HttpRequest, HttpResponse, HttpTransport } from "@adcode/ads";

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/**
 * `fetch` with an abort-based timeout.
 *
 * `rewrites` exists for development only: the mock server advertises assets on the
 * allowlisted https host while serving bytes from localhost, so the validator can still
 * enforce §1's https-and-exact-host rule against a real response. It is empty in
 * production, where the advertised host is the host.
 */
export class FetchHttpTransport implements HttpTransport {
  readonly #rewrites: ReadonlyArray<readonly [string, string]>;

  constructor(rewrites: ReadonlyArray<readonly [string, string]> = []) {
    this.#rewrites = rewrites;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    let url = req.url;
    for (const [from, to] of this.#rewrites) {
      if (url.startsWith(from)) {
        url = to + url.slice(from.length);
        break;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);

    try {
      const response = await fetch(url, {
        method: req.method,
        headers: { ...req.headers },
        ...(req.body === undefined ? {} : { body: req.body }),
        signal: controller.signal,
      });

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        status: response.status,
        headers,
        body: new Uint8Array(await response.arrayBuffer()),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Disk-backed store rooted at the app's userData directory.
 *
 * Keys are relative paths supplied by the ad client, so they are confined here the same
 * way renderer paths are confined in `pathSafety` - the ad modules are trusted, but a
 * store that can be talked into writing anywhere is a liability regardless.
 */
export class DiskFileStore implements FileStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  #resolve(key: string): string | null {
    if (key.includes("..") || key.includes("\u0000")) return null;
    return join(this.#root, key);
  }

  async read(key: string): Promise<Uint8Array | null> {
    const path = this.#resolve(key);
    if (path === null) return null;

    try {
      return new Uint8Array(await readFile(path));
    } catch {
      return null;
    }
  }

  async write(key: string, data: Uint8Array): Promise<void> {
    const path = this.#resolve(key);
    if (path === null) return;

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async delete(key: string): Promise<void> {
    const path = this.#resolve(key);
    if (path === null) return;

    try {
      await unlink(path);
    } catch {
      // Already gone.
    }
  }
}

/** Sniff an image type from its magic bytes, for building a `data:` URL. */
export function imageMimeType(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";

  // SVG is deliberately not detected: it is a script-execution surface, and an advertiser
  // supplying one must not be able to smuggle it past an image-shaped check.
  return "application/octet-stream";
}

export function toDataUrl(bytes: Uint8Array): string | null {
  const type = imageMimeType(bytes);
  if (type === "application/octet-stream") return null;

  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
}
