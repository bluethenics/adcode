import {
  createAdClient,
  createAdRenderer,
  createAdService,
  createAssetCache,
  createReceiptQueue,
  formatMicros,
  type AdService,
  type AdRenderer,
  type Balance,
  type ClientError,
  type FrequencyPreset,
  type NotificationSink,
  type Receipt,
  type RemoteConfig,
  type Result,
  type ThemeKind,
} from "../../../../packages/ads/src/index.ts";
import { apiBaseUrl, apiOrigin, assetHostFor, type Account } from "../account.ts";
import { cliDataDir } from "../util/paths.ts";
import { DiskFileStore } from "../platform/fsStore.ts";
import { FetchHttpTransport } from "../platform/http.ts";

/**
 * The real ad client, wired for a terminal.
 *
 * The same scheduler, renderer, receipts and server as the desktop app. The terminal only
 * supplies the two things the ad package deliberately leaves to its host: a way to paint
 * a notification, and the truth about whether this terminal currently has focus.
 */

export interface TerminalAdOptions {
  readonly account: Account;
  readonly sink: NotificationSink;
  readonly adsEnabled: boolean;
  readonly preset: FrequencyPreset;
  readonly themeKind?: ThemeKind;
  readonly settleMs?: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly focused?: boolean;
  readonly languageIds?: readonly string[];
  readonly filenames?: readonly string[];
  readonly onReceipt?: (receipt: Receipt) => void;
}

export interface TerminalAdRuntime {
  readonly service: AdService;
  readonly renderer: AdRenderer;
  readonly store: DiskFileStore;
  start(): Promise<void>;
  tick(): Promise<void>;
  shutdown(): Promise<void>;
  onPainted(): void;
  onFocusChange(focused: boolean): void;
  onThemeChange(theme: ThemeKind): void;
  dismiss(): void;
  click(): string | null;
  setEnabled(enabled: boolean): void;
  setPreset(preset: FrequencyPreset): void;
  refreshBalance(): Promise<Result<Balance, ClientError>>;
  config(): Promise<Result<RemoteConfig, ClientError>>;
  pendingReceipts(): Promise<number>;
  lastReason(): string | null;
  cachedBalance(): Balance | null;
  effectiveCaps(): { readonly minIntervalMs: number; readonly dailyCap: number };
}

function envMs(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function createTerminalAdRuntime(options: TerminalAdOptions): TerminalAdRuntime {
  const env = options.env ?? process.env;
  const clock = { now: (): number => Date.now() };
  const store = new DiskFileStore(cliDataDir(env));
  const devServer = env["ADCODE_AD_SERVER"];
  const assetHost = assetHostFor(env);
  const rewrites: Array<readonly [string, string]> = devServer === undefined
    ? []
    : [[`https://${assetHost}/assets`, `${devServer}/assets`]];
  const http = new FetchHttpTransport(rewrites);
  const client = createAdClient({
    http,
    tokens: options.account.tokens,
    clock,
    baseUrl: apiBaseUrl(env),
    assetHost,
  });
  const assets = createAssetCache({ http, store, clock, allowedHost: assetHost });
  const queue = createReceiptQueue({ store });

  let focused = options.focused ?? true;
  let themeKind: ThemeKind = options.themeKind ?? "dark";
  let enabled = options.adsEnabled;
  let preset = options.preset;
  let languageIds = [...(options.languageIds ?? [])];
  let filenames = [...(options.filenames ?? [])];

  const settings = {
    get adsEnabled(): boolean {
      return enabled;
    },
    get preset(): FrequencyPreset {
      return preset;
    },
    get settleMs(): number {
      return options.settleMs ?? envMs(env["ADCODE_SETTLE_MS"], 60_000);
    },
  };

  const renderer = createAdRenderer({
    sink: options.sink,
    clock,
    onReceipt: (receipt) => {
      void queue.enqueue(receipt).then(() => {
        options.onReceipt?.(receipt);
      }).catch(() => {
        // A lost receipt costs an earning, never the session.
      });
    },
    isSuppressed: () => !enabled,
  });

  const service = createAdService({
    clock,
    ide: {
      windowFocused: () => focused,
      debugActive: () => false,
      doNotDisturb: () => false,
      themeKind: () => themeKind,
      languageIds: () => languageIds,
      filenames: () => filenames,
      newcomer: () => false,
    },
    queue,
    renderer,
    tokens: options.account.tokens,
    settings,
    client,
    assets,
  });

  return {
    service,
    renderer,
    store,
    start: () => service.start(),
    tick: () => service.tick(),
    async shutdown(): Promise<void> {
      service.stop();
      // Receipts already survive on disk; the next launch flushes them. Waiting here
      // would make quitting a network operation.
      http.abort();
    },
    onPainted: () => service.onPainted(),
    onFocusChange(next: boolean): void {
      focused = next;
      service.onFocusChange(next);
    },
    onThemeChange(next: ThemeKind): void {
      themeKind = next;
      service.onThemeChange(next);
    },
    dismiss: () => service.dismiss(),
    click: () => service.click(),
    setEnabled(next: boolean): void {
      enabled = next;
      if (!next) service.dismiss();
    },
    setPreset(next: FrequencyPreset): void {
      preset = next;
    },
    refreshBalance: () => client.balance(),
    config: () => client.config(),
    pendingReceipts: () => queue.size(),
    lastReason: () => service.lastReason(),
    cachedBalance: () => service.balance(),
    effectiveCaps: () => service.effectiveCaps(),
  };
}

export function balanceLabel(balance: Balance | null): string {
  return balance === null ? "—" : formatMicros(balance.availableMicros);
}

export function adOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return apiOrigin(env);
}
