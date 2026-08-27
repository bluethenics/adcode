/**
 * Startup, the tick, and the IDE adapters. Thin, by design (brief §8).
 *
 * This is the only file that holds real collaborators, and therefore the only file that
 * can let one of their failures escape. §9's governing rule: "the ad client may fail in
 * any way. The worst permitted outcome is that the user sees no ad. No ad-side failure
 * may ever degrade editing, startup, or the terminal."
 *
 * So every public method is wrapped in `contain`, and every read of an IDE signal is
 * defended. A thrown exception from any collaborator costs an ad, never a keystroke.
 */
import { decide, tightenCaps } from "./scheduler.ts";
import {
  DEFAULT_PRESET,
  PREFETCH_TARGET,
  PRESETS,
  SETTLE_MS,
  type AssetError,
  type Balance,
  type ClientError,
  type Clock,
  type Creative,
  type FrequencyCaps,
  type FrequencyPreset,
  type IdeSignals,
  type Receipt,
  type RemoteConfig,
  type Result,
  type ServeRequest,
  type SuppressReason,
  type ThemeKind,
  type TokenProvider,
} from "./types.ts";
import { tag } from "./tagger.ts";
import type { ReceiptQueue } from "./receiptQueue.ts";
import type { AdRenderer } from "./renderer.ts";

export interface AdServiceSettings {
  readonly adsEnabled: boolean;
  readonly preset: FrequencyPreset;
  /**
   * Launch grace period, defaulting to §1's 60s.
   *
   * Local only, and deliberately not part of `RemoteConfig`: the settle period exists to
   * protect the user's first minute, so a server that could shorten it would be able to
   * do the one thing §1 says a compromised server must never do - make the IDE more
   * annoying than it ships. Overridden only by tests and by development runs.
   */
  readonly settleMs?: number;
}

export interface AdServiceDeps {
  readonly clock: Clock;
  readonly ide: IdeSignals;
  readonly queue: ReceiptQueue;
  readonly renderer: AdRenderer;
  readonly tokens: TokenProvider;
  readonly settings: AdServiceSettings;
  readonly client: {
    serve(request: ServeRequest): Promise<Result<Creative[], ClientError>>;
    postReceipts(receipts: readonly Receipt[]): Promise<Result<string[], ClientError>>;
    balance(): Promise<Result<Balance, ClientError>>;
    config(): Promise<Result<RemoteConfig, ClientError>>;
  };
  readonly assets: {
    get(url: string): Promise<Result<Uint8Array, AssetError>>;
    has(url: string): Promise<boolean>;
  };
}

export interface AdService {
  start(): Promise<void>;
  tick(): Promise<void>;
  flushReceipts(): Promise<void>;
  stop(): void;
  onPainted(): void;
  onFocusChange(focused: boolean): void;
  onThemeChange(theme: ThemeKind): void;
  dismiss(): void;
  click(): string | null;
  /** Why the last tick did not show. `null` if it did. */
  lastReason(): SuppressReason | null;
  effectiveCaps(): FrequencyCaps;
  balance(): Balance | null;
  config(): RemoteConfig | null;
}

const DAY_MS = 86_400_000;

/** Run something whose failure must never reach the caller. */
async function contain(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch {
    // Deliberately swallowed. See §9: an ad-side failure costs an ad, nothing else.
  }
}

/** Read an IDE signal that may be a dead IPC channel. */
function signal<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

