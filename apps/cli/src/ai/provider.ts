import {
  createAnthropicProvider,
  createGoogleProvider,
  createOpenAiCompatibleProvider,
  type ModelTraits,
  type Provider,
} from "../../../../packages/ai/src/index.ts";
import type { CliProvider, ModelSelection } from "./catalogue.ts";
import type { DesktopSnapshot } from "../desktop.ts";
import { apiOrigin } from "../account.ts";
import { resolveProviderKey, type KeyResult } from "../keychain.ts";
import { envNamesFor } from "../keychain.ts";

export interface BuiltProvider {
  readonly provider: Provider;
  readonly selection: ModelSelection;
  readonly keySource: KeyResult["source"] | "included" | "local" | "none";
  readonly model: {
    readonly contextWindow: number;
    readonly maxOutput: number;
    readonly reasoning: boolean;
  };
}

function traitsLookup(provider: CliProvider): (model: string) => ModelTraits | undefined {
  return (model: string) => {
    const found = provider.models.find((one) => one.id === model);
    if (found === undefined) return undefined;
    return {
      reasoning: found.reasoning,
      effortLevels: found.effortLevels,
      maxOutput: found.maxOutput,
    };
  };
}

export async function buildProvider(
  provider: CliProvider,
  selection: ModelSelection,
  options: {
    readonly desktop: DesktopSnapshot;
    readonly token?: () => Promise<string | null>;
    readonly env?: NodeJS.ProcessEnv;
    readonly fetchImpl?: typeof fetch;
  },
): Promise<BuiltProvider> {
  const model = provider.models.find((one) => one.id === selection.modelId) ?? provider.models[0];
  if (model === undefined) throw new Error(`${provider.name} has no models available.`);
  const traits = traitsLookup(provider);
  const common = {
    models: provider.models.map((one) => one.id),
    traits,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  };

  if (provider.id === "tagflow") {
    const baseUrl = `${apiOrigin()}/v1/ai/tagflow`;
    const token = options.token ?? (async () => null);
    const providerInstance = createOpenAiCompatibleProvider({
      id: "tagflow",
      displayName: "Included AI",
      baseUrl,
      apiKey: "",
      ...common,
      fetchImpl: async (input, init) => {
        const credential = await token();
        if (credential === null) {
          throw new Error("Included AI needs a signed-in account. Open ADCode Desktop and sign in, then try again.");
        }
        const headers = new Headers(init?.headers);
        headers.set("authorization", `Bearer ${credential}`);
        headers.set("x-adcode-ai-source", "cli");
        headers.set("x-adcode-platform", process.platform);
        return await fetch(input, { ...init, headers });
      },
    });
    return {
      provider: providerInstance,
      selection: { ...selection, modelId: model.id, modelName: model.name },
      keySource: "included",
      model: { contextWindow: model.contextWindow, maxOutput: model.maxOutput, reasoning: model.reasoning },
    };
  }

  if (provider.id === "ollama") {
    const providerInstance = createOpenAiCompatibleProvider({
      id: "ollama",
      displayName: "Ollama",
      baseUrl: provider.baseUrl ?? "http://127.0.0.1:11434/v1",
      apiKey: "",
      ...common,
    });
    return {
      provider: providerInstance,
      selection: { ...selection, modelId: model.id, modelName: model.name },
      keySource: "local",
      model: { contextWindow: model.contextWindow, maxOutput: model.maxOutput, reasoning: model.reasoning },
    };
  }

  const key = await resolveProviderKey(provider.id, {
    ...(options.env === undefined ? {} : { env: options.env }),
    envNames: [...provider.env, ...envNamesFor(provider.id)],
    allowDesktop: true,
  });
  if (key === null) {
    throw new Error(`${provider.name} needs an API key. ${provider.env[0] ?? `${provider.id.toUpperCase()}_API_KEY`} is not set.`);
  }

  if (provider.id === "anthropic") {
    return {
      provider: createAnthropicProvider({ apiKey: key.key, traits }),
      selection: { ...selection, modelId: model.id, modelName: model.name },
      keySource: key.source,
      model: { contextWindow: model.contextWindow, maxOutput: model.maxOutput, reasoning: model.reasoning },
    };
  }

  if (provider.id === "google") {
    return {
      provider: createGoogleProvider({ apiKey: key.key, traits, ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }) }),
      selection: { ...selection, modelId: model.id, modelName: model.name },
      keySource: key.source,
      model: { contextWindow: model.contextWindow, maxOutput: model.maxOutput, reasoning: model.reasoning },
    };
  }

  const baseUrl = provider.baseUrl ?? (provider.id.startsWith("connection-")
    ? options.desktop.connections.find((connection) => connection.id === provider.id)?.baseUrl ?? null
    : null);
  if (baseUrl === null) throw new Error(`${provider.name} has no API address configured.`);
  return {
    provider: createOpenAiCompatibleProvider({
      id: provider.id,
      displayName: provider.name,
      baseUrl,
      apiKey: key.key,
      ...common,
    }),
    selection: { ...selection, modelId: model.id, modelName: model.name },
    keySource: key.source,
    model: { contextWindow: model.contextWindow, maxOutput: model.maxOutput, reasoning: model.reasoning },
  };
}
