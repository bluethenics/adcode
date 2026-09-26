"use client";

import { useEffect, useState } from "react";

/**
 * Hero developer total.
 *
 * There is no `/v1/stats` poll behind this slot: the count starts from a fixed
 * base, ticks up by a random 1–10 every minute, and persists to localStorage —
 * so a plain refresh resumes where it left off instead of restarting.
 */
export const HARDCODED_DEVELOPER_COUNT = 47298;

/** Minimum digit boxes, padded with leading zeros like the design (047298). */
export const DEVELOPER_COUNT_DIGITS = 6;

export const DEVELOPER_COUNT_STORAGE_KEY = "adcode:developer-count:v1";
export const DEVELOPER_COUNT_TICK_MS = 60_000;
/** Catch-up is capped at 7 days so a long absence cannot teleport the total. */
export const DEVELOPER_COUNT_MAX_CATCHUP_MINUTES = 10_080;

export interface DeveloperCountSnapshot {
  value: number;
  /** Epoch millis of the last applied tick. */
  at: number;
}

/**
 * Split a count into its display characters. Digits render in boxes and group
 * separators render as spacers, so the counter grows a box per digit instead
 * of abbreviating.
 */
export function splitCounterChars(value: number): string[] {
  return value.toLocaleString("en-US").split("");
}

/**
 * Zero-padded digit boxes, e.g. 47298 -> ["0", "4", "7", "2", "9", "8"].
 * Totals that outgrow the width keep every digit rather than truncating.
 */
export function splitPaddedDigits(value: number, width: number = DEVELOPER_COUNT_DIGITS): string[] {
  const normalized = String(Math.max(0, Math.floor(value)));
  return (normalized.length >= width ? normalized : normalized.padStart(width, "0")).split("");
}

/** One tick of growth: a random +1 to +10. */
export function randomDeveloperStep(rand: () => number = Math.random): number {
  return 1 + Math.floor(rand() * 10);
}

/** Advance `value` by one random step per elapsed minute. */
export function advanceDeveloperCount(
  value: number,
  minutes: number,
  rand: () => number = Math.random,
): number {
  const steps = Math.max(0, Math.min(Math.floor(minutes), DEVELOPER_COUNT_MAX_CATCHUP_MINUTES));
  let next = Math.max(0, Math.floor(value));
  for (let i = 0; i < steps; i += 1) next += randomDeveloperStep(rand);
  return next;
}

/** Parse a snapshot from storage; null when missing, corrupt, or mistyped. */
export function parseDeveloperSnapshot(raw: unknown): DeveloperCountSnapshot | null {
  if (typeof raw !== "string") return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const { value, at } = data as Record<string, unknown>;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return null;
  return { value, at };
}

/**
 * Resolve the count to display from a stored snapshot: the stored value caught
 * up for each whole elapsed minute, never below `base`. Returns the snapshot
 * the caller should persist.
 */
export function resolveDeveloperCount(
  stored: DeveloperCountSnapshot | null,
  now: number,
  base: number = HARDCODED_DEVELOPER_COUNT,
  rand: () => number = Math.random,
): DeveloperCountSnapshot {
  const effectiveNow = Number.isFinite(now) && now > 0 ? now : Date.now();
  if (stored === null) return { value: base, at: effectiveNow };
  const floor = Math.max(stored.value, base);
  if (stored.at > effectiveNow) return { value: floor, at: effectiveNow };
  const elapsed = Math.floor((effectiveNow - stored.at) / DEVELOPER_COUNT_TICK_MS);
  if (elapsed <= 0) return { value: floor, at: stored.at };
  return { value: advanceDeveloperCount(floor, elapsed, rand), at: stored.at + elapsed * DEVELOPER_COUNT_TICK_MS };
}

function readStoredSnapshot(): DeveloperCountSnapshot | null {
  try {
    return parseDeveloperSnapshot(window.localStorage.getItem(DEVELOPER_COUNT_STORAGE_KEY));
  } catch {
    // Storage blocked (private mode): the counter still works for the session.
    return null;
  }
}

function persistSnapshot(snapshot: DeveloperCountSnapshot): void {
  try {
    window.localStorage.setItem(
      DEVELOPER_COUNT_STORAGE_KEY,
      JSON.stringify({ value: snapshot.value, at: snapshot.at }),
    );
  } catch {
    // Storage blocked: keep counting in memory only.
  }
}

export function DeveloperCounter({ count: base = HARDCODED_DEVELOPER_COUNT }: { count?: number }) {
  // SSR paints the base; the persisted total hydrates in on mount.
  const [count, setCount] = useState(base);

  useEffect(() => {
    const initial = resolveDeveloperCount(readStoredSnapshot(), Date.now(), base);
    setCount(initial.value);
    persistSnapshot(initial);

    const tick = () => {
      setCount((previous) => {
        const next = previous + randomDeveloperStep();
        persistSnapshot({ value: next, at: Date.now() });
        return next;
      });
    };
    const timer = window.setInterval(tick, DEVELOPER_COUNT_TICK_MS);

    // Interval throttling while hidden means ticks get skipped: catch up the
    // missed minutes when the tab becomes visible again.
    const catchUp = () => {
      if (document.visibilityState !== "visible") return;
      const next = resolveDeveloperCount(readStoredSnapshot(), Date.now(), base);
      setCount(next.value);
      persistSnapshot(next);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== DEVELOPER_COUNT_STORAGE_KEY) return;
      const parsed = parseDeveloperSnapshot(event.newValue);
      if (parsed && parsed.value >= base) setCount(parsed.value);
    };
    document.addEventListener("visibilitychange", catchUp);
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", catchUp);
      window.removeEventListener("storage", onStorage);
    };
  }, [base]);

  const digits = splitPaddedDigits(count);
  return (
    <div className="hero-dev-counter" aria-label={`${count.toLocaleString("en-US")} developers on ADCode`}>
      <div className="hero-dev-counter-brand">
        <span className="hero-dev-counter-icon" aria-hidden="true">{"<$>"}</span>
        <span className="hero-dev-counter-text">
          <strong>Developer</strong>
          <small>on ADCode</small>
        </span>
      </div>
      <span className="hero-dev-counter-divider" aria-hidden="true" />
      <ol className="hero-dev-counter-digits" aria-hidden="true">
        {digits.map((digit, index) => (
          // Fixed length, so index keys are stable.
          // eslint-disable-next-line react/no-array-index-key
          <li key={index} className="hero-dev-counter-digit">{digit}</li>
        ))}
      </ol>
    </div>
  );
}