export function createAdService(deps: AdServiceDeps): AdService {
  const launchedAt = deps.clock.now();

  let remote: RemoteConfig | null = null;
  let cachedBalance: Balance | null = null;
  let inventory: Creative[] = [];
  let impressions: number[] = [];
  let lastReason: SuppressReason | null = null;
  let stopped = false;

  function localCaps(): FrequencyCaps {
    return PRESETS[deps.settings.preset] ?? PRESETS[DEFAULT_PRESET];
  }

  function effectiveCaps(): FrequencyCaps {
    // §1: remote config may only tighten. `tightenCaps` discards anything hostile, so
    // a compromised server cannot widen these however it answers.
    return remote === null ? localCaps() : tightenCaps(localCaps(), remote.caps);
  }

  function impressionsToday(now: number): number {
    const today = Math.floor(now / DAY_MS);
    return impressions.filter((t) => Math.floor(t / DAY_MS) === today).length;
  }

  async function refreshConfig(): Promise<void> {
    const result = await deps.client.config();
    if (result.ok) remote = result.value;
  }

  async function refreshBalance(): Promise<void> {
    const result = await deps.client.balance();
    if (result.ok) cachedBalance = result.value;
  }

  async function prefetch(): Promise<void> {
    if (inventory.length > 0) return;

    // §1 and §8.2: only vocabulary tags leave the machine, and the tagger sees
    // basenames rather than paths.
    const tags = tag({
      languageIds: signal(() => deps.ide.languageIds(), []),
      filenames: signal(() => deps.ide.filenames(), []),
    });

    const result = await deps.client.serve({
      tags,
      themeKind: signal(() => deps.ide.themeKind(), "dark"),
      count: PREFETCH_TARGET,
    });

    if (result.ok) inventory = [...result.value];
  }

  async function flushReceipts(): Promise<void> {
    const pending = await deps.queue.all();
    if (pending.length === 0) return;

    const result = await deps.client.postReceipts(pending);
    if (result.ok) await deps.queue.ack(result.value);
  }

  return {
    async start(): Promise<void> {
      await contain(async () => {
        await deps.queue.load();
      });
      // Never on the critical path to first paint (§9): these are awaited here only
      // because `start` is itself called off the startup path.
      await contain(refreshConfig);
      await contain(refreshBalance);
      await contain(prefetch);
      await contain(flushReceipts);
    },

    async tick(): Promise<void> {
      if (stopped) return;

      await contain(async () => {
        const now = deps.clock.now();

        await contain(prefetch);
        await contain(flushReceipts);

        const decision = decide({
          now,
          adsEnabled: deps.settings.adsEnabled,
          killSwitch: remote?.killSwitch ?? false,
          preset: deps.settings.preset,
          caps: effectiveCaps(),
          launchedAt,
          settleMs: deps.settings.settleMs ?? SETTLE_MS,
          windowFocused: signal(() => deps.ide.windowFocused(), false),
          debugActive: signal(() => deps.ide.debugActive(), true),
          doNotDisturb: signal(() => deps.ide.doNotDisturb(), true),
          impressionsToday: impressionsToday(now),
          lastImpressionAt: impressions.at(-1) ?? null,
          creativeAvailable: inventory.length > 0,
          // The card about to be shown is the one at the front of the queue, and it is
          // the only one whose test flag can matter to this decision.
          testCardWaiting: inventory[0]?.test === true,
        });

        if (!decision.show) {
          lastReason = decision.reason;
          return;
        }

        lastReason = null;
        const next = inventory.shift();
        if (next === undefined) return;

        // Warm the asset so the toast never waits on the network to paint.
        await contain(async () => {
          await deps.assets.get(
            signal(() => deps.ide.themeKind(), "dark") === "dark" ? next.logoDark : next.logoLight,
          );
        });

        impressions.push(now);
        deps.renderer.present(next, signal(() => deps.ide.themeKind(), "dark"));
      });
    },

    flushReceipts: () => contain(flushReceipts),

    stop(): void {
      stopped = true;
    },

    onPainted(): void {
      try {
        deps.renderer.onPainted();
      } catch {
        /* contained */
      }
    },

    onFocusChange(focused: boolean): void {
      try {
        deps.renderer.onFocusChange(focused);
      } catch {
        /* contained */
      }
    },

    onThemeChange(theme: ThemeKind): void {
      try {
        deps.renderer.onThemeChange(theme);
      } catch {
        /* contained */
      }
    },

    dismiss(): void {
      try {
        deps.renderer.dismiss();
      } catch {
        /* contained */
      }
    },

    click(): string | null {
      try {
        return deps.renderer.click();
      } catch {
        return null;
      }
    },

    lastReason: () => lastReason,
    effectiveCaps,
    balance: () => cachedBalance,
    config: () => remote,
  };
}
