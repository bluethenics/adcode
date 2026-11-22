"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Admin data that opens instantly.
 *
 * Asked for on 2026-10-27: revenue and the other figures loaded from nothing on every visit.
 * Each page now draws the last figures this browser saw at once, fetches fresh ones in the
 * background, and says how old what it shows is ("Updated 12 seconds ago", with Refresh).
 * Only raw API JSON is kept, in this browser's own storage, per admin page.
 */
const PREFIX = "adcode.admin.cache.v1:";
/** A tab coming back after this long refreshes by itself. */
export const STALE_AFTER_MS = 60_000;

export interface CachedEntry<T> { readonly value: T; readonly at: number }

export function readCached<T>(key: string, storage: Pick<Storage, "getItem"> | null = safeStorage()): CachedEntry<T> | null {
  try {
    const raw = storage?.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CachedEntry<T>;
    return typeof entry?.at === "number" && Number.isFinite(entry.at) && "value" in entry ? entry : null;
  } catch { return null; }
}

export function writeCached<T>(key: string, value: T, at: number, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try { storage?.setItem(PREFIX + key, JSON.stringify({ value, at })); } catch { /* Full or blocked storage only costs the instant start. */ }
}

function safeStorage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

/** "just now", "12 seconds ago", "3 minutes ago", "2 hours ago", "yesterday". */
export function ago(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  return hours < 48 ? "yesterday" : `${Math.floor(hours / 24)} days ago`;
}

export interface CachedResource<T> {
  readonly value: T | null;
  readonly asOf: number | null;
  readonly refreshing: boolean;
  /** True while what is shown came from storage and the fresh copy has not arrived yet. */
  readonly fromCache: boolean;
  /** The last load failed (and was not cancelled). What is shown, if anything, is older. */
  readonly failed: boolean;
  readonly refresh: () => Promise<void>;
}

/**
 * `load` returns null when the fetch failed; what is on screen then stays as it was.
 *
 * Each key (a page and its filters) has its own request. Changing the key cancels the one in
 * flight through `signal` - it used to keep running, and its answer for the old filters landed
 * under the new ones while the new request waited behind it - and shows the new key's cached
 * copy, or nothing, never the old key's figures.
 */
export function useCachedResource<T>(key: string, load: (signal: AbortSignal) => Promise<T | null>): CachedResource<T> {
  const [value, setValue] = useState<T | null>(null);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef<{ key: string; controller: AbortController; promise: Promise<void> } | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const asOfRef = useRef<number | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (inFlight.current !== null && inFlight.current.key === key) return inFlight.current.promise;
    inFlight.current?.controller.abort();
    const controller = new AbortController();
    setRefreshing(true);
    const promise = (async () => {
      try {
        const fresh = await loadRef.current(controller.signal);
        if (controller.signal.aborted) return;
        if (fresh === null) { setFailed(true); return; }
        const at = Date.now();
        setValue(fresh); setAsOf(at); setFromCache(false); setFailed(false); asOfRef.current = at;
        writeCached(key, fresh, at);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (inFlight.current?.controller === controller) {
          inFlight.current = null;
          setRefreshing(false);
        }
      }
    })();
    inFlight.current = { key, controller, promise };
    return promise;
  }, [key]);

  useEffect(() => {
    const cached = readCached<T>(key);
    setFailed(false);
    if (cached !== null) { setValue(cached.value); setAsOf(cached.at); setFromCache(true); asOfRef.current = cached.at; }
    else { setValue(null); setAsOf(null); setFromCache(false); asOfRef.current = null; }
    void refresh();
    const onFocus = (): void => {
      if (document.visibilityState === "visible" && (asOfRef.current === null || Date.now() - asOfRef.current > STALE_AFTER_MS)) void refresh();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => { document.removeEventListener("visibilitychange", onFocus); window.removeEventListener("focus", onFocus); };
  }, [key, refresh]);

  // Leaving the page cancels whatever is still loading.
  useEffect(() => () => { inFlight.current?.controller.abort(); }, []);

  return { value, asOf, refreshing, fromCache, failed, refresh };
}
