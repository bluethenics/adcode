import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchHttpTransport } from "../src/platform/http.ts";

/**
 * A closed terminal must not keep the process alive while a sponsor server thinks. The
 * transport aborts what is in flight and refuses anything new after shutdown; the receipt
 * queue stays on disk for the next launch.
 */

const REQUEST = {
  method: "GET" as const,
  url: "https://sponsor.example/v1/balance",
  headers: {},
  timeoutMs: 10_000,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FetchHttpTransport - shutdown is not a network wait", () => {
  it("aborts a request that is already in flight", async () => {
    const seen: { signal: AbortSignal | null } = { signal: null };
    vi.stubGlobal("fetch", (_url: string, init: { signal: AbortSignal }) => {
      seen.signal = init.signal;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    const transport = new FetchHttpTransport();
    const pending = transport.request(REQUEST);
    await Promise.resolve();
    expect(seen.signal).not.toBeNull();

    transport.abort();

    await expect(pending).rejects.toThrow("aborted");
    expect(seen.signal?.aborted).toBe(true);
  });

  it("refuses a new request once stopped", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const transport = new FetchHttpTransport();
    transport.abort();

    await expect(transport.request(REQUEST)).rejects.toThrow("aborted");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
