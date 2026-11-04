import { existsSync } from "node:fs";
import type { FrequencyPreset } from "../../../packages/ads/src/types.ts";
import type { Effort } from "../../../packages/ai/src/types.ts";
import { desktopPaths, readJsonFile } from "./util/paths.ts";

/**
 * What the CLI borrows from the desktop app.
 *
 * Identity, provider keys and the person's chosen model already exist there. Re-reading
 * them means signing in to ADCode once, not once per surface, and it means the terminal's
 * earnings and the editor's earnings are the same account.
 */

export interface DesktopSettings {
  readonly provider: string;
  readonly model: string;
  readonly effort: Effort | "auto";
  readonly theme: string;
  readonly adsEnabled: boolean;
  readonly adsPreset: FrequencyPreset;
  readonly customBaseUrl: string | null;
}

export interface DesktopConnection {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly rpm: number | null;
}

export interface DesktopSnapshot {
  readonly dataDir: string;
  readonly settingsFound: boolean;
  readonly identityFound: boolean;
  readonly identity: { readonly uid: string; readonly refreshToken: string } | null;
  readonly settings: DesktopSettings;
  readonly keyIds: readonly string[];
  readonly connections: readonly DesktopConnection[];
  readonly oneDriveTrap: boolean;
}

const PRESETS: readonly FrequencyPreset[] = ["off", "light", "standard", "max"];

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function parseSettings(raw: unknown): DesktopSettings {
  const root = record(raw);
  const values = record(root["values"]);
  const presetRaw = text(values["adcode.ads.frequency"], "standard");
  const effortRaw = text(values["adcode.ai.effort"], "auto");
  const effort: Effort | "auto" =
    effortRaw === "low" || effortRaw === "medium" || effortRaw === "high" || effortRaw === "max" ? effortRaw : "auto";
  return {
    provider: text(values["adcode.ai.provider"], "tagflow"),
    model: text(values["adcode.ai.model"], ""),
    effort,
    theme: text(values["adcode.appearance.theme"], "system"),
    adsEnabled: values["adcode.ads.enabled"] !== false,
    adsPreset: (PRESETS as readonly string[]).includes(presetRaw) ? (presetRaw as FrequencyPreset) : "standard",
    customBaseUrl: typeof values["adcode.ai.customBaseUrl"] === "string" ? values["adcode.ai.customBaseUrl"] : null,
  };
}

export function parseConnections(raw: unknown): DesktopConnection[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const connections: DesktopConnection[] = [];
  for (const item of parsed) {
    const entry = record(item);
    const id = text(entry["id"], "");
    const baseUrl = text(entry["baseUrl"], "");
    if (id.length === 0 || baseUrl.length === 0) continue;
    connections.push({
      id,
      name: text(entry["name"], id),
      model: text(entry["model"], ""),
      baseUrl,
      rpm: typeof entry["rpm"] === "number" ? entry["rpm"] : null,
    });
  }
  return connections;
}

export function desktopTheme(theme: string): string {
  if (theme === "light") return "paper";
  return "midnight";
}

export function readDesktopSnapshot(): DesktopSnapshot {
  const settingsRaw = readJsonFile(desktopPaths.settings());
  const settingsFound = settingsRaw !== null;
  const values = record(record(settingsRaw)["values"]);
  const keyRaw = readJsonFile(desktopPaths.providerKeys());
  const keyIds = Object.keys(record(keyRaw));
  const connections = parseConnections(values["adcode.ai.connections"]);

  let identity: { uid: string; refreshToken: string } | null = null;
  const identityRaw = record(readJsonFile(desktopPaths.identity()));
  if (typeof identityRaw["uid"] === "string" && typeof identityRaw["refreshToken"] === "string") {
    identity = { uid: identityRaw["uid"], refreshToken: identityRaw["refreshToken"] };
  }

  return {
    dataDir: desktopPaths.settings().replace(/[\\/]settings\.json$/, ""),
    settingsFound,
    identityFound: identity !== null,
    identity,
    settings: parseSettings(settingsRaw),
    keyIds,
    connections,
    // A desktop profile in OneDrive can be a stale mirror rather than the live profile.
    oneDriveTrap: desktopPaths.settings().toLowerCase().includes("onedrive"),
  };
}

export function hasDesktopKey(snapshot: DesktopSnapshot, provider: string): boolean {
  return snapshot.keyIds.includes(provider);
}

export function connectionFor(snapshot: DesktopSnapshot, provider: string): DesktopConnection | null {
  return snapshot.connections.find((connection) => connection.id === provider) ?? null;
}

export function settingsFileExists(): boolean {
  return existsSync(desktopPaths.settings());
}
