import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesktopSnapshot } from "../src/desktop.ts";
import type { CliProvider, CliModel, TagflowConfigView } from "../src/ai/catalogue.ts";

/**
 * Fixtures that never touch the real profile or the network.
 *
 * The CLI reads identity, provider keys and the model catalogue from disk. Tests seed a
 * temporary directory the same way a first launch would, so a test can prove selection or
 * rendering without borrowing whatever account happens to be signed in on this machine.
 */

export function tempDir(prefix = "adcode-cli-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeDir(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Windows can hold a file open for a moment. A leftover temp directory is harmless.
  }
}

export function seedTagflow(dataDir: string, options: { defaultModel?: string; models?: Array<{ id: string; name: string }> } = {}): void {
  const models = options.models ?? [
    { id: "test-default", name: "Test Default" },
    { id: "test-fast", name: "Test Fast" },
  ];
  const config: TagflowConfigView = {
    available: true,
    defaultModel: options.defaultModel ?? models[0]?.id ?? "test-default",
    models: models.map((model) => ({
      id: model.id,
      name: model.name,
      providerName: "Test Provider",
      contextWindow: 131_072,
      maxOutput: 4_096,
      creditRate: 1,
      paid: false,
    })),
    requiresVerifiedAccount: false,
    credits: null,
    fetchedAt: 1_700_000_000_000,
  };
  const cache = join(dataDir, "cache");
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, "tagflow.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function fakeDesktop(overrides: Partial<DesktopSnapshot> = {}): DesktopSnapshot {
  return {
    dataDir: "C:\\fixture\\desktop",
    settingsFound: true,
    identityFound: false,
    identity: null,
    settings: {
      provider: "tagflow",
      model: "test-default",
      effort: "auto",
      theme: "system",
      adsEnabled: false,
      adsPreset: "standard",
      customBaseUrl: null,
    },
    keyIds: [],
    connections: [],
    oneDriveTrap: false,
    ...overrides,
  };
}

export function fakeModel(providerId: string, id: string, overrides: Partial<CliModel> = {}): CliModel {
  return {
    providerId,
    providerName: providerId,
    id,
    name: id,
    contextWindow: 131_072,
    maxOutput: 4_096,
    reasoning: false,
    effortLevels: [],
    included: false,
    costNote: "test",
    note: null,
    ...overrides,
  };
}

export function fakeProvider(id: string, models: readonly CliModel[], overrides: Partial<CliProvider> = {}): CliProvider {
  return {
    id,
    name: id,
    models,
    ready: true,
    keySource: "environment",
    env: [`${id.toUpperCase()}_API_KEY`],
    doc: null,
    included: false,
    custom: false,
    note: null,
    baseUrl: `https://${id}.test/v1`,
    ...overrides,
  };
}
