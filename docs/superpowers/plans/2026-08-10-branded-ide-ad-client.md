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

### Task 6: The mock server

Implements all four endpoints of the serving contract plus an asset host, so the extension is completable and testable without Project B. Node 24 strips TypeScript types natively, so this runs with no build step.

**Files:**
- Create: `mock-server/package.json`
- Create: `mock-server/src/server.ts`
- Test: `mock-server/test/server.test.ts`

**Interfaces:**
- Consumes: nothing. Deliberately shares no code with the extension — a mock that imports the client's own types cannot catch a contract mismatch.
- Produces (HTTP, all requiring `Authorization: Bearer <token>`):
  - `POST /v1/serve` → `{ creatives: Creative[] }`
  - `POST /v1/receipts` → `{ acked: string[] }`
  - `GET /v1/balance` → `{ availableMicros: number, lifetimeMicros: number }`
  - `GET /v1/config` → `{ enabled: boolean, minIntervalMs: number, dailyCap: number }`
  - `GET /assets/:creativeId/:theme.svg` → `image/svg+xml`
  - `POST /__test__/reset` → resets state between tests
- Also produces `startServer(port: number): Promise<{ port: number; close: () => Promise<void> }>` for use by tests.

- [ ] **Step 1: Create the package manifest**

`mock-server/package.json`:

```json
{
  "name": "adcode-mock-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "start": "node src/server.ts",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write the failing tests**

`mock-server/test/server.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startServer } from '../src/server.ts';

let base: string;
let close: () => Promise<void>;

const AUTH = { authorization: 'Bearer fake-id-token', 'content-type': 'application/json' };

beforeAll(async () => {
  const server = await startServer(0);
  base = `http://127.0.0.1:${server.port}`;
  close = server.close;
});
afterAll(async () => { await close(); });
beforeEach(async () => {
  await fetch(`${base}/__test__/reset`, { method: 'POST' });
});

describe('auth', () => {
  it('rejects a request with no bearer token', async () => {
    const res = await fetch(`${base}/v1/config`);
    expect(res.status).toBe(401);
  });
});

