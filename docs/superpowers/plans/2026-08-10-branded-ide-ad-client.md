# Branded IDE + Ad Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a signed, installable, rebranded VS Code that displays sponsored slide-in notifications, honors strict frequency and suppression rules, and mirrors a server-authoritative earnings balance.

**Architecture:** Code-OSS is a pinned git submodule that is never edited directly — every source change is a versioned diff in `patches/`. All ad logic lives in a built-in extension at `extensions/adcode-ads/`, written as pure, dependency-light TypeScript modules so the interruption behavior can be exhaustively unit-tested without launching an editor. Tasks 1–12 build and test the extension against a local mock server in stock VS Code; tasks 13–16 introduce the fork, the patches, and distribution.

**Tech Stack:** TypeScript 5.x, Node 24 / npm 11, vitest (unit), fast-check (property tests), `@vscode/test-electron` (integration), `node:http` (mock server), Firebase Auth REST API, Code-OSS build toolchain (gulp).

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from `docs/superpowers/specs/2026-08-10-branded-ide-ad-client-design.md`.

- **`vscode/` is never edited directly.** Every source change is a versioned diff in `patches/`.
- **Money is int64 micros of USD. Never floats.** Display formatting uses integer arithmetic.
- **The client never computes money.** It reports receipts; the server owns the balance.
- **Receipts are authenticated, not signed.** Identity comes from the Firebase ID token on the request. No signing key ships in the binary.
- **Frequency caps are client-side and authoritative.** Remote config may only *tighten* them, never loosen.
- **`tagger.ts` output must be a subset of a fixed tag vocabulary.** It may never emit file contents, file paths, directory names, workspace names, git remotes, branch names, dependency lists, or environment variables. Filename-level detection only — never read manifest contents.
- **Only `transform` and `opacity` may animate.** Reduce-motion replaces the slide with a 100ms opacity fade.
- **Creative assets: `https` only, allowlisted host, fetched and cached by us.** Never hot-linked from advertiser servers.
- **Ad clicks use `env.openExternal`, `https` only.** Never a webview, never in-editor navigation.
- **Extension activates on `onStartupFinished`, never `*`.**
- **An impression requires:** the toast painted, the window focused for the duration, and ≥4 seconds on screen.
- **Frequency defaults:** 30 minute minimum interval, 8/day cap, 8s auto-dismiss, 60s settle period after launch.
- **The rebrand patch strips Microsoft telemetry endpoints.**

## File Structure

| Path | Responsibility |
|---|---|
| `extensions/adcode-ads/src/types.ts` | Shared types only. No logic. |
| `extensions/adcode-ads/src/scheduler.ts` | **Pure.** Decides whether to show an ad now; tightens caps from remote config. |
| `extensions/adcode-ads/src/validation.ts` | **Pure.** Validates untrusted creatives from the network. |
| `extensions/adcode-ads/src/tagger.ts` | **Pure.** Maps language IDs + workspace filenames to a fixed tag vocabulary. |
| `extensions/adcode-ads/src/receiptQueue.ts` | Disk-backed, capped, deduped receipt queue. |
| `extensions/adcode-ads/src/auth.ts` | Firebase anonymous identity and ID-token refresh. |
| `extensions/adcode-ads/src/client.ts` | HTTPS calls to the serving contract. Timeout, backoff, validation. |
| `extensions/adcode-ads/src/ledger.ts` | Mirrors server balance; formats micros for display. |
| `extensions/adcode-ads/src/renderer.ts` | Creative → notification, via a swappable `NotificationSink`. |
| `extensions/adcode-ads/src/sponsorsView.ts` | Sidebar webview: history, balance, frequency setting. |
| `extensions/adcode-ads/src/extension.ts` | Activation, 60s tick, VS Code adapters, wiring. Thin. |
| `mock-server/src/server.ts` | Local implementation of all four endpoints + asset host. |
| `patches/0001-product-rebrand.patch` | `product.json`, icons, Open VSX, telemetry strip. |
| `patches/0002-sponsored-notification.patch` | Sponsored notification kind, slide-in motion, zen guard. |
| `scripts/apply-patches.mjs` | Applies `patches/*.patch` onto `vscode/`. |
| `scripts/verify-patches.mjs` | Dry-run apply; non-zero exit when a patch rots. |

The four `Pure` modules import nothing from `vscode`. That is what makes them testable in milliseconds and is the reason `extension.ts` stays thin — it is an adapter layer, not a logic layer.

---

### Task 1: Scaffolding and shared types

