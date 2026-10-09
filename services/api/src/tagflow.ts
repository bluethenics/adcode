/**
 * Tag Flow AI, relayed: the model every new ADCode user can use without a key.
 *
 * Asked for: Tag Flow's models "already connected" on Sinan's key, so somebody who installs
 * ADCode can use the AI straight away. ADCode is open source and its installer can be
 * unpacked, so a key shipped inside it would be anybody's key. It lives here instead, as the
 * worker's `TAGFLOW_API_KEY`, and this module adds it to requests the editor sends.
 *
 * What it guarantees:
 *
 * - Every request belongs to a verified account (the anonymous one every install has), and
 *   has already passed the per-account rate limit - the router calls this after both.
 * - The admin panel's settings decide whether Tag Flow is offered and how many requests one
 *   account may make per window. Over the limit the answer is a 429 that says when the window
 *   resets, which is what lets the app wait and continue on its own.
 * - The reply streams back as Tag Flow sends it. Nothing about a prompt or a reply is kept.
 * - The key never leaves: not in a response, not in an error.
 *
 * Transport-neutral: it returns a description of the reply and `server.ts` writes it.
 */
import { EMPTY_MODEL_CATALOG, tagflowSettingsOf } from "./modelCatalog.ts";
import type { Clock, Store } from "./store.ts";

/** Where the key, the address and `fetch` come from. Tests inject all three. */
export interface TagflowOptions {
  readonly apiKey?: () => string | undefined;
  readonly baseUrl?: () => string;
  readonly fetch?: typeof fetch;
}

export const TAGFLOW_UPSTREAM = "https://api.tagflow-ai.com/v1";

/** Screenshots ride along as base64, so a request can be far larger than other API bodies. */
export const TAGFLOW_MAX_BODY_BYTES = 8_000_000;

const MODELS_TTL_MS = 600_000;
const HOUR_MS = 3_600_000;
const UNAVAILABLE = "Tag Flow AI is unavailable right now. Connect another model in AI › Connect a model.";

export interface TagflowModel {
  readonly id: string;
  readonly name: string;
}

/** The model Tag Flow serves today, for when its list cannot be read. */
export const FALLBACK_TAGFLOW_MODELS: readonly TagflowModel[] = [{ id: "tagflow-code-27b", name: "Tag Flow Code 27B" }];

export type TagflowReply =
  | { readonly kind: "json"; readonly status: number; readonly body: unknown; readonly headers?: Record<string, string> }
  | { readonly kind: "stream"; readonly status: number; readonly headers: Record<string, string>; readonly body: ReadableStream<Uint8Array> };

/** The fixed window `now` falls in: windows are `windowHours` long and aligned to the UTC epoch. */
export function windowFor(now: number, windowHours: number): { start: number; resetsAt: number } {
  const length = windowHours * HOUR_MS;
  const start = Math.floor(now / length) * length;
  return { start, resetsAt: start + length };
}