describe('POST /v1/serve', () => {
  it('returns creatives with light and dark assets on the allowlisted host', async () => {
    const res = await fetch(`${base}/v1/serve`, {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ tags: ['typescript'], themeKind: 'dark', count: 3 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { creatives: Array<Record<string, string>> };
    expect(body.creatives.length).toBeGreaterThan(0);
    for (const c of body.creatives) {
      expect(c.logoLight).toMatch(/^https:\/\/assets\.adcode\.dev\//);
      expect(c.logoDark).toMatch(/^https:\/\/assets\.adcode\.dev\//);
      expect(c.clickUrl).toMatch(/^https:\/\//);
    }
  });

  it('honors the requested count', async () => {
    const res = await fetch(`${base}/v1/serve`, {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({ tags: [], themeKind: 'light', count: 2 }),
    });
    const body = await res.json() as { creatives: unknown[] };
    expect(body.creatives).toHaveLength(2);
  });

  it('prefers creatives matching the requested tags', async () => {
    const res = await fetch(`${base}/v1/serve`, {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({ tags: ['kubernetes'], themeKind: 'light', count: 1 }),
    });
    const body = await res.json() as { creatives: Array<{ campaignId: string }> };
    expect(body.creatives[0]!.campaignId).toBe('cm_infra');
  });
});

describe('POST /v1/receipts', () => {
  const receipt = (id: string) => ({
    receiptId: id, creativeId: 'cr_sentry', kind: 'impression',
    shownMs: 8000, focused: true, clientTs: Date.now(),
  });

  it('acks submitted receipts and credits half the bid', async () => {
    const res = await fetch(`${base}/v1/receipts`, {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({ receipts: [receipt('r1')] }),
    });
    expect(await res.json()).toEqual({ acked: ['r1'] });

    const balance = await (await fetch(`${base}/v1/balance`, { headers: AUTH })).json();
    expect(balance).toEqual({ availableMicros: 2000, lifetimeMicros: 2000 });
  });

  it('is idempotent by receipt id', async () => {
    await fetch(`${base}/v1/receipts`, {
      method: 'POST', headers: AUTH, body: JSON.stringify({ receipts: [receipt('r1')] }),
    });
    const res = await fetch(`${base}/v1/receipts`, {
      method: 'POST', headers: AUTH, body: JSON.stringify({ receipts: [receipt('r1')] }),
    });
    expect(await res.json()).toEqual({ acked: ['r1'] });

    const balance = await (await fetch(`${base}/v1/balance`, { headers: AUTH })).json() as
      { lifetimeMicros: number };
    expect(balance.lifetimeMicros).toBe(2000);
  });

  it('acks but does not credit a receipt under 4 seconds', async () => {
    await fetch(`${base}/v1/receipts`, {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({ receipts: [{ ...receipt('r2'), shownMs: 3999 }] }),
    });
    const balance = await (await fetch(`${base}/v1/balance`, { headers: AUTH })).json() as
      { lifetimeMicros: number };
    expect(balance.lifetimeMicros).toBe(0);
  });

  it('acks but does not credit an unfocused receipt', async () => {
    await fetch(`${base}/v1/receipts`, {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({ receipts: [{ ...receipt('r3'), focused: false }] }),
    });
    const balance = await (await fetch(`${base}/v1/balance`, { headers: AUTH })).json() as
      { lifetimeMicros: number };
    expect(balance.lifetimeMicros).toBe(0);
  });
});

describe('GET /v1/config', () => {
  it('returns caps at least as loose as the client defaults', async () => {
    const res = await fetch(`${base}/v1/config`, { headers: AUTH });
    expect(await res.json()).toEqual({
      enabled: true, minIntervalMs: 30 * 60_000, dailyCap: 8,
    });
  });
});

describe('GET /assets', () => {
  it('serves distinct svg for light and dark', async () => {
    const light = await (await fetch(`${base}/assets/cr_sentry/light.svg`)).text();
    const dark = await (await fetch(`${base}/assets/cr_sentry/dark.svg`)).text();
    expect(light).toContain('<svg');
    expect(dark).toContain('<svg');
    expect(light).not.toBe(dark);
  });

  it('404s an unknown asset path', async () => {
    expect((await fetch(`${base}/assets/nope/light.svg`)).status).toBe(404);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd mock-server && npm install && npx vitest run`
Expected: FAIL — cannot resolve `../src/server.ts`.

- [ ] **Step 4: Implement the server**

`mock-server/src/server.ts`:

```typescript
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

const ASSET_HOST = 'https://assets.adcode.dev';

/** $4 CPM. The user's half of this is what a valid impression is worth. */
const BID_MICROS = 4000;
const USER_SHARE_NUMERATOR = 1;
const USER_SHARE_DENOMINATOR = 2;

/** An impression must have been on screen this long, focused, to earn. */
const MIN_SHOWN_MS = 4000;

interface Fixture {
  creativeId: string;
  campaignId: string;
  headline: string;
  body: string;
  clickUrl: string;
  tags: string[];
}

const FIXTURES: Fixture[] = [
  {
    creativeId: 'cr_sentry', campaignId: 'cm_observability',
    headline: 'Sentry', body: 'Catch errors before your users do.',
    clickUrl: 'https://sentry.io', tags: ['typescript', 'javascript', 'python'],
  },
  {
    creativeId: 'cr_linear', campaignId: 'cm_pm',
    headline: 'Linear', body: 'Issue tracking built for speed.',
    clickUrl: 'https://linear.app', tags: ['react', 'typescript'],
  },
  {
    creativeId: 'cr_pulumi', campaignId: 'cm_infra',
    headline: 'Pulumi', body: 'Infrastructure as real code.',
    clickUrl: 'https://pulumi.com', tags: ['kubernetes', 'terraform', 'docker', 'go'],
  },
  {
    creativeId: 'cr_planetscale', campaignId: 'cm_data',
    headline: 'PlanetScale', body: 'Serverless MySQL that scales.',
    clickUrl: 'https://planetscale.com', tags: ['sql', 'data', 'backend'],
  },
];

interface State {
  seenReceipts: Set<string>;
  lifetimeMicros: number;
  availableMicros: number;
}

const freshState = (): State => ({
  seenReceipts: new Set(),
  lifetimeMicros: 0,
  availableMicros: 0,
});

function svg(label: string, fg: string, bg: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">` +
    `<rect width="48" height="48" rx="10" fill="${bg}"/>` +
    `<text x="24" y="31" font-family="sans-serif" font-size="20" font-weight="700" ` +
    `text-anchor="middle" fill="${fg}">${label}</text></svg>`;
}

function toCreative(f: Fixture) {
  return {
    creativeId: f.creativeId,
    campaignId: f.campaignId,
    headline: f.headline,
    body: f.body,
    logoLight: `${ASSET_HOST}/${f.creativeId}/light.svg`,
    logoDark: `${ASSET_HOST}/${f.creativeId}/dark.svg`,
    clickUrl: f.clickUrl,
    expiresAt: Date.now() + 60 * 60_000,
  };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof parsed === 'object' && parsed !== null
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export async function startServer(
  port: number,
): Promise<{ port: number; close: () => Promise<void> }> {
  let state = freshState();

  const server = createServer((req, res) => {
    void handle(req, res).catch(() => json(res, 500, { error: 'internal' }));
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (req.method === 'POST' && path === '/__test__/reset') {
      state = freshState();
      json(res, 200, { ok: true });
      return;
    }

    // Assets are public — the IDE fetches them before any token is minted.
    const asset = /^\/assets\/([A-Za-z0-9_-]+)\/(light|dark)\.svg$/.exec(path);
    if (req.method === 'GET' && asset !== null) {
      const [, creativeId, theme] = asset;
      const fixture = FIXTURES.find((f) => f.creativeId === creativeId);
      if (fixture === undefined) {
        json(res, 404, { error: 'no such asset' });
        return;
      }
      const body = theme === 'light'
        ? svg(fixture.headline.slice(0, 1), '#ffffff', '#1f2328')
        : svg(fixture.headline.slice(0, 1), '#1f2328', '#f0f2f4');
      res.writeHead(200, {
        'content-type': 'image/svg+xml',
        'content-length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }

    const auth = req.headers['authorization'];
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      json(res, 401, { error: 'missing bearer token' });
      return;
    }

    if (req.method === 'GET' && path === '/v1/config') {
      json(res, 200, { enabled: true, minIntervalMs: 30 * 60_000, dailyCap: 8 });
      return;
    }

    if (req.method === 'GET' && path === '/v1/balance') {
      json(res, 200, {
        availableMicros: state.availableMicros,
        lifetimeMicros: state.lifetimeMicros,
      });
      return;
    }

    if (req.method === 'POST' && path === '/v1/serve') {
      const body = await readJson(req);
      const tags = Array.isArray(body['tags']) ? body['tags'] as string[] : [];
      const count = typeof body['count'] === 'number' ? body['count'] : 1;

      const scored = FIXTURES
        .map((f) => ({ f, score: f.tags.filter((t) => tags.includes(t)).length }))
        .sort((a, b) => b.score - a.score);

      json(res, 200, {
        creatives: scored.slice(0, Math.max(0, Math.min(count, FIXTURES.length)))
          .map(({ f }) => toCreative(f)),
      });
      return;
    }

    if (req.method === 'POST' && path === '/v1/receipts') {
      const body = await readJson(req);
      const receipts = Array.isArray(body['receipts'])
        ? body['receipts'] as Array<Record<string, unknown>>
        : [];
      const acked: string[] = [];

      for (const r of receipts) {
        const id = r['receiptId'];
        if (typeof id !== 'string') continue;
        acked.push(id);
        if (state.seenReceipts.has(id)) continue;
        state.seenReceipts.add(id);

        const valid = r['kind'] === 'impression' &&
          r['focused'] === true &&
          typeof r['shownMs'] === 'number' &&
          r['shownMs'] >= MIN_SHOWN_MS;

        if (valid) {
          // Integer arithmetic only. Never floats for money.
          const credit = Math.floor(
            (BID_MICROS * USER_SHARE_NUMERATOR) / USER_SHARE_DENOMINATOR,
          );
          state.lifetimeMicros += credit;
          state.availableMicros += credit;
        }
      }

      // Acked regardless of validity: the client must stop retrying a receipt
      // the server has already judged, valid or not.
      json(res, 200, { acked });
      return;
    }

    json(res, 404, { error: 'no such route' });
  }

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));

  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => (err !== undefined && err !== null ? reject(err) : resolve()));
    }),
  };
}

// Started directly rather than imported by a test.
if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const port = Number(process.env['PORT'] ?? 8787);
  void startServer(port).then((s) => {
    console.log(`[adcode-mock] listening on http://127.0.0.1:${s.port}`);
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd mock-server && npx vitest run`
Expected: PASS, all 11 tests.

- [ ] **Step 6: Confirm it runs standalone**

Run: `cd mock-server && PORT=8787 node src/server.ts`
Expected: prints `[adcode-mock] listening on http://127.0.0.1:8787`. Stop it with Ctrl-C.

- [ ] **Step 7: Add it to CI**

Modify `.github/workflows/ci.yml` — add a second job below the existing `extension` job, at the same indentation:

```yaml
  mock-server:
    runs-on: ubuntu-latest
    defaults:
      run: { working-directory: mock-server }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24' }
      - run: npm ci
      - run: npm test
```

- [ ] **Step 8: Commit**

```bash
git add mock-server .github/workflows/ci.yml
git commit -m "feat: add mock ad server implementing the serving contract"
```

---

### Task 7: Firebase anonymous identity

Uses the Firebase Auth REST API rather than the JS SDK. The SDK assumes browser storage and pulls in a large dependency tree; three REST calls is the entire requirement, and it keeps the extension's activation cost near zero.

Account *linking* at cash-out is out of scope for Project A (spec §12) — this task delivers anonymous identity and token refresh only.

**Files:**
- Create: `extensions/adcode-ads/src/auth.ts`
- Test: `extensions/adcode-ads/test/auth.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface TokenStore { get(key: string): Promise<string | undefined>; set(key: string, value: string): Promise<void> }`
  - `interface AuthProvider { getIdToken(): Promise<string> }`
  - `REFRESH_TOKEN_KEY: string`
  - `class FirebaseAnonymousAuth implements AuthProvider`, constructed with
    `{ apiKey: string; store: TokenStore; fetchImpl?: typeof fetch; now?: () => number }`

- [ ] **Step 1: Write the failing tests**

`extensions/adcode-ads/test/auth.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { FirebaseAnonymousAuth, REFRESH_TOKEN_KEY, type TokenStore } from '../src/auth';

function memoryStore(seed: Record<string, string> = {}): TokenStore {
  const map = new Map(Object.entries(seed));
  return {
    get: async (k) => map.get(k),
    set: async (k, v) => { map.set(k, v); },
  };
}

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('FirebaseAnonymousAuth', () => {
  it('signs up anonymously when no refresh token is stored', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({
      idToken: 'id-1', refreshToken: 'refresh-1', expiresIn: '3600', localId: 'uid-1',
    }));
    const store = memoryStore();
    const auth = new FirebaseAnonymousAuth({ apiKey: 'KEY', store, fetchImpl });

    expect(await auth.getIdToken()).toBe('id-1');
    expect(fetchImpl.mock.calls[0]![0]).toContain('accounts:signUp?key=KEY');
    expect(await store.get(REFRESH_TOKEN_KEY)).toBe('refresh-1');
  });

  it('reuses a cached token without a second network call', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({
      idToken: 'id-1', refreshToken: 'refresh-1', expiresIn: '3600', localId: 'uid-1',
    }));
    const auth = new FirebaseAnonymousAuth({ apiKey: 'KEY', store: memoryStore(), fetchImpl });

    await auth.getIdToken();
    await auth.getIdToken();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refreshes rather than signing up again when a refresh token exists', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({
      id_token: 'id-2', refresh_token: 'refresh-2', expires_in: '3600', user_id: 'uid-1',
    }));
    const store = memoryStore({ [REFRESH_TOKEN_KEY]: 'refresh-1' });
    const auth = new FirebaseAnonymousAuth({ apiKey: 'KEY', store, fetchImpl });

    expect(await auth.getIdToken()).toBe('id-2');
    expect(fetchImpl.mock.calls[0]![0]).toContain('securetoken.googleapis.com');
    expect(await store.get(REFRESH_TOKEN_KEY)).toBe('refresh-2');
  });

  it('refreshes once the cached token is inside the expiry skew', async () => {
    let clock = 1_000_000;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(okJson({
        idToken: 'id-1', refreshToken: 'refresh-1', expiresIn: '3600', localId: 'uid-1',
      }))
      .mockResolvedValueOnce(okJson({
        id_token: 'id-2', refresh_token: 'refresh-2', expires_in: '3600', user_id: 'uid-1',
      }));
    const auth = new FirebaseAnonymousAuth({
      apiKey: 'KEY', store: memoryStore(), fetchImpl, now: () => clock,
    });

    expect(await auth.getIdToken()).toBe('id-1');
    clock += 3600_000 - 30_000;        // inside the 60s skew
    expect(await auth.getIdToken()).toBe('id-2');
  });

  it('falls back to anonymous sign-up when the refresh token is rejected', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{"message":"TOKEN_EXPIRED"}}', { status: 400 }))
      .mockResolvedValueOnce(okJson({
        idToken: 'id-3', refreshToken: 'refresh-3', expiresIn: '3600', localId: 'uid-2',
      }));
    const store = memoryStore({ [REFRESH_TOKEN_KEY]: 'stale' });
    const auth = new FirebaseAnonymousAuth({ apiKey: 'KEY', store, fetchImpl });

    expect(await auth.getIdToken()).toBe('id-3');
    expect(await store.get(REFRESH_TOKEN_KEY)).toBe('refresh-3');
  });

  it('throws when sign-up itself fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));
    const auth = new FirebaseAnonymousAuth({ apiKey: 'KEY', store: memoryStore(), fetchImpl });
    await expect(auth.getIdToken()).rejects.toThrow(/sign-up failed/i);
  });

  it('coalesces concurrent callers into a single sign-up', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return okJson({
        idToken: 'id-1', refreshToken: 'refresh-1', expiresIn: '3600', localId: 'uid-1',
      });
    });
    const auth = new FirebaseAnonymousAuth({ apiKey: 'KEY', store: memoryStore(), fetchImpl });

    const [a, b, c] = await Promise.all([
      auth.getIdToken(), auth.getIdToken(), auth.getIdToken(),
    ]);
    expect([a, b, c]).toEqual(['id-1', 'id-1', 'id-1']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd extensions/adcode-ads && npx vitest run test/auth.test.ts`
Expected: FAIL — `Failed to resolve import "../src/auth"`.

- [ ] **Step 3: Implement auth**

`extensions/adcode-ads/src/auth.ts`:

```typescript
const SIGN_UP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp';
const REFRESH_URL = 'https://securetoken.googleapis.com/v1/token';

/** Refresh this long before actual expiry, to survive clock skew and slow networks. */
const EXPIRY_SKEW_MS = 60_000;

export const REFRESH_TOKEN_KEY = 'adcode.auth.refreshToken';

export interface TokenStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export interface AuthProvider {
  getIdToken(): Promise<string>;
}

interface CachedToken {
  idToken: string;
  expiresAtMs: number;
}

export interface FirebaseAnonymousAuthOptions {
  apiKey: string;
  store: TokenStore;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * Anonymous Firebase identity for the IDE client. No UI, no sign-in wall.
 * The resulting UID is stable and pseudonymous — see spec section 6.1.
 */
export class FirebaseAnonymousAuth implements AuthProvider {
  private cached: CachedToken | null = null;
  private inflight: Promise<string> | null = null;

  private readonly apiKey: string;
  private readonly store: TokenStore;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(options: FirebaseAnonymousAuthOptions) {
    this.apiKey = options.apiKey;
    this.store = options.store;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => Date.now());
  }

  async getIdToken(): Promise<string> {
    if (this.cached !== null && this.now() < this.cached.expiresAtMs - EXPIRY_SKEW_MS) {
      return this.cached.idToken;
    }
    // Coalesce: several modules may ask for a token in the same tick.
    if (this.inflight !== null) return this.inflight;

    this.inflight = this.acquire().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async acquire(): Promise<string> {
    const refreshToken = await this.store.get(REFRESH_TOKEN_KEY);
    if (refreshToken !== undefined) {
      const refreshed = await this.refresh(refreshToken);
      if (refreshed !== null) return refreshed;
      // Refresh token rejected — fall through to a fresh anonymous identity.
    }
    return this.signUp();
  }

  private async refresh(refreshToken: string): Promise<string | null> {
    const res = await this.fetchImpl(`${REFRESH_URL}?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    if (!res.ok) return null;

    const body = await res.json() as
      { id_token?: string; refresh_token?: string; expires_in?: string };
    if (typeof body.id_token !== 'string' || typeof body.refresh_token !== 'string') {
      return null;
    }
    await this.store.set(REFRESH_TOKEN_KEY, body.refresh_token);
    return this.cache(body.id_token, body.expires_in);
  }

  private async signUp(): Promise<string> {
    const res = await this.fetchImpl(`${SIGN_UP_URL}?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    });
    if (!res.ok) {
      throw new Error(`anonymous sign-up failed with status ${res.status}`);
    }

    const body = await res.json() as
      { idToken?: string; refreshToken?: string; expiresIn?: string };
    if (typeof body.idToken !== 'string' || typeof body.refreshToken !== 'string') {
      throw new Error('anonymous sign-up failed: malformed response');
    }
    await this.store.set(REFRESH_TOKEN_KEY, body.refreshToken);
    return this.cache(body.idToken, body.expiresIn);
  }

  private cache(idToken: string, expiresIn: string | undefined): string {
    const seconds = Number(expiresIn ?? '3600');
    const ttlMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 3600_000;
    this.cached = { idToken, expiresAtMs: this.now() + ttlMs };
    return idToken;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd extensions/adcode-ads && npx vitest run test/auth.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add extensions/adcode-ads/src/auth.ts extensions/adcode-ads/test/auth.test.ts
git commit -m "feat: add Firebase anonymous identity with token refresh and coalescing"
```

---

### Task 8: The API client

Implements the degradation rule directly: **no method on this class throws for a network condition.** Failures return an empty result and engage backoff. A dead ad server must be indistinguishable from a quiet one.

**Files:**
- Create: `extensions/adcode-ads/src/client.ts`
- Test: `extensions/adcode-ads/test/client.test.ts`

**Interfaces:**
- Consumes: `Creative`, `Receipt`, `Balance`, `RemoteConfig`, `ThemeKind` from `./types`; `validateCreatives` from `./validation`; `AuthProvider` from `./auth`.
- Produces:
  - `REQUEST_TIMEOUT_MS: number`, `BACKOFF_BASE_MS: number`, `BACKOFF_MAX_MS: number`
  - `class AdClient` constructed with `{ baseUrl: string; assetHost: string; auth: AuthProvider; fetchImpl?: typeof fetch; now?: () => number; random?: () => number }`, exposing:
    - `serve(tags: readonly string[], themeKind: ThemeKind, count: number): Promise<Creative[]>`
    - `postReceipts(receipts: readonly Receipt[]): Promise<string[]>`
    - `balance(): Promise<Balance | null>`
    - `config(): Promise<RemoteConfig | null>`
    - `readonly backedOff: boolean`

- [ ] **Step 1: Write the failing tests**

`extensions/adcode-ads/test/client.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { AdClient, BACKOFF_BASE_MS } from '../src/client';
import type { AuthProvider } from '../src/auth';

const auth: AuthProvider = { getIdToken: async () => 'id-token-1' };

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200, headers: { 'content-type': 'application/json' },
  });

const creative = (id: string) => ({
  creativeId: id, campaignId: 'cm_1',
  headline: 'Sentry', body: 'Catch errors before your users do.',
  logoLight: 'https://assets.adcode.dev/cr_1/light.svg',
  logoDark: 'https://assets.adcode.dev/cr_1/dark.svg',
  clickUrl: 'https://sentry.io', expiresAt: 1_800_000_000_000,
});

const make = (fetchImpl: typeof fetch, now: () => number = () => 1_000_000) =>
  new AdClient({
    baseUrl: 'https://api.example', assetHost: 'assets.adcode.dev',
    auth, fetchImpl, now, random: () => 0.5,
  });

describe('serve', () => {
  it('sends the bearer token and returns validated creatives', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ creatives: [creative('cr_1')] }));
    const client = make(fetchImpl);

    const out = await client.serve(['typescript'], 'dark', 3);
    expect(out.map((c) => c.creativeId)).toEqual(['cr_1']);

    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer id-token-1');
    expect(JSON.parse(init.body as string)).toEqual({
      tags: ['typescript'], themeKind: 'dark', count: 3,
    });
  });

  it('never sends an identifier in the request body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ creatives: [] }));
    await make(fetchImpl).serve([], 'light', 1);

    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(Object.keys(body).sort()).toEqual(['count', 'tags', 'themeKind']);
  });

  it('drops creatives that fail validation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({
      creatives: [creative('cr_1'), { ...creative('cr_2'), clickUrl: 'http://evil.example' }],
    }));
    const out = await make(fetchImpl).serve([], 'light', 5);
    expect(out.map((c) => c.creativeId)).toEqual(['cr_1']);
  });

  it('returns an empty array on a 500 rather than throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(make(fetchImpl).serve([], 'light', 1)).resolves.toEqual([]);
  });

  it('returns an empty array on malformed json', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{not json', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await expect(make(fetchImpl).serve([], 'light', 1)).resolves.toEqual([]);
  });

  it('returns an empty array when the network rejects', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));
    await expect(make(fetchImpl).serve([], 'light', 1)).resolves.toEqual([]);
  });

  it('returns an empty array when auth itself fails', async () => {
    const failing: AuthProvider = { getIdToken: async () => { throw new Error('no network'); } };
    const client = new AdClient({
      baseUrl: 'https://api.example', assetHost: 'assets.adcode.dev',
      auth: failing, fetchImpl: vi.fn(), now: () => 0, random: () => 0.5,
    });
    await expect(client.serve([], 'light', 1)).resolves.toEqual([]);
  });

  it('passes an abort signal so a hung server cannot block forever', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ creatives: [] }));
    await make(fetchImpl).serve([], 'light', 1);
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('backoff', () => {
  it('skips the network entirely while backed off', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
    const client = make(fetchImpl, () => 1_000_000);

    await client.serve([], 'light', 1);
    expect(client.backedOff).toBe(true);

    await client.serve([], 'light', 1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('resumes once the backoff window elapses', async () => {
    let clock = 1_000_000;
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(okJson({ creatives: [creative('cr_1')] }));
    const client = make(fetchImpl, () => clock);

    await client.serve([], 'light', 1);
    clock += BACKOFF_BASE_MS + 1;
    const out = await client.serve([], 'light', 1);

    expect(out).toHaveLength(1);
    expect(client.backedOff).toBe(false);
  });

  it('grows the window on repeated failures', async () => {
    let clock = 1_000_000;
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
    const client = make(fetchImpl, () => clock);

    await client.serve([], 'light', 1);
    clock += BACKOFF_BASE_MS + 1;
    await client.serve([], 'light', 1);       // second failure, doubles

    clock += BACKOFF_BASE_MS + 1;             // not enough for the doubled window
    await client.serve([], 'light', 1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('clears after a success', async () => {
    let clock = 1_000_000;
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(okJson({ creatives: [] }));
    const client = make(fetchImpl, () => clock);

    await client.serve([], 'light', 1);
    clock += BACKOFF_BASE_MS + 1;
    await client.serve([], 'light', 1);
    expect(client.backedOff).toBe(false);
  });
});

describe('postReceipts', () => {
  it('returns the acked ids', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ acked: ['r1', 'r2'] }));
    const out = await make(fetchImpl).postReceipts([]);
    expect(out).toEqual(['r1', 'r2']);
  });

  it('returns an empty array on failure so nothing is wrongly acked', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
    await expect(make(fetchImpl).postReceipts([])).resolves.toEqual([]);
  });

  it('ignores non-string entries in the acked list', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ acked: ['r1', 7, null] }));
    await expect(make(fetchImpl).postReceipts([])).resolves.toEqual(['r1']);
  });
});

describe('balance and config', () => {
  it('parses a balance', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      okJson({ availableMicros: 2000, lifetimeMicros: 5000 }));
    await expect(make(fetchImpl).balance()).resolves.toEqual({
      availableMicros: 2000, lifetimeMicros: 5000,
    });
  });

  it('returns null for a balance with non-numeric fields', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ availableMicros: '2000' }));
    await expect(make(fetchImpl).balance()).resolves.toBeNull();
  });

  it('parses a config', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      okJson({ enabled: true, minIntervalMs: 60_000, dailyCap: 4 }));
    await expect(make(fetchImpl).config()).resolves.toEqual({
      enabled: true, minIntervalMs: 60_000, dailyCap: 4,
    });
  });

  it('returns null for a malformed config so shipped defaults stand', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ enabled: 'yes' }));
    await expect(make(fetchImpl).config()).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd extensions/adcode-ads && npx vitest run test/client.test.ts`
Expected: FAIL — `Failed to resolve import "../src/client"`.

- [ ] **Step 3: Implement the client**

`extensions/adcode-ads/src/client.ts`:

```typescript
import type { AuthProvider } from './auth';
import type { Balance, Creative, Receipt, RemoteConfig, ThemeKind } from './types';
import { validateCreatives } from './validation';

export const REQUEST_TIMEOUT_MS = 3000;
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 15 * 60_000;

export interface AdClientOptions {
  baseUrl: string;
  assetHost: string;
  auth: AuthProvider;
  fetchImpl?: typeof fetch;
  now?: () => number;
  random?: () => number;
}

/**
 * Talks to the serving contract. No method throws for a network condition —
 * a failure yields an empty result and engages backoff, so a dead ad server
 * is indistinguishable from a quiet one.
 */
export class AdClient {
  private failureCount = 0;
  private backoffUntilMs = 0;

  private readonly baseUrl: string;
  private readonly assetHost: string;
  private readonly auth: AuthProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(options: AdClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.assetHost = options.assetHost;
    this.auth = options.auth;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
  }

  get backedOff(): boolean {
    return this.now() < this.backoffUntilMs;
  }

  async serve(
    tags: readonly string[],
    themeKind: ThemeKind,
    count: number,
  ): Promise<Creative[]> {
    // Identity travels in the token, never the body.
    const body = await this.request('POST', '/v1/serve', { tags, themeKind, count });
    if (body === null) return [];
    return validateCreatives(
      (body as Record<string, unknown>)['creatives'],
      { assetHost: this.assetHost },
    );
  }

  async postReceipts(receipts: readonly Receipt[]): Promise<string[]> {
    const body = await this.request('POST', '/v1/receipts', { receipts });
    if (body === null) return [];
    const acked = (body as Record<string, unknown>)['acked'];
    if (!Array.isArray(acked)) return [];
    return acked.filter((id): id is string => typeof id === 'string');
  }

  async balance(): Promise<Balance | null> {
    const body = await this.request('GET', '/v1/balance');
    if (body === null) return null;
    const b = body as Record<string, unknown>;
    if (typeof b['availableMicros'] !== 'number' || typeof b['lifetimeMicros'] !== 'number') {
      return null;
    }
    return { availableMicros: b['availableMicros'], lifetimeMicros: b['lifetimeMicros'] };
  }

  async config(): Promise<RemoteConfig | null> {
    const body = await this.request('GET', '/v1/config');
    if (body === null) return null;
    const c = body as Record<string, unknown>;
    if (
      typeof c['enabled'] !== 'boolean' ||
      typeof c['minIntervalMs'] !== 'number' ||
      typeof c['dailyCap'] !== 'number'
    ) {
      return null;
    }
    return {
      enabled: c['enabled'],
      minIntervalMs: c['minIntervalMs'],
      dailyCap: c['dailyCap'],
    };
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<unknown | null> {
    if (this.backedOff) return null;

    try {
      const token = await this.auth.getIdToken();
      const init: RequestInit = {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      };
      if (body !== undefined) init.body = JSON.stringify(body);

      const res = await this.fetchImpl(`${this.baseUrl}${path}`, init);
      if (!res.ok) {
        this.recordFailure();
        return null;
      }

      const parsed: unknown = await res.json();
      this.recordSuccess();
      return parsed;
    } catch {
      // Timeout, DNS failure, offline, malformed JSON, or auth failure.
      this.recordFailure();
      return null;
    }
  }

  private recordSuccess(): void {
    this.failureCount = 0;
    this.backoffUntilMs = 0;
  }

  private recordFailure(): void {
    this.failureCount += 1;
    const window = Math.min(
      BACKOFF_BASE_MS * 2 ** (this.failureCount - 1),
      BACKOFF_MAX_MS,
    );
    // Jitter spreads reconnects so a recovering server is not stampeded.
    const jittered = window * (0.5 + this.random() * 0.5);
    this.backoffUntilMs = this.now() + jittered;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd extensions/adcode-ads && npx vitest run test/client.test.ts`
Expected: PASS, all 18 tests.

- [ ] **Step 5: Commit**

```bash
git add extensions/adcode-ads/src/client.ts extensions/adcode-ads/test/client.test.ts
git commit -m "feat: add ad API client with timeout, jittered backoff, and no-throw contract"
```

---

### Task 9: The asset cache

Spec requires assets be fetched and cached by us, never hot-linked — hot-linking would hand every advertiser the users' IP addresses on every impression. This module is that boundary. It returns a `data:` URI so the notification and the webview can display a logo with no resource-root or CSP configuration.

It also carries the **development origin override**: validation always demands `https` on the allowlisted host, and the override rewrites only the transport target. Validation stays a security boundary; only fetching is redirected.

**Files:**
- Create: `extensions/adcode-ads/src/assetCache.ts`
- Test: `extensions/adcode-ads/test/assetCache.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `MAX_ASSET_BYTES: number`, `ALLOWED_ASSET_TYPES: ReadonlySet<string>`
  - `class AssetCache` constructed with `{ dir: string; fetchImpl?: typeof fetch; devOriginOverride?: string; maxEntries?: number }`, exposing `getDataUri(url: string): Promise<string | null>`

- [ ] **Step 1: Write the failing tests**

`extensions/adcode-ads/test/assetCache.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetCache, MAX_ASSET_BYTES } from '../src/assetCache';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'adcode-assets-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
const URL_LIGHT = 'https://assets.adcode.dev/cr_1/light.svg';

const svgResponse = (body = SVG) =>
  new Response(body, { status: 200, headers: { 'content-type': 'image/svg+xml' } });

describe('AssetCache', () => {
  it('fetches an asset and returns a data uri', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(svgResponse());
    const uri = await new AssetCache({ dir, fetchImpl }).getDataUri(URL_LIGHT);

    expect(uri).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(Buffer.from(uri!.split(',')[1]!, 'base64').toString('utf8')).toBe(SVG);
  });

  it('serves a second request from memory without refetching', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(svgResponse());
    const cache = new AssetCache({ dir, fetchImpl });

    await cache.getDataUri(URL_LIGHT);
    await cache.getDataUri(URL_LIGHT);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('serves from disk across instances', async () => {
    const first = vi.fn().mockResolvedValue(svgResponse());
    await new AssetCache({ dir, fetchImpl: first }).getDataUri(URL_LIGHT);

    const second = vi.fn().mockRejectedValue(new Error('should not be called'));
    const uri = await new AssetCache({ dir, fetchImpl: second }).getDataUri(URL_LIGHT);

    expect(uri).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(second).not.toHaveBeenCalled();
  });

  it('rewrites only the origin under the dev override', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(svgResponse());
    await new AssetCache({
      dir, fetchImpl, devOriginOverride: 'http://127.0.0.1:8787',
    }).getDataUri(URL_LIGHT);

    expect(fetchImpl.mock.calls[0]![0]).toBe('http://127.0.0.1:8787/cr_1/light.svg');
  });

  it('rejects a disallowed content type', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    await expect(new AssetCache({ dir, fetchImpl }).getDataUri(URL_LIGHT)).resolves.toBeNull();
  });

  it('rejects an svg containing a script element', async () => {
    const hostile = '<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>';
    const fetchImpl = vi.fn().mockResolvedValue(svgResponse(hostile));
    await expect(new AssetCache({ dir, fetchImpl }).getDataUri(URL_LIGHT)).resolves.toBeNull();
  });

  it('rejects an oversized asset', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('x'.repeat(MAX_ASSET_BYTES + 1), {
        status: 200, headers: { 'content-type': 'image/svg+xml' },
      }));
    await expect(new AssetCache({ dir, fetchImpl }).getDataUri(URL_LIGHT)).resolves.toBeNull();
  });

  it('returns null on a network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(new AssetCache({ dir, fetchImpl }).getDataUri(URL_LIGHT)).resolves.toBeNull();
  });

  it('returns null on a 404', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    await expect(new AssetCache({ dir, fetchImpl }).getDataUri(URL_LIGHT)).resolves.toBeNull();
  });

  it('evicts the oldest entries past maxEntries', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(svgResponse());
    const cache = new AssetCache({ dir, fetchImpl, maxEntries: 2 });

    await cache.getDataUri('https://assets.adcode.dev/a/light.svg');
    await cache.getDataUri('https://assets.adcode.dev/b/light.svg');
    await cache.getDataUri('https://assets.adcode.dev/c/light.svg');

    expect((await readdir(dir)).length).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd extensions/adcode-ads && npx vitest run test/assetCache.test.ts`
Expected: FAIL — `Failed to resolve import "../src/assetCache"`.

- [ ] **Step 3: Implement the asset cache**

`extensions/adcode-ads/src/assetCache.ts`:

```typescript
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_ASSET_BYTES = 256 * 1024;

export const ALLOWED_ASSET_TYPES: ReadonlySet<string> = new Set([
  'image/svg+xml',
  'image/png',
  'image/webp',
]);

const DEFAULT_MAX_ENTRIES = 64;

interface CacheEntry {
  mime: string;
  base64: string;
}

export interface AssetCacheOptions {
  dir: string;
  fetchImpl?: typeof fetch;
  /** Development only. Rewrites the request origin; validation still demands https. */
  devOriginOverride?: string;
  maxEntries?: number;
}

/**
 * Fetches and caches creative assets so they are never hot-linked from
 * advertiser servers — hot-linking would leak the user's IP address to every
 * advertiser on every impression.
 */
export class AssetCache {
  private readonly memory = new Map<string, CacheEntry>();
  private readonly dir: string;
  private readonly fetchImpl: typeof fetch;
  private readonly devOriginOverride: string | undefined;
  private readonly maxEntries: number;

  constructor(options: AssetCacheOptions) {
    this.dir = options.dir;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.devOriginOverride = options.devOriginOverride;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  async getDataUri(url: string): Promise<string | null> {
    const key = createHash('sha256').update(url).digest('hex');

    const cached = this.memory.get(key);
    if (cached !== undefined) return toDataUri(cached);

    const fromDisk = await this.readDisk(key);
    if (fromDisk !== null) {
      this.memory.set(key, fromDisk);
      return toDataUri(fromDisk);
    }

    const fetched = await this.download(url);
    if (fetched === null) return null;

    this.memory.set(key, fetched);
    await this.writeDisk(key, fetched);
    return toDataUri(fetched);
  }

  private targetUrl(url: string): string {
    if (this.devOriginOverride === undefined) return url;
    const parsed = new URL(url);
    return `${this.devOriginOverride.replace(/\/+$/, '')}${parsed.pathname}`;
  }

  private async download(url: string): Promise<CacheEntry | null> {
    try {
      const res = await this.fetchImpl(this.targetUrl(url), {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;

      const mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
      if (!ALLOWED_ASSET_TYPES.has(mime)) return null;

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength > MAX_ASSET_BYTES) return null;

      // An <img> will not execute script inside an SVG, but rejecting it
      // costs nothing and keeps the asset pipeline usable elsewhere.
      if (mime === 'image/svg+xml' && /<script[\s>]/i.test(buffer.toString('utf8'))) {
        return null;
      }

      return { mime, base64: buffer.toString('base64') };
    } catch {
      return null;
    }
  }

  private async readDisk(key: string): Promise<CacheEntry | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(this.dir, key), 'utf8'));
      if (typeof parsed !== 'object' || parsed === null) return null;
      const e = parsed as Record<string, unknown>;
      if (typeof e['mime'] !== 'string' || typeof e['base64'] !== 'string') return null;
      if (!ALLOWED_ASSET_TYPES.has(e['mime'])) return null;
      return { mime: e['mime'], base64: e['base64'] };
    } catch {
      return null;
    }
  }

  private async writeDisk(key: string, entry: CacheEntry): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true });
      const target = join(this.dir, key);
      const temp = `${target}.tmp`;
      await writeFile(temp, JSON.stringify(entry), 'utf8');
      await rename(temp, target);
      await this.evict();
    } catch {
      // A full or read-only disk must not break ad display. Memory cache stands.
    }
  }

  private async evict(): Promise<void> {
    const names = (await readdir(this.dir)).filter((n) => !n.endsWith('.tmp'));
    if (names.length <= this.maxEntries) return;

    const stamped = await Promise.all(
      names.map(async (name) => {
        const info = await stat(join(this.dir, name));
        return { name, mtimeMs: info.mtimeMs };
      }),
    );
    stamped.sort((a, b) => a.mtimeMs - b.mtimeMs);

    for (const { name } of stamped.slice(0, stamped.length - this.maxEntries)) {
      await unlink(join(this.dir, name)).catch(() => undefined);
    }
  }
}