**Files:**
- Create: `extensions/adcode-ads/package.json`
- Create: `extensions/adcode-ads/tsconfig.json`
- Create: `extensions/adcode-ads/vitest.config.ts`
- Create: `extensions/adcode-ads/src/types.ts`
- Create: `.github/workflows/ci.yml`
- Test: `extensions/adcode-ads/test/types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: every type below. All later tasks import from `./types`.

- [ ] **Step 1: Create the extension manifest**

`extensions/adcode-ads/package.json`:

```json
{
  "name": "adcode-ads",
  "displayName": "ADCode Sponsors",
  "version": "0.1.0",
  "private": true,
  "engines": { "vscode": "^1.90.0", "node": ">=24" },
  "main": "./out/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "configuration": {
      "title": "ADCode Sponsors",
      "properties": {
        "adcode.ads.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Show sponsored notifications and accrue earnings."
        },
        "adcode.ads.frequency": {
          "type": "string",
          "enum": ["off", "light", "standard", "max"],
          "default": "standard",
          "enumDescriptions": [
            "No ads. No earnings.",
            "About 4 per day, at most one per hour.",
            "About 8 per day, at most one per 30 minutes.",
            "About 20 per day, at most one per 15 minutes."
          ],
          "description": "How often sponsored notifications may appear."
        },
        "adcode.serverUrl": {
          "type": "string",
          "default": "https://api.adcode.dev",
          "description": "Ad serving endpoint."
        }
      }
    },
    "views": {
      "adcode": [
        { "type": "webview", "id": "adcode.sponsors", "name": "Sponsors" }
      ]
    },
    "viewsContainers": {
      "activitybar": [
        { "id": "adcode", "title": "Sponsors", "icon": "media/sponsors.svg" }
      ]
    }
  },
  "scripts": {
    "build": "tsc -p .",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/vscode": "^1.90.0",
    "fast-check": "^3.23.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create tsconfig and vitest config**

`extensions/adcode-ads/tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "out",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"]
}
```

`extensions/adcode-ads/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
```

`noUncheckedIndexedAccess` is deliberate: this codebase indexes into arrays of receipts and creatives constantly, and it turns a class of runtime `undefined` bugs into compile errors.

- [ ] **Step 3: Write shared types**

`extensions/adcode-ads/src/types.ts`:

```typescript
/** All monetary values in this codebase are integer micros of USD. Never floats. */
export type Micros = number;

export type ThemeKind = 'light' | 'dark';

export type FrequencyPref = 'off' | 'light' | 'standard' | 'max';

export interface FrequencyCaps {
  minIntervalMs: number;
  dailyCap: number;
}

export interface Creative {
  creativeId: string;
  campaignId: string;
  headline: string;
  body: string;
  logoLight: string;
  logoDark: string;
  clickUrl: string;
  expiresAt: number;
}

export type ReceiptKind = 'impression' | 'click';

export interface Receipt {
  receiptId: string;
  creativeId: string;
  kind: ReceiptKind;
  shownMs: number;
  focused: boolean;
  clientTs: number;
}

export interface Balance {
  availableMicros: Micros;
  lifetimeMicros: Micros;
}

export interface RemoteConfig {
  enabled: boolean;
  minIntervalMs: number;
  dailyCap: number;
}

export interface SchedulerState {
  nowMs: number;
  appStartedMs: number;
  /** Timestamps of shows within the trailing 24h. Order irrelevant. */
  shownTimestampsMs: number[];
  frequencyPref: FrequencyPref;
  caps: FrequencyCaps;
  windowFocused: boolean;
  debugSessionActive: boolean;
  doNotDisturb: boolean;
  adsEnabled: boolean;
  remoteKillSwitch: boolean;
  cacheHasCreative: boolean;
}

export type SuppressReason =
  | 'ads-disabled'
  | 'kill-switch'
  | 'frequency-off'
  | 'settling'
  | 'window-unfocused'
  | 'debug-active'
  | 'do-not-disturb'
  | 'daily-cap'
  | 'min-interval'
  | 'no-creative';

export type SchedulerDecision =
  | { show: true }
  | { show: false; reason: SuppressReason };
```

- [ ] **Step 4: Write a test that proves the toolchain runs**

`extensions/adcode-ads/test/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { Creative, SchedulerDecision } from '../src/types';

describe('toolchain', () => {
  it('compiles and runs typed test code', () => {
    const decision: SchedulerDecision = { show: false, reason: 'daily-cap' };
    expect(decision.show).toBe(false);
  });

  it('models a creative with both theme assets', () => {
    const c: Creative = {
      creativeId: 'cr_1',
      campaignId: 'cm_1',
      headline: 'Sentry',
      body: 'Catch errors before your users do.',
      logoLight: 'https://assets.adcode.dev/cr_1/light.png',
      logoDark: 'https://assets.adcode.dev/cr_1/dark.png',
      clickUrl: 'https://sentry.io',
      expiresAt: 1_800_000_000_000,
    };
    expect(c.logoLight).not.toBe(c.logoDark);
  });
});
```

- [ ] **Step 5: Install and run**

Run:
```bash
cd extensions/adcode-ads && npm install && npm test && npx tsc -p . --noEmit
```
Expected: 2 tests pass, `tsc` exits 0.

- [ ] **Step 6: Add CI**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  extension:
    runs-on: ubuntu-latest
    defaults:
      run: { working-directory: extensions/adcode-ads }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24' }
      - run: npm ci
      - run: npx tsc -p . --noEmit
      - run: npm test
```

- [ ] **Step 7: Commit**

```bash
git add extensions/adcode-ads .github/workflows/ci.yml
git commit -m "chore: scaffold ad client extension with shared types and CI"
```

---

### Task 2: The scheduler

This is the single most user-visible module in the product. It gets the strongest guarantee in the codebase.

**Files:**
- Create: `extensions/adcode-ads/src/scheduler.ts`
- Test: `extensions/adcode-ads/test/scheduler.test.ts`

**Interfaces:**
- Consumes: `SchedulerState`, `SchedulerDecision`, `FrequencyCaps`, `FrequencyPref`, `RemoteConfig` from `./types`.
- Produces:
  - `SETTLE_MS: number`
  - `DAY_MS: number`
  - `FREQUENCY_CAPS: Record<Exclude<FrequencyPref, 'off'>, FrequencyCaps>`
  - `decide(state: SchedulerState): SchedulerDecision`
  - `tightenCaps(local: FrequencyCaps, remote: RemoteConfig): FrequencyCaps`
  - `trimTimestamps(timestamps: number[], nowMs: number): number[]`

- [ ] **Step 1: Write the failing tests**

`extensions/adcode-ads/test/scheduler.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  decide, tightenCaps, trimTimestamps, FREQUENCY_CAPS, SETTLE_MS, DAY_MS,
} from '../src/scheduler';
import type { SchedulerState } from '../src/types';

