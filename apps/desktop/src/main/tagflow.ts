/**
 * Reaching Tag Flow AI: through ADCode's own server, signed with this install's account.
 *
 * Tag Flow's key never ships in the app (it is open source; anybody could unpack it). The
 * server relays each request and adds the key there, after checking the bearer is a real
 * account - the anonymous one every install already has for ads. So the "key" this side sends
 * is that account's identity token, fetched fresh for each request because it expires hourly.
 */
import { app } from "electron";
import { join } from "node:path";
import type { TokenProvider } from "@adcode/ads";
import { DiskFileStore, FetchHttpTransport, SystemClock } from "./adPorts.ts";
import { apiBaseUrl, createBackendTokens } from "./backend.ts";

/** Where the relay lives; the OpenAI-compatible client adds `/chat/completions`. */
export function tagflowBaseUrl(): string {
  return `${apiBaseUrl()}/ai/tagflow`;
}

let tokens: TokenProvider | null = null;

/** This install's identity token, for the relay's Authorization header. */
export async function tagflowToken(): Promise<string> {
  tokens ??= createBackendTokens({
    http: new FetchHttpTransport([]),
    clock: new SystemClock(),
    store: new DiskFileStore(join(app.getPath("userData"), "ads")),
  });
  const token = await tokens.getToken();
  if (!token.ok) throw new Error("Tag Flow AI needs ADCode's sign-in, which could not be reached. Check your connection and try again.");
  return token.value;
}

/** The models Tag Flow serves right now, or null when the relay could not say. */
export async function fetchTagflowModels(): Promise<{ id: string; name: string }[] | null> {
  try {
    const response = await fetch(`${tagflowBaseUrl()}/models`, {
      headers: { authorization: `Bearer ${await tagflowToken()}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { models?: unknown };
    if (!Array.isArray(body.models)) return null;
    const models = body.models
      .filter((one): one is { id: string; name: string } =>
        typeof one === "object" && one !== null && typeof (one as { id?: unknown }).id === "string" && typeof (one as { name?: unknown }).name === "string")
      .filter((one) => one.id.length > 0 && one.id.length <= 120 && one.name.length > 0 && one.name.length <= 120)
      .slice(0, 50);
    return models.length === 0 ? null : models;
  } catch {
    // Offline, or the server is older than the relay: the bundled list stands.
    return null;
  }
}