function toDataUri(entry: CacheEntry): string {
  return `data:${entry.mime};base64,${entry.base64}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd extensions/adcode-ads && npx vitest run test/assetCache.test.ts`
Expected: PASS, all 10 tests.

- [ ] **Step 5: Commit**

```bash
git add extensions/adcode-ads/src/assetCache.ts extensions/adcode-ads/test/assetCache.test.ts
git commit -m "feat: add asset cache so creatives are never hot-linked from advertisers"
```

---

### Task 10: The ledger mirror

The client never computes money. This module holds a cached copy of the server's number and formats it.

One product decision is embedded in the formatter. At $4 CPM the user's half of an impression is 2000 micros — two tenths of a cent. Under the default 8/day cap that is about 1.6¢ a day, so a plain two-decimal display would read `$0.00` for the better part of a week and look broken. Balances under $1 therefore show four decimals. Formatting always **truncates, never rounds**: a balance must never display higher than it is.

**Files:**
- Create: `extensions/adcode-ads/src/ledger.ts`
- Test: `extensions/adcode-ads/test/ledger.test.ts`

**Interfaces:**
- Consumes: `Balance`, `Micros` from `./types`.
- Produces:
  - `formatMicros(micros: Micros): string`
  - `interface BalanceStore { read(): Balance | undefined; write(balance: Balance): Promise<void> }`
  - `interface BalanceSource { balance(): Promise<Balance | null> }`
  - `ZERO_BALANCE: Balance`
  - `class Ledger` constructed with `{ source: BalanceSource; store: BalanceStore }`, exposing `readonly current: Balance`, `readonly display: string`, `refresh(): Promise<Balance>`

- [ ] **Step 1: Write the failing tests**

`extensions/adcode-ads/test/ledger.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { Ledger, formatMicros, ZERO_BALANCE, type BalanceStore } from '../src/ledger';
import type { Balance } from '../src/types';

function memoryStore(seed?: Balance): BalanceStore {
  let value = seed;
  return {
    read: () => value,
    write: async (b) => { value = b; },
  };
}

describe('formatMicros', () => {
  it.each([
    [0, '$0.0000'],
    [2000, '$0.0020'],
    [16_000, '$0.0160'],
    [999_999, '$0.9999'],
    [1_000_000, '$1.00'],
    [1_234_567, '$1.23'],
    [12_345_678, '$12.34'],
  ])('formats %i micros as %s', (micros, expected) => {
    expect(formatMicros(micros)).toBe(expected);
  });

  it('truncates rather than rounds, so a balance never reads high', () => {
    expect(formatMicros(1_999_999)).toBe('$1.99');
    expect(formatMicros(99_999)).toBe('$0.0999');
  });

  it('clamps a negative balance to zero', () => {
    expect(formatMicros(-5000)).toBe('$0.0000');
  });

  it('clamps a non-finite value to zero', () => {
    expect(formatMicros(Number.NaN)).toBe('$0.0000');
  });
});

describe('Ledger', () => {
  it('starts at zero with no cached balance', () => {
    const ledger = new Ledger({
      source: { balance: async () => null }, store: memoryStore(),
    });
    expect(ledger.current).toEqual(ZERO_BALANCE);
    expect(ledger.display).toBe('$0.0000');
  });

  it('starts from the cached balance so the status bar is right offline', () => {
    const cached: Balance = { availableMicros: 5000, lifetimeMicros: 9000 };
    const ledger = new Ledger({
      source: { balance: async () => null }, store: memoryStore(cached),
    });
    expect(ledger.current).toEqual(cached);
    expect(ledger.display).toBe('$0.0050');
  });

  it('adopts and persists a fresh server balance', async () => {
    const store = memoryStore();
    const fresh: Balance = { availableMicros: 2_500_000, lifetimeMicros: 3_000_000 };
    const ledger = new Ledger({ source: { balance: async () => fresh }, store });

    await ledger.refresh();
    expect(ledger.display).toBe('$2.50');
    expect(store.read()).toEqual(fresh);
  });

  it('keeps the cached balance when the server is unreachable', async () => {
    const cached: Balance = { availableMicros: 5000, lifetimeMicros: 9000 };
    const store = memoryStore(cached);
    const ledger = new Ledger({ source: { balance: async () => null }, store });

    await expect(ledger.refresh()).resolves.toEqual(cached);
    expect(store.read()).toEqual(cached);
  });

  it('does not write when the balance is unchanged', async () => {
    const same: Balance = { availableMicros: 1000, lifetimeMicros: 1000 };
    const store = memoryStore(same);
    const write = vi.spyOn(store, 'write');
    const ledger = new Ledger({ source: { balance: async () => ({ ...same }) }, store });

    await ledger.refresh();
    expect(write).not.toHaveBeenCalled();
  });

  it('survives a store that throws on write', async () => {
    const store: BalanceStore = {
      read: () => undefined,
      write: async () => { throw new Error('storage full'); },
    };
    const ledger = new Ledger({
      source: { balance: async () => ({ availableMicros: 1, lifetimeMicros: 1 }) }, store,
    });
    await expect(ledger.refresh()).resolves.toEqual({ availableMicros: 1, lifetimeMicros: 1 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd extensions/adcode-ads && npx vitest run test/ledger.test.ts`
Expected: FAIL — `Failed to resolve import "../src/ledger"`.

- [ ] **Step 3: Implement the ledger**

`extensions/adcode-ads/src/ledger.ts`:

```typescript
import type { Balance, Micros } from './types';

const MICROS_PER_DOLLAR = 1_000_000;

export const ZERO_BALANCE: Balance = { availableMicros: 0, lifetimeMicros: 0 };

export interface BalanceStore {
  read(): Balance | undefined;
  write(balance: Balance): Promise<void>;
}

export interface BalanceSource {
  balance(): Promise<Balance | null>;
}

/**
 * Integer arithmetic throughout. Truncates rather than rounds so a displayed
 * balance is never higher than the real one. Sub-dollar balances show four
 * decimals because a valid impression is worth two tenths of a cent.
 */
export function formatMicros(micros: Micros): string {
  const safe = Number.isFinite(micros) && micros > 0 ? Math.floor(micros) : 0;
  const dollars = Math.floor(safe / MICROS_PER_DOLLAR);

  if (dollars === 0) {
    const tenThousandths = Math.floor(safe / 100);
    return `$0.${String(tenThousandths).padStart(4, '0')}`;
  }

  const cents = Math.floor((safe % MICROS_PER_DOLLAR) / 10_000);
  return `$${dollars}.${String(cents).padStart(2, '0')}`;
}

/**
 * Mirrors the server-authoritative balance. This module never adds, subtracts,
 * or derives a monetary amount — it copies one and formats it.
 */
export class Ledger {
  private balance: Balance;

  private readonly source: BalanceSource;
  private readonly store: BalanceStore;

  constructor(options: { source: BalanceSource; store: BalanceStore }) {
    this.source = options.source;
    this.store = options.store;
    this.balance = options.store.read() ?? ZERO_BALANCE;
  }

  get current(): Balance {
    return this.balance;
  }

  get display(): string {
    return formatMicros(this.balance.availableMicros);
  }

  async refresh(): Promise<Balance> {
    const fresh = await this.source.balance();
    if (fresh === null) return this.balance;      // Offline. Cached value stands.

    if (
      fresh.availableMicros === this.balance.availableMicros &&
      fresh.lifetimeMicros === this.balance.lifetimeMicros
    ) {
      return this.balance;
    }

    this.balance = fresh;
    try {
      await this.store.write(fresh);
    } catch {
      // A failed cache write must not break the status bar.
    }
    return this.balance;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd extensions/adcode-ads && npx vitest run test/ledger.test.ts`
Expected: PASS, all 13 tests.

- [ ] **Step 5: Commit**

```bash
git add extensions/adcode-ads/src/ledger.ts extensions/adcode-ads/test/ledger.test.ts
git commit -m "feat: add ledger mirror with truncating micros formatter"
```

---

### Task 11: The renderer

Turns a creative into a shown notification and decides which receipts that produced. The VS Code coupling is isolated behind a `NotificationSink` interface, which is what lets this be unit-tested and what lets the extension run in stock VS Code (fallback sink) before the fork exists (sponsored sink, Task 15).

**Files:**
- Create: `extensions/adcode-ads/src/renderer.ts`
- Test: `extensions/adcode-ads/test/renderer.test.ts`

**Interfaces:**
- Consumes: `Creative`, `Receipt`, `ThemeKind` from `./types`.
- Produces:
  - `MIN_IMPRESSION_MS: number`
  - `interface SponsoredView { headline: string; body: string; logoDataUri: string | null }`
  - `type ShowOutcome = 'clicked' | 'hidden' | 'dismissed' | 'timeout'`
  - `interface ShowResult { outcome: ShowOutcome; shownMs: number; focusedThroughout: boolean }`
  - `interface NotificationSink { show(view: SponsoredView): Promise<ShowResult> }`
  - `interface AssetSource { getDataUri(url: string): Promise<string | null> }`
  - `interface PresentResult { receipts: Receipt[]; hideRequested: boolean }`
  - `class Renderer` constructed with `{ sink: NotificationSink; assets: AssetSource; openExternal: (url: string) => Promise<boolean>; now?: () => number; newId?: () => string }`, exposing `present(creative: Creative, themeKind: ThemeKind): Promise<PresentResult>`

- [ ] **Step 1: Write the failing tests**

`extensions/adcode-ads/test/renderer.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { Renderer, MIN_IMPRESSION_MS, type NotificationSink, type ShowResult } from '../src/renderer';
import type { Creative } from '../src/types';

const creative: Creative = {
  creativeId: 'cr_1', campaignId: 'cm_1',
  headline: 'Sentry', body: 'Catch errors before your users do.',
  logoLight: 'https://assets.adcode.dev/cr_1/light.svg',
  logoDark: 'https://assets.adcode.dev/cr_1/dark.svg',
  clickUrl: 'https://sentry.io', expiresAt: 1_800_000_000_000,
};

const sinkReturning = (result: ShowResult) => {
  const show = vi.fn().mockResolvedValue(result);
  return { sink: { show } as NotificationSink, show };
};

const valid: ShowResult = {
  outcome: 'timeout', shownMs: MIN_IMPRESSION_MS, focusedThroughout: true,
};

function make(sink: NotificationSink, overrides: Partial<{
  getDataUri: (url: string) => Promise<string | null>;
  openExternal: (url: string) => Promise<boolean>;
}> = {}) {
  let counter = 0;
  return new Renderer({
    sink,
    assets: { getDataUri: overrides.getDataUri ?? (async () => 'data:image/svg+xml;base64,AA') },
    openExternal: overrides.openExternal ?? (async () => true),
    now: () => 1_700_000_000_000,
    newId: () => `rcpt_${++counter}`,
  });
}

describe('asset selection', () => {
  it('uses the dark logo for a dark theme', async () => {
    const getDataUri = vi.fn().mockResolvedValue('data:image/svg+xml;base64,AA');
    const { sink } = sinkReturning(valid);
    await make(sink, { getDataUri }).present(creative, 'dark');
    expect(getDataUri).toHaveBeenCalledWith(creative.logoDark);
  });

  it('uses the light logo for a light theme', async () => {
    const getDataUri = vi.fn().mockResolvedValue('data:image/svg+xml;base64,AA');
    const { sink } = sinkReturning(valid);
    await make(sink, { getDataUri }).present(creative, 'light');
    expect(getDataUri).toHaveBeenCalledWith(creative.logoLight);
  });

  it('still shows the ad when the logo cannot be fetched', async () => {
    const { sink, show } = sinkReturning(valid);
    const result = await make(sink, { getDataUri: async () => null })
      .present(creative, 'light');

    expect(show).toHaveBeenCalledWith(expect.objectContaining({ logoDataUri: null }));
    expect(result.receipts).toHaveLength(1);
  });
});

describe('impression receipts', () => {
  it('emits an impression at exactly the minimum duration', async () => {
    const { sink } = sinkReturning(valid);
    const { receipts } = await make(sink).present(creative, 'light');

    expect(receipts).toEqual([{
      receiptId: 'rcpt_1', creativeId: 'cr_1', kind: 'impression',
      shownMs: MIN_IMPRESSION_MS, focused: true, clientTs: 1_700_000_000_000,
    }]);
  });

  it('emits nothing one millisecond short of the minimum', async () => {
    const { sink } = sinkReturning({ ...valid, shownMs: MIN_IMPRESSION_MS - 1 });
    const { receipts } = await make(sink).present(creative, 'light');
    expect(receipts).toEqual([]);
  });

  it('emits nothing when focus was lost during display', async () => {
    const { sink } = sinkReturning({ ...valid, focusedThroughout: false });
    const { receipts } = await make(sink).present(creative, 'light');
    expect(receipts).toEqual([]);
  });

  it('emits an impression when the user dismissed it after the minimum', async () => {
    const { sink } = sinkReturning({ ...valid, outcome: 'dismissed', shownMs: 6000 });
    const { receipts } = await make(sink).present(creative, 'light');
    expect(receipts.map((r) => r.kind)).toEqual(['impression']);
  });
});

describe('clicks', () => {
  it('opens the click url externally and emits both receipts', async () => {
    const openExternal = vi.fn().mockResolvedValue(true);
    const { sink } = sinkReturning({ ...valid, outcome: 'clicked', shownMs: 5000 });
    const { receipts } = await make(sink, { openExternal }).present(creative, 'light');

    expect(openExternal).toHaveBeenCalledWith('https://sentry.io');
    expect(receipts.map((r) => r.kind)).toEqual(['impression', 'click']);
    expect(new Set(receipts.map((r) => r.receiptId)).size).toBe(2);
  });

  it('emits a click receipt even when the impression was too short', async () => {
    const { sink } = sinkReturning({ ...valid, outcome: 'clicked', shownMs: 500 });
    const { receipts } = await make(sink).present(creative, 'light');
    expect(receipts.map((r) => r.kind)).toEqual(['click']);
  });

  it('refuses to open a non-https url', async () => {
    const openExternal = vi.fn();
    const { sink } = sinkReturning({ ...valid, outcome: 'clicked', shownMs: 5000 });
    const renderer = make(sink, { openExternal });

    await renderer.present({ ...creative, clickUrl: 'http://sentry.io' }, 'light');
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('refuses to open a javascript url', async () => {
    const openExternal = vi.fn();
    const { sink } = sinkReturning({ ...valid, outcome: 'clicked', shownMs: 5000 });
    const renderer = make(sink, { openExternal });

    await renderer.present({ ...creative, clickUrl: 'javascript:alert(1)' }, 'light');
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe('hide', () => {
  it('reports a hide request without suppressing a valid impression', async () => {
    const { sink } = sinkReturning({ ...valid, outcome: 'hidden', shownMs: 5000 });
    const result = await make(sink).present(creative, 'light');

    expect(result.hideRequested).toBe(true);
    expect(result.receipts.map((r) => r.kind)).toEqual(['impression']);
  });

  it('reports no hide request otherwise', async () => {
    const { sink } = sinkReturning(valid);
    expect((await make(sink).present(creative, 'light')).hideRequested).toBe(false);
  });
});

describe('sink failure', () => {
  it('returns no receipts when the sink throws', async () => {
    const sink = { show: vi.fn().mockRejectedValue(new Error('notification failed')) };
    await expect(make(sink).present(creative, 'light'))
      .resolves.toEqual({ receipts: [], hideRequested: false });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd extensions/adcode-ads && npx vitest run test/renderer.test.ts`
Expected: FAIL — `Failed to resolve import "../src/renderer"`.

- [ ] **Step 3: Implement the renderer**

`extensions/adcode-ads/src/renderer.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import type { Creative, Receipt, ThemeKind } from './types';

/** An impression must be on screen at least this long, focused, to count. */
export const MIN_IMPRESSION_MS = 4000;

export interface SponsoredView {
  headline: string;
  body: string;
  logoDataUri: string | null;
}

export type ShowOutcome = 'clicked' | 'hidden' | 'dismissed' | 'timeout';

export interface ShowResult {
  outcome: ShowOutcome;
  shownMs: number;
  focusedThroughout: boolean;
}

/** The only VS Code coupling in the display path. Swapped for the patched sink in Task 15. */
export interface NotificationSink {
  show(view: SponsoredView): Promise<ShowResult>;
}

export interface AssetSource {
  getDataUri(url: string): Promise<string | null>;
}

export interface PresentResult {
  receipts: Receipt[];
  hideRequested: boolean;
}

export interface RendererOptions {
  sink: NotificationSink;
  assets: AssetSource;
  openExternal: (url: string) => Promise<boolean>;
  now?: () => number;
  newId?: () => string;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export class Renderer {
  private readonly sink: NotificationSink;
  private readonly assets: AssetSource;
  private readonly openExternal: (url: string) => Promise<boolean>;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(options: RendererOptions) {
    this.sink = options.sink;
    this.assets = options.assets;
    this.openExternal = options.openExternal;
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? (() => `rcpt_${randomUUID()}`);
  }

  async present(creative: Creative, themeKind: ThemeKind): Promise<PresentResult> {
    const logoUrl = themeKind === 'dark' ? creative.logoDark : creative.logoLight;
    // A missing logo degrades the ad, it does not cancel it.
    const logoDataUri = await this.assets.getDataUri(logoUrl).catch(() => null);

    let result: ShowResult;
    try {
      result = await this.sink.show({
        headline: creative.headline,
        body: creative.body,
        logoDataUri,
      });
    } catch {
      return { receipts: [], hideRequested: false };
    }

    const clientTs = this.now();
    const receipts: Receipt[] = [];

    if (result.focusedThroughout && result.shownMs >= MIN_IMPRESSION_MS) {
      receipts.push({
        receiptId: this.newId(),
        creativeId: creative.creativeId,
        kind: 'impression',
        shownMs: result.shownMs,
        focused: true,
        clientTs,
      });
    }

    if (result.outcome === 'clicked') {
      receipts.push({
        receiptId: this.newId(),
        creativeId: creative.creativeId,
        kind: 'click',
        shownMs: result.shownMs,
        focused: result.focusedThroughout,
        clientTs,
      });
      // Validation already enforced https, but this is the last gate before
      // handing a URL to the operating system. Check it here too.
      if (isHttpsUrl(creative.clickUrl)) {
        await this.openExternal(creative.clickUrl).catch(() => false);
      }
    }

    return { receipts, hideRequested: result.outcome === 'hidden' };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd extensions/adcode-ads && npx vitest run test/renderer.test.ts`
Expected: PASS, all 14 tests.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `cd extensions/adcode-ads && npx tsc -p . --noEmit && npx vitest run`
Expected: `tsc` exits 0; every test from Tasks 1–11 passes.

- [ ] **Step 6: Commit**

```bash
git add extensions/adcode-ads/src/renderer.ts extensions/adcode-ads/test/renderer.test.ts
git commit -m "feat: add renderer with sink abstraction and impression validity rules"
```

---