const base = (over: Partial<SchedulerState> = {}): SchedulerState => ({
  nowMs: 10_000_000,
  appStartedMs: 10_000_000 - SETTLE_MS - 1,
  shownTimestampsMs: [],
  frequencyPref: 'standard',
  caps: FREQUENCY_CAPS.standard,
  windowFocused: true,
  debugSessionActive: false,
  doNotDisturb: false,
  adsEnabled: true,
  remoteKillSwitch: false,
  cacheHasCreative: true,
  ...over,
});

describe('decide', () => {
  it('shows when every condition is satisfied', () => {
    expect(decide(base())).toEqual({ show: true });
  });

  it.each([
    ['ads-disabled',     { adsEnabled: false }],
    ['kill-switch',      { remoteKillSwitch: true }],
    ['frequency-off',    { frequencyPref: 'off' as const }],
    ['window-unfocused', { windowFocused: false }],
    ['debug-active',     { debugSessionActive: true }],
    ['do-not-disturb',   { doNotDisturb: true }],
    ['no-creative',      { cacheHasCreative: false }],
  ])('suppresses with reason %s', (reason, over) => {
    expect(decide(base(over))).toEqual({ show: false, reason });
  });

  it('suppresses during the launch settle period', () => {
    const now = 10_000_000;
    const state = base({ nowMs: now, appStartedMs: now - SETTLE_MS + 1 });
    expect(decide(state)).toEqual({ show: false, reason: 'settling' });
  });

  it('shows exactly at the settle boundary', () => {
    const now = 10_000_000;
    const state = base({ nowMs: now, appStartedMs: now - SETTLE_MS });
    expect(decide(state)).toEqual({ show: true });
  });

  it('suppresses inside the minimum interval', () => {
    const now = 10_000_000;
    const state = base({ nowMs: now, shownTimestampsMs: [now - 29 * 60_000] });
    expect(decide(state)).toEqual({ show: false, reason: 'min-interval' });
  });

  it('shows exactly at the minimum interval boundary', () => {
    const now = 10_000_000;
    const state = base({ nowMs: now, shownTimestampsMs: [now - 30 * 60_000] });
    expect(decide(state)).toEqual({ show: true });
  });

  it('suppresses at the daily cap even when the interval has elapsed', () => {
    const now = 10_000_000;
    const shown = Array.from({ length: 8 }, (_, i) => now - (i + 1) * 60 * 60_000);
    expect(decide(base({ nowMs: now, shownTimestampsMs: shown })))
      .toEqual({ show: false, reason: 'daily-cap' });
  });

  it('ignores shows older than 24 hours when counting the cap', () => {
    const now = 10_000_000_000;
    const shown = Array.from({ length: 8 }, (_, i) => now - DAY_MS - i * 1000);
    expect(decide(base({ nowMs: now, shownTimestampsMs: shown }))).toEqual({ show: true });
  });

  it('reports the disabled reason before any other', () => {
    const state = base({ adsEnabled: false, windowFocused: false, debugSessionActive: true });
    expect(decide(state)).toEqual({ show: false, reason: 'ads-disabled' });
  });
});

describe('tightenCaps', () => {
  it('accepts a stricter remote interval', () => {
    const out = tightenCaps({ minIntervalMs: 1000, dailyCap: 10 },
      { enabled: true, minIntervalMs: 5000, dailyCap: 10 });
    expect(out.minIntervalMs).toBe(5000);
  });

  it('refuses a looser remote interval', () => {
    const out = tightenCaps({ minIntervalMs: 5000, dailyCap: 10 },
      { enabled: true, minIntervalMs: 1000, dailyCap: 10 });
    expect(out.minIntervalMs).toBe(5000);
  });

  it('refuses a larger remote daily cap', () => {
    const out = tightenCaps({ minIntervalMs: 1000, dailyCap: 8 },
      { enabled: true, minIntervalMs: 1000, dailyCap: 999 });
    expect(out.dailyCap).toBe(8);
  });

  it('accepts a smaller remote daily cap', () => {
    const out = tightenCaps({ minIntervalMs: 1000, dailyCap: 8 },
      { enabled: true, minIntervalMs: 1000, dailyCap: 2 });
    expect(out.dailyCap).toBe(2);
  });

  it('never produces a negative or zero cap from hostile input', () => {
    const out = tightenCaps({ minIntervalMs: 1000, dailyCap: 8 },
      { enabled: true, minIntervalMs: -1, dailyCap: -5 });
    expect(out.dailyCap).toBe(0);
    expect(out.minIntervalMs).toBe(1000);
  });
});