/** "tagflow-code-27b" -> "Tag Flow Code 27B": a name a person reads, made from the id. */
export function modelName(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter((word) => word.length > 0)
    .map((word) => {
      if (word.toLowerCase() === "tagflow") return "Tag Flow";
      if (/^\d+(?:\.\d+)?[a-z]$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/** Tag Flow's canonical models from its gateway's index, or null when it says something else. */
export function canonicalModels(index: unknown): TagflowModel[] | null {
  if (typeof index !== "object" || index === null) return null;
  const models = (index as Record<string, unknown>)["models"];
  if (!Array.isArray(models)) return null;
  const ids = models.filter((one): one is string => typeof one === "string" && /^[\w.:/-]{1,120}$/.test(one));
  return ids.length === 0 ? null : ids.map((id) => ({ id, name: modelName(id) }));
}

const json = (status: number, body: unknown, headers?: Record<string, string>): TagflowReply =>
  headers === undefined ? { kind: "json", status, body } : { kind: "json", status, body, headers };

const failure = (status: number, code: string, message: string): TagflowReply =>
  json(status, { error: { message, type: "relay_error", code } });

export interface TagflowRelay {
  /** POST /v1/ai/tagflow/chat/completions, for `uid`, with the raw request body. */
  chat(uid: string, body: string): Promise<TagflowReply>;
  /** GET /v1/ai/tagflow/models. */
  models(): Promise<TagflowReply>;
}

export function createTagflowRelay(deps: {
  readonly store: Pick<Store, "bumpRequestCount" | "getModelCatalog">;
  readonly clock: Clock;
  readonly options?: TagflowOptions;
}): TagflowRelay {
  const apiKey = deps.options?.apiKey ?? (() => process.env["TAGFLOW_API_KEY"]);
  const baseUrl = deps.options?.baseUrl ?? (() => process.env["TAGFLOW_BASE_URL"] ?? TAGFLOW_UPSTREAM);
  const doFetch = deps.options?.fetch ?? ((input, init) => fetch(input, init));
  let modelCache: { at: number; models: readonly TagflowModel[] } | null = null;

  const settings = async () => tagflowSettingsOf((await deps.store.getModelCatalog())?.overrides ?? EMPTY_MODEL_CATALOG);

  /** Anything Tag Flow says, with the key cut out in case it was repeated back. */
  const scrub = (text: string, key: string): string => (key.length > 0 ? text.split(key).join("[redacted]") : text);

  return {
    async chat(uid, body) {
      const config = await settings();
      const key = apiKey()?.trim() ?? "";
      if (!config.enabled || key.length === 0) return failure(503, "tagflow_unavailable", UNAVAILABLE);

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return failure(400, "malformed_body", "The request is not JSON.");
      }
      const request = parsed as Record<string, unknown> | null;
      if (typeof request !== "object" || request === null || typeof request["model"] !== "string" || !Array.isArray(request["messages"])) {
        return failure(400, "malformed_body", "A chat request needs a model and a list of messages.");
      }

      if (config.requestLimit > 0) {
        const now = deps.clock.now();
        const { start, resetsAt } = windowFor(now, config.windowHours);
        const count = await deps.store.bumpRequestCount(`tagflow:${uid}`, start);
        if (count > config.requestLimit) {
          return json(
            429,
            {
              error: {
                message: `You've used this window's Tag Flow AI requests. It resets at ${new Date(resetsAt).toISOString()}.`,
                type: "usage_limit",
                code: "tagflow_usage_limit",
                resets_at: resetsAt,
                auto_continue: config.autoContinue,
              },
            },
            { "retry-after": String(Math.max(1, Math.ceil((resetsAt - now) / 1000))) },
          );
        }
      }

      let upstream: Response;
      try {
        upstream = await doFetch(`${baseUrl().replace(/\/+$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body,
        });
      } catch {
        return failure(502, "tagflow_unreachable", "Tag Flow AI could not be reached. Try again in a moment.");
      }

      // The worker's key refused: nothing the person in the editor can fix.
      if (upstream.status === 401 || upstream.status === 403) {
        await upstream.body?.cancel().catch(() => undefined);
        return failure(503, "tagflow_unavailable", UNAVAILABLE);
      }

      if (!upstream.ok || upstream.body === null) {
        const text = scrub((await upstream.text().catch(() => "")).slice(0, 64_000), key);
        const retryAfter = upstream.headers.get("retry-after");
        return json(upstream.status, safeJson(text), retryAfter === null ? undefined : { "retry-after": retryAfter });
      }

      return {
        kind: "stream",
        status: upstream.status,
        headers: {
          "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
          "cache-control": "no-store",
        },
        body: upstream.body,
      };
    },

    async models() {
      const now = deps.clock.now();
      if (modelCache === null || now - modelCache.at > MODELS_TTL_MS) {
        let models: readonly TagflowModel[] | null = null;
        try {
          const response = await doFetch(new URL("/", baseUrl()).href, { method: "GET" });
          if (response.ok) models = canonicalModels(await response.json());
        } catch {
          // Unreachable: the model it is known to serve, and another look in a minute.
        }
        modelCache = models === null
          ? { at: now - MODELS_TTL_MS + 60_000, models: FALLBACK_TAGFLOW_MODELS }
          : { at: now, models };
      }
      return json(200, { models: modelCache.models }, { "cache-control": "private, max-age=300" });
    },
  };
}

/** Tag Flow's error body as JSON when it is JSON, wrapped when it is not. */
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: { message: text.slice(0, 500) || "Tag Flow AI returned an error.", type: "upstream_error" } };
  }
}
