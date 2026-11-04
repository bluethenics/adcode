import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FrequencyPreset } from "../../../packages/ads/src/types.ts";
import { cliPaths, ensureDir } from "./util/paths.ts";

/**
 * The CLI's own settings, deliberately separate from the desktop app's.
 *
 * A terminal session may want a different theme, motion preference or model than the
 * editor window. The things that must be shared - identity, provider keys, ad account -
 * are read from the desktop's data directory rather than copied into this one.
 */

export interface ModelChoiceConfig {
  readonly provider: string;
  readonly model: string;
}

export interface CliConfig {
  readonly version: 1;
  readonly theme: string;
  readonly motion: boolean;
  readonly unicode: boolean;
  /** `null` follows the desktop selection, including later changes to it. */
  readonly model: ModelChoiceConfig | null;
  readonly ads: {
    readonly enabled: boolean;
    readonly preset: FrequencyPreset;
  };
}

export const DEFAULT_CONFIG: CliConfig = {
  version: 1,
  theme: "midnight",
  motion: true,
  unicode: true,
  model: null,
  ads: { enabled: true, preset: "standard" },
};

const PRESETS: readonly FrequencyPreset[] = ["off", "light", "standard", "max"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function parseConfig(raw: unknown): CliConfig {
  if (!isRecord(raw)) return DEFAULT_CONFIG;
  const ads = isRecord(raw["ads"]) ? raw["ads"] : {};
  const preset = str(ads["preset"]);
  const modelRaw = isRecord(raw["model"]) ? raw["model"] : null;
  const provider = modelRaw === null ? null : str(modelRaw["provider"]);
  const model = modelRaw === null ? null : str(modelRaw["model"]);
  return {
    version: 1,
    theme: str(raw["theme"]) ?? DEFAULT_CONFIG.theme,
    motion: typeof raw["motion"] === "boolean" ? raw["motion"] : DEFAULT_CONFIG.motion,
    unicode: typeof raw["unicode"] === "boolean" ? raw["unicode"] : DEFAULT_CONFIG.unicode,
    model: provider === null || model === null ? null : { provider, model },
    ads: {
      enabled: typeof ads["enabled"] === "boolean" ? ads["enabled"] : DEFAULT_CONFIG.ads.enabled,
      preset: preset !== null && (PRESETS as readonly string[]).includes(preset) ? (preset as FrequencyPreset) : DEFAULT_CONFIG.ads.preset,
    },
  };
}

export function configExists(): boolean {
  return existsSync(cliPaths.config());
}

export function loadConfig(): CliConfig {
  try {
    return parseConfig(JSON.parse(readFileSync(cliPaths.config(), "utf8")) as unknown);
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: CliConfig): void {
  const file = cliPaths.config();
  ensureDir(dirname(file));
  const temporary = join(dirname(file), `config.${process.pid}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  renameSync(temporary, file);
}

export function updateConfig(update: (current: CliConfig) => CliConfig): CliConfig {
  const next = update(loadConfig());
  saveConfig(next);
  return next;
}

export function setModelChoice(choice: ModelChoiceConfig | null): CliConfig {
  return updateConfig((current) => ({ ...current, model: choice }));
}

export function setTheme(theme: string): CliConfig {
  return updateConfig((current) => ({ ...current, theme }));
}

export function setAds(patch: Partial<CliConfig["ads"]>): CliConfig {
  return updateConfig((current) => ({
    ...current,
    ads: {
      enabled: patch.enabled ?? current.ads.enabled,
      preset: patch.preset ?? current.ads.preset,
    },
  }));
}