describe('property: caps are inviolable', () => {
  it('no event sequence can exceed the daily cap or violate the interval', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('light' as const, 'standard' as const, 'max' as const),
        fc.array(fc.integer({ min: 1, max: 90 * 60_000 }), { minLength: 1, maxLength: 400 }),
        (pref, gaps) => {
          const caps = FREQUENCY_CAPS[pref];
          let now = 1_000_000_000;
          const appStartedMs = now - SETTLE_MS;
          let shown: number[] = [];

          for (const gap of gaps) {
            now += gap;
            const state: SchedulerState = {
              nowMs: now, appStartedMs, shownTimestampsMs: shown,
              frequencyPref: pref, caps,
              windowFocused: true, debugSessionActive: false, doNotDisturb: false,
              adsEnabled: true, remoteKillSwitch: false, cacheHasCreative: true,
            };
            if (decide(state).show) {
              shown = trimTimestamps([...shown, now], now);
            }
          }

          const sorted = [...shown].sort((a, b) => a - b);
          for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(caps.minIntervalMs);
          }
          expect(sorted.length).toBeLessThanOrEqual(caps.dailyCap);
        },
      ),
      { numRuns: 500 },
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd extensions/adcode-ads && npx vitest run test/scheduler.test.ts`
Expected: FAIL — `Failed to resolve import "../src/scheduler"`.

- [ ] **Step 3: Implement the scheduler**

`extensions/adcode-ads/src/scheduler.ts`:

```typescript
import type {
  FrequencyCaps, FrequencyPref, RemoteConfig, SchedulerDecision, SchedulerState,
} from './types';

/** Grace period after launch during which no ad may appear. */
export const SETTLE_MS = 60_000;

export const DAY_MS = 24 * 60 * 60_000;

export const FREQUENCY_CAPS: Record<Exclude<FrequencyPref, 'off'>, FrequencyCaps> = {
  light:    { minIntervalMs: 60 * 60_000, dailyCap: 4 },
  standard: { minIntervalMs: 30 * 60_000, dailyCap: 8 },
  max:      { minIntervalMs: 15 * 60_000, dailyCap: 20 },
};

/** Drops timestamps outside the trailing 24h window. */
export function trimTimestamps(timestamps: number[], nowMs: number): number[] {
  return timestamps.filter((t) => nowMs - t < DAY_MS);
}

/**
 * Remote config may only make the client stricter. A compromised or
 * misconfigured server can never make the IDE more annoying than its
 * shipped defaults.
 */
export function tightenCaps(local: FrequencyCaps, remote: RemoteConfig): FrequencyCaps {
  const remoteInterval = Number.isFinite(remote.minIntervalMs) ? remote.minIntervalMs : 0;
  const remoteCap = Number.isFinite(remote.dailyCap) ? remote.dailyCap : local.dailyCap;
  return {
    minIntervalMs: Math.max(local.minIntervalMs, remoteInterval),
    dailyCap: Math.max(0, Math.min(local.dailyCap, remoteCap)),
  };
}

/**
 * Pure. Order is deliberate: user intent first, then context, then rate limits,
 * then inventory. The reason returned is the first that applies, which keeps
 * suppression telemetry meaningful.
 */
export function decide(state: SchedulerState): SchedulerDecision {
  if (!state.adsEnabled) return { show: false, reason: 'ads-disabled' };
  if (state.remoteKillSwitch) return { show: false, reason: 'kill-switch' };
  if (state.frequencyPref === 'off') return { show: false, reason: 'frequency-off' };
  if (state.nowMs - state.appStartedMs < SETTLE_MS) return { show: false, reason: 'settling' };
  if (!state.windowFocused) return { show: false, reason: 'window-unfocused' };
  if (state.debugSessionActive) return { show: false, reason: 'debug-active' };
  if (state.doNotDisturb) return { show: false, reason: 'do-not-disturb' };

  const recent = trimTimestamps(state.shownTimestampsMs, state.nowMs);
  if (recent.length >= state.caps.dailyCap) return { show: false, reason: 'daily-cap' };

  const lastShown = recent.length > 0 ? Math.max(...recent) : null;
  if (lastShown !== null && state.nowMs - lastShown < state.caps.minIntervalMs) {
    return { show: false, reason: 'min-interval' };
  }

  if (!state.cacheHasCreative) return { show: false, reason: 'no-creative' };
  return { show: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd extensions/adcode-ads && npx vitest run test/scheduler.test.ts`
Expected: PASS, including the 500-run property test.

- [ ] **Step 5: Commit**

```bash
git add extensions/adcode-ads/src/scheduler.ts extensions/adcode-ads/test/scheduler.test.ts
git commit -m "feat: add pure ad scheduler with property-tested frequency caps"
```

---

### Task 3: Creative validation

Everything here parses hostile input from the network. It is pure, and it is the only place a creative may become trusted.

**Files:**
- Create: `extensions/adcode-ads/src/validation.ts`
- Test: `extensions/adcode-ads/test/validation.test.ts`

**Interfaces:**
- Consumes: `Creative` from `./types`.
- Produces:
  - `MAX_HEADLINE: number`, `MAX_BODY: number`
  - `type ValidationResult = { ok: true; creative: Creative } | { ok: false; error: string }`
  - `validateCreative(input: unknown, opts: { assetHost: string }): ValidationResult`
  - `validateCreatives(input: unknown, opts: { assetHost: string }): Creative[]` — drops invalid entries rather than throwing.

- [ ] **Step 1: Write the failing tests**

`extensions/adcode-ads/test/validation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateCreative, validateCreatives, MAX_HEADLINE, MAX_BODY } from '../src/validation';

const OPTS = { assetHost: 'assets.adcode.dev' };

const good = () => ({
  creativeId: 'cr_1',
  campaignId: 'cm_1',
  headline: 'Sentry',
  body: 'Catch errors before your users do.',
  logoLight: 'https://assets.adcode.dev/cr_1/light.png',
  logoDark: 'https://assets.adcode.dev/cr_1/dark.png',
  clickUrl: 'https://sentry.io/welcome',
  expiresAt: 1_800_000_000_000,
});

describe('validateCreative', () => {
  it('accepts a well-formed creative', () => {
    const r = validateCreative(good(), OPTS);
    expect(r.ok).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['an array', []],
  ])('rejects %s', (_label, input) => {
    expect(validateCreative(input, OPTS).ok).toBe(false);
  });

  it('rejects unknown fields', () => {
    const r = validateCreative({ ...good(), trackingPixel: 'https://evil.example' }, OPTS);
    expect(r).toEqual({ ok: false, error: 'unknown field: trackingPixel' });
  });

  it('rejects a __proto__ key', () => {
    const input = JSON.parse('{"__proto__":{"polluted":true},"creativeId":"cr_1"}');
    expect(validateCreative(input, OPTS).ok).toBe(false);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('rejects a non-https click url', () => {
    expect(validateCreative({ ...good(), clickUrl: 'http://sentry.io' }, OPTS).ok).toBe(false);
  });

  it('rejects a javascript: click url', () => {
    expect(validateCreative(
      { ...good(), clickUrl: 'javascript:alert(1)' }, OPTS).ok).toBe(false);
  });

  it('rejects assets from a host outside the allowlist', () => {
    expect(validateCreative(
      { ...good(), logoLight: 'https://advertiser.example/pixel.png' }, OPTS).ok).toBe(false);
  });

  it('rejects a host that merely suffixes the allowed host', () => {
    expect(validateCreative(
      { ...good(), logoDark: 'https://evilassets.adcode.dev.attacker.example/x.png' },
      OPTS).ok).toBe(false);
  });

  it('rejects a missing dark asset', () => {
    const { logoDark, ...rest } = good();
    expect(validateCreative(rest, OPTS).ok).toBe(false);
  });

  it('rejects an oversized headline', () => {
    const r = validateCreative({ ...good(), headline: 'x'.repeat(MAX_HEADLINE + 1) }, OPTS);
    expect(r).toEqual({ ok: false, error: 'headline too long' });
  });

  it('rejects an oversized body', () => {
    const r = validateCreative({ ...good(), body: 'x'.repeat(MAX_BODY + 1) }, OPTS);
    expect(r).toEqual({ ok: false, error: 'body too long' });
  });

  it('rejects an empty headline', () => {
    expect(validateCreative({ ...good(), headline: '   ' }, OPTS).ok).toBe(false);
  });

  it('strips markup rather than rendering it', () => {
    const r = validateCreative({ ...good(), headline: '<script>alert(1)</script>Buy' }, OPTS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.creative.headline).toBe('alert(1)Buy');
  });

  it('rejects a non-numeric expiry', () => {
    expect(validateCreative({ ...good(), expiresAt: 'soon' }, OPTS).ok).toBe(false);
  });
});

describe('validateCreatives', () => {
  it('keeps valid entries and drops invalid ones', () => {
    const out = validateCreatives(
      [good(), { ...good(), creativeId: 'cr_2', clickUrl: 'http://x.example' }, null],
      OPTS);
    expect(out.map((c) => c.creativeId)).toEqual(['cr_1']);
  });

  it('returns an empty array for a non-array payload', () => {
    expect(validateCreatives({ creatives: [] }, OPTS)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd extensions/adcode-ads && npx vitest run test/validation.test.ts`
Expected: FAIL — `Failed to resolve import "../src/validation"`.

- [ ] **Step 3: Implement validation**

`extensions/adcode-ads/src/validation.ts`:

```typescript
import type { Creative } from './types';

export const MAX_HEADLINE = 60;
export const MAX_BODY = 140;

const FIELDS = [
  'creativeId', 'campaignId', 'headline', 'body',
  'logoLight', 'logoDark', 'clickUrl', 'expiresAt',
] as const;

export type ValidationResult =
  | { ok: true; creative: Creative }
  | { ok: false; error: string };

const fail = (error: string): ValidationResult => ({ ok: false, error });

/** Removes angle-bracket markup. The notification renders text, never HTML. */
function sanitizeText(value: string): string {
  return value.replace(/<[^>]*>/g, '').trim();
}

function httpsUrl(value: unknown, requiredHost?: string): boolean {
  if (typeof value !== 'string') return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  // Exact host match. A suffix check would accept assets.adcode.dev.attacker.example.
  if (requiredHost !== undefined && url.hostname !== requiredHost) return false;
  return true;
}

export function validateCreative(
  input: unknown,
  opts: { assetHost: string },
): ValidationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail('not an object');
  }

  // Own keys only — a prototype-polluting payload has no own FIELDS keys and
  // fails below rather than inheriting values.
  const keys = Object.keys(input);
  for (const key of keys) {
    if (!(FIELDS as readonly string[]).includes(key)) {
      return fail(`unknown field: ${key}`);
    }
  }

  const raw = input as Record<string, unknown>;
  for (const field of FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, field)) {
      return fail(`missing field: ${field}`);
    }
  }

  for (const field of ['creativeId', 'campaignId'] as const) {
    const v = raw[field];
    if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(v)) {
      return fail(`invalid ${field}`);
    }
  }

  if (typeof raw['headline'] !== 'string') return fail('invalid headline');
  if (raw['headline'].length > MAX_HEADLINE) return fail('headline too long');
  const headline = sanitizeText(raw['headline']);
  if (headline.length === 0) return fail('empty headline');

  if (typeof raw['body'] !== 'string') return fail('invalid body');
  if (raw['body'].length > MAX_BODY) return fail('body too long');
  const body = sanitizeText(raw['body']);
  if (body.length === 0) return fail('empty body');

  if (!httpsUrl(raw['logoLight'], opts.assetHost)) return fail('invalid logoLight');
  if (!httpsUrl(raw['logoDark'], opts.assetHost)) return fail('invalid logoDark');
  if (!httpsUrl(raw['clickUrl'])) return fail('invalid clickUrl');

  if (typeof raw['expiresAt'] !== 'number' || !Number.isFinite(raw['expiresAt'])) {
    return fail('invalid expiresAt');
  }

  return {
    ok: true,
    creative: {
      creativeId: raw['creativeId'] as string,
      campaignId: raw['campaignId'] as string,
      headline,
      body,
      logoLight: raw['logoLight'] as string,
      logoDark: raw['logoDark'] as string,
      clickUrl: raw['clickUrl'] as string,
      expiresAt: raw['expiresAt'],
    },
  };
}

/** Drops invalid entries. One bad creative must not discard a whole batch. */
export function validateCreatives(input: unknown, opts: { assetHost: string }): Creative[] {
  if (!Array.isArray(input)) return [];
  const out: Creative[] = [];
  for (const entry of input) {
    const result = validateCreative(entry, opts);
    if (result.ok) out.push(result.creative);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd extensions/adcode-ads && npx vitest run test/validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/adcode-ads/src/validation.ts extensions/adcode-ads/test/validation.test.ts
git commit -m "feat: add creative validation with strict host and markup rules"
```

---

### Task 4: The tagger

The privacy position of the whole product rests on this module. It is written so that leaking user data is *structurally impossible* rather than merely untested: the output is intersected against a fixed vocabulary, so no input can produce a tag that was not compiled into the binary.

**Files:**
- Create: `extensions/adcode-ads/src/tagger.ts`
- Test: `extensions/adcode-ads/test/tagger.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `LANGUAGE_TAGS: Record<string, string>`
  - `FILENAME_TAGS: Record<string, string>`
  - `INTEREST_TAGS: ReadonlySet<string>`
  - `TAG_VOCABULARY: ReadonlySet<string>`
  - `MAX_TAGS: number`
  - `interface TaggerInput { openLanguageIds: readonly string[]; workspaceFileNames: readonly string[]; userInterests: readonly string[] }`
  - `deriveTags(input: TaggerInput): string[]`

- [ ] **Step 1: Write the failing tests**

`extensions/adcode-ads/test/tagger.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deriveTags, TAG_VOCABULARY, MAX_TAGS } from '../src/tagger';

const empty = { openLanguageIds: [], workspaceFileNames: [], userInterests: [] };

describe('deriveTags', () => {
  it('maps known language ids to tags', () => {
    const tags = deriveTags({ ...empty, openLanguageIds: ['typescript', 'go'] });
    expect(tags).toContain('typescript');
    expect(tags).toContain('go');
  });

  it('maps both react language ids to a single react tag', () => {
    const tags = deriveTags({
      ...empty,
      openLanguageIds: ['typescriptreact', 'javascriptreact'],
    });
    expect(tags.filter((t) => t === 'react')).toHaveLength(1);
  });

  it('maps known filenames to tags', () => {
    const tags = deriveTags({ ...empty, workspaceFileNames: ['go.mod', 'Dockerfile'] });
    expect(tags).toEqual(expect.arrayContaining(['go', 'docker']));
  });

  it('matches filenames case-insensitively', () => {
    expect(deriveTags({ ...empty, workspaceFileNames: ['DOCKERFILE'] })).toContain('docker');
  });

  it('accepts declared user interests that are in the vocabulary', () => {
    expect(deriveTags({ ...empty, userInterests: ['ai-ml'] })).toContain('ai-ml');
  });

  it('drops user interests outside the vocabulary', () => {
    expect(deriveTags({ ...empty, userInterests: ['my-secret-project'] })).toEqual([]);
  });

  it('reduces a path to its basename before matching', () => {
    const tags = deriveTags({
      ...empty,
      workspaceFileNames: ['C:\\Users\\dana\\acme-secret-merger\\package.json'],
    });
    expect(tags).toEqual(['node']);
  });

  it('never emits a directory or workspace name', () => {
    const tags = deriveTags({
      ...empty,
      workspaceFileNames: ['/home/dana/project-nda-acme/go.mod'],
    });
    expect(tags.join(' ')).not.toContain('acme');
    expect(tags.join(' ')).not.toContain('nda');
  });

  it('deduplicates', () => {
    const tags = deriveTags({
      openLanguageIds: ['go', 'go'],
      workspaceFileNames: ['go.mod'],
      userInterests: [],
    });
    expect(tags).toEqual(['go']);
  });

  it('returns a sorted list so requests are stable', () => {
    const tags = deriveTags({ ...empty, openLanguageIds: ['rust', 'go', 'python'] });
    expect(tags).toEqual([...tags].sort());
  });

  it('caps the number of tags', () => {
    const everyLanguageId = [
      'typescript', 'javascript', 'python', 'go', 'rust', 'java', 'csharp',
      'cpp', 'c', 'php', 'ruby', 'sql', 'yaml', 'dockerfile', 'terraform',
      'shellscript', 'markdown',
    ];
    expect(deriveTags({ ...empty, openLanguageIds: everyLanguageId }).length)
      .toBeLessThanOrEqual(MAX_TAGS);
  });
});

describe('property: output can never escape the vocabulary', () => {
  it('emits only vocabulary tags for arbitrary hostile input', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { maxLength: 40 }),
        fc.array(fc.string(), { maxLength: 40 }),
        fc.array(fc.string(), { maxLength: 40 }),
        (openLanguageIds, workspaceFileNames, userInterests) => {
          const tags = deriveTags({ openLanguageIds, workspaceFileNames, userInterests });
          for (const tag of tags) {
            expect(TAG_VOCABULARY.has(tag)).toBe(true);
          }
          expect(tags.length).toBeLessThanOrEqual(MAX_TAGS);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd extensions/adcode-ads && npx vitest run test/tagger.test.ts`
Expected: FAIL — `Failed to resolve import "../src/tagger"`.

- [ ] **Step 3: Implement the tagger**

`extensions/adcode-ads/src/tagger.ts`:

```typescript
/**
 * Derives coarse interest tags. Filename-level detection only — this module
 * never reads file contents, and its output is intersected against a fixed
 * vocabulary so no input can produce an unplanned tag.
 */

export const LANGUAGE_TAGS: Record<string, string> = {
  typescript: 'typescript',
  typescriptreact: 'react',
  javascript: 'javascript',
  javascriptreact: 'react',
  python: 'python',
  go: 'go',
  rust: 'rust',
  java: 'java',
  csharp: 'csharp',
  cpp: 'cpp',
  c: 'c',
  php: 'php',
  ruby: 'ruby',
  sql: 'sql',
  yaml: 'devops',
  dockerfile: 'docker',
  terraform: 'terraform',
  shellscript: 'shell',
  markdown: 'docs',
};

export const FILENAME_TAGS: Record<string, string> = {
  'package.json': 'node',
  'dockerfile': 'docker',
  'docker-compose.yml': 'docker',
  'docker-compose.yaml': 'docker',
  'go.mod': 'go',
  'cargo.toml': 'rust',
  'requirements.txt': 'python',
  'pyproject.toml': 'python',
  'pom.xml': 'java',
  'build.gradle': 'java',
  'gemfile': 'ruby',
  'composer.json': 'php',
  'next.config.js': 'nextjs',
  'nuxt.config.ts': 'nuxt',
  'angular.json': 'angular',
  'svelte.config.js': 'svelte',
  'main.tf': 'terraform',
  'kustomization.yaml': 'kubernetes',
  'chart.yaml': 'kubernetes',
};

export const INTEREST_TAGS: ReadonlySet<string> = new Set([
  'devops', 'ai-ml', 'frontend', 'backend', 'security', 'data', 'mobile', 'gamedev',
]);

export const TAG_VOCABULARY: ReadonlySet<string> = new Set([
  ...Object.values(LANGUAGE_TAGS),
  ...Object.values(FILENAME_TAGS),
  ...INTEREST_TAGS,
]);

export const MAX_TAGS = 12;

export interface TaggerInput {
  openLanguageIds: readonly string[];
  workspaceFileNames: readonly string[];
  userInterests: readonly string[];
}

/** Strips any directory component. Guards against a path arriving where a name was expected. */
function basename(value: string): string {
  const parts = value.split(/[\\/]/);
  return (parts[parts.length - 1] ?? '').toLowerCase();
}

export function deriveTags(input: TaggerInput): string[] {
  const tags = new Set<string>();

  for (const id of input.openLanguageIds) {
    const tag = LANGUAGE_TAGS[id.toLowerCase()];
    if (tag !== undefined) tags.add(tag);
  }

  for (const name of input.workspaceFileNames) {
    const tag = FILENAME_TAGS[basename(name)];
    if (tag !== undefined) tags.add(tag);
  }

  for (const interest of input.userInterests) {
    const normalized = interest.toLowerCase();
    if (INTEREST_TAGS.has(normalized)) tags.add(normalized);
  }

  // Final gate. Even if a map above were edited carelessly, nothing outside
  // the compiled vocabulary can leave this function.
  return [...tags]
    .filter((tag) => TAG_VOCABULARY.has(tag))
    .sort()
    .slice(0, MAX_TAGS);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd extensions/adcode-ads && npx vitest run test/tagger.test.ts`
Expected: PASS, including the 1000-run vocabulary property test.

- [ ] **Step 5: Commit**

```bash
git add extensions/adcode-ads/src/tagger.ts extensions/adcode-ads/test/tagger.test.ts
git commit -m "feat: add on-device tagger with closed tag vocabulary"
```

---

### Task 5: The receipt queue

**Files:**
- Create: `extensions/adcode-ads/src/receiptQueue.ts`
- Test: `extensions/adcode-ads/test/receiptQueue.test.ts`

**Interfaces:**
- Consumes: `Receipt`, `ReceiptKind` from `./types`.
- Produces:
  - `RECEIPT_CAP: number`
  - `class ReceiptQueue` with `static open(filePath: string, cap?: number): Promise<ReceiptQueue>`, `readonly size: number`, `enqueue(receipt: Receipt): void`, `peekBatch(n: number): Receipt[]`, `ack(ids: readonly string[]): void`, `persist(): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`extensions/adcode-ads/test/receiptQueue.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReceiptQueue } from '../src/receiptQueue';
import type { Receipt } from '../src/types';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'adcode-'));
  file = join(dir, 'receipts.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const receipt = (id: string): Receipt => ({
  receiptId: id,
  creativeId: 'cr_1',
  kind: 'impression',
  shownMs: 8000,
  focused: true,
  clientTs: 1_700_000_000_000,
});

describe('ReceiptQueue', () => {
  it('starts empty when no file exists', async () => {
    const q = await ReceiptQueue.open(file);
    expect(q.size).toBe(0);
  });

  it('enqueues and reads back a batch', async () => {
    const q = await ReceiptQueue.open(file);
    q.enqueue(receipt('r1'));
    q.enqueue(receipt('r2'));
    expect(q.peekBatch(10).map((r) => r.receiptId)).toEqual(['r1', 'r2']);
  });

  it('limits a batch to the requested size', async () => {
    const q = await ReceiptQueue.open(file);
    ['r1', 'r2', 'r3'].forEach((id) => q.enqueue(receipt(id)));
    expect(q.peekBatch(2).map((r) => r.receiptId)).toEqual(['r1', 'r2']);
  });

  it('ignores a duplicate receipt id', async () => {
    const q = await ReceiptQueue.open(file);
    q.enqueue(receipt('r1'));
    q.enqueue(receipt('r1'));
    expect(q.size).toBe(1);
  });

  it('drops the oldest entries past the cap', async () => {
    const q = await ReceiptQueue.open(file, 3);
    ['r1', 'r2', 'r3', 'r4'].forEach((id) => q.enqueue(receipt(id)));
    expect(q.peekBatch(10).map((r) => r.receiptId)).toEqual(['r2', 'r3', 'r4']);
  });

  it('removes acked receipts', async () => {
    const q = await ReceiptQueue.open(file);
    ['r1', 'r2', 'r3'].forEach((id) => q.enqueue(receipt(id)));
    q.ack(['r1', 'r3']);
    expect(q.peekBatch(10).map((r) => r.receiptId)).toEqual(['r2']);
  });

  it('allows an acked id to be enqueued again later', async () => {
    const q = await ReceiptQueue.open(file);
    q.enqueue(receipt('r1'));
    q.ack(['r1']);
    q.enqueue(receipt('r1'));
    expect(q.size).toBe(1);
  });

  it('round-trips through disk', async () => {
    const q = await ReceiptQueue.open(file);
    q.enqueue(receipt('r1'));
    await q.persist();

    const reopened = await ReceiptQueue.open(file);
    expect(reopened.peekBatch(10).map((r) => r.receiptId)).toEqual(['r1']);
  });

  it('starts empty rather than throwing on a corrupt file', async () => {
    await writeFile(file, '{ this is not json', 'utf8');
    const q = await ReceiptQueue.open(file);
    expect(q.size).toBe(0);
  });

  it('discards entries that are not valid receipts', async () => {
    await writeFile(file, JSON.stringify([receipt('r1'), { nope: true }, null]), 'utf8');
    const q = await ReceiptQueue.open(file);
    expect(q.peekBatch(10).map((r) => r.receiptId)).toEqual(['r1']);
  });

  it('persists a well-formed array', async () => {
    const q = await ReceiptQueue.open(file, 3);
    q.enqueue(receipt('r1'));
    await q.persist();
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    expect(Array.isArray(parsed)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd extensions/adcode-ads && npx vitest run test/receiptQueue.test.ts`
Expected: FAIL — `Failed to resolve import "../src/receiptQueue"`.

- [ ] **Step 3: Implement the queue**

`extensions/adcode-ads/src/receiptQueue.ts`:

```typescript
import { readFile, writeFile, rename } from 'node:fs/promises';
import type { Receipt, ReceiptKind } from './types';

export const RECEIPT_CAP = 500;

const KINDS: readonly ReceiptKind[] = ['impression', 'click'];

function isReceipt(value: unknown): value is Receipt {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r['receiptId'] === 'string' &&
    typeof r['creativeId'] === 'string' &&
    typeof r['kind'] === 'string' &&
    KINDS.includes(r['kind'] as ReceiptKind) &&
    typeof r['shownMs'] === 'number' &&
    typeof r['focused'] === 'boolean' &&
    typeof r['clientTs'] === 'number'
  );
}

/**
 * Disk-backed FIFO of pending receipts. Bounded, deduped, and tolerant of a
 * corrupt file — losing a few unsent receipts is acceptable, crashing the
 * extension host is not.
 */
export class ReceiptQueue {
  private items: Receipt[] = [];
  private readonly pending = new Set<string>();

  private constructor(
    private readonly filePath: string,
    private readonly cap: number,
  ) {}

  static async open(filePath: string, cap: number = RECEIPT_CAP): Promise<ReceiptQueue> {
    const queue = new ReceiptQueue(filePath, cap);
    try {
      const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'));
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (isReceipt(entry)) queue.enqueue(entry);
        }
      }
    } catch {
      // Missing or corrupt file. Start clean.
    }
    return queue;
  }

  get size(): number {
    return this.items.length;
  }

  enqueue(receipt: Receipt): void {
    if (this.pending.has(receipt.receiptId)) return;
    this.items.push(receipt);
    this.pending.add(receipt.receiptId);
    while (this.items.length > this.cap) {
      const dropped = this.items.shift();
      if (dropped !== undefined) this.pending.delete(dropped.receiptId);
    }
  }

  peekBatch(n: number): Receipt[] {
    return this.items.slice(0, Math.max(0, n));
  }

  ack(ids: readonly string[]): void {
    const acked = new Set(ids);
    this.items = this.items.filter((r) => !acked.has(r.receiptId));
    for (const id of acked) this.pending.delete(id);
  }

  /** Write-then-rename so a crash mid-write cannot truncate the queue. */
  async persist(): Promise<void> {
    const temp = `${this.filePath}.tmp`;
    await writeFile(temp, JSON.stringify(this.items), 'utf8');
    await rename(temp, this.filePath);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd extensions/adcode-ads && npx vitest run test/receiptQueue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/adcode-ads/src/receiptQueue.ts extensions/adcode-ads/test/receiptQueue.test.ts
git commit -m "feat: add bounded disk-backed receipt queue with atomic persist"
```

---
