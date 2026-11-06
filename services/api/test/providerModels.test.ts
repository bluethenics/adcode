import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { DEFAULT_TAGFLOW_CONFIG } from "../src/tagflowConfig.ts";
import type { TagflowConfig } from "../src/tagflowTypes.ts";
import type { TokenVerifier } from "../src/auth.ts";
import type { WorkerSecrets } from "../src/workerSecrets.ts";
import type { EncryptedAdNetworkKey } from "../src/adNetworkConfig.ts";
import { decryptAdNetworkKey, encryptAdNetworkKey } from "../src/adNetworkCrypto.ts";
import { parseProviderModels, planApproval, submissionKeyId, type ProviderModelStore, type ProviderModelSubmission } from "../src/providerModels.ts";

const form = {
  company: "Acme Inference", contactName: "Ada", email: "Ada@Acme.ai", website: "https://acme.ai", apiBase: "https://api.acme.ai/v1/", apiKey: "sk-acme-0123456789",
  billing: "wallet", models: [{ upstreamModel: "acme-coder-32b", name: "Acme Coder 32B", contextWindow: 131_072, maxOutput: 8192, inputPrice: 0.2, outputPrice: 0.6 }], message: "", url2: "",
};
const config: TagflowConfig = { ...DEFAULT_TAGFLOW_CONFIG, enabled: true, baseUrl: "https://api.tagflow-ai.com/v1", defaultModel: "coder", models: [{ id: "coder", name: "Coder", contextWindow: 65_536, maxOutput: 4096, inputPrice: 0, outputPrice: 0 }] };

describe("provider model submissions", () => {
  it("accepts a complete submission and normalises it", () => {
    const parsed = parseProviderModels(form);
    expect(parsed).toMatchObject({ ok: true, apiKey: "sk-acme-0123456789", value: { email: "ada@acme.ai", apiBase: "https://api.acme.ai/v1", authentication: "bearer", billing: "wallet" } });
  });

  it("names the first problem in words the form can show", () => {
    expect(parseProviderModels({ ...form, apiBase: "http://localhost:8080" })).toMatchObject({ ok: false, error: expect.stringContaining("API base URL") });
    expect(parseProviderModels({ ...form, apiKey: "short" })).toMatchObject({ ok: false, error: expect.stringContaining("API key") });
    expect(parseProviderModels({ ...form, models: [{ ...form.models[0]!, inputPrice: 0 }] })).toMatchObject({ ok: false, error: expect.stringContaining("above zero") });
    expect(parseProviderModels({ ...form, models: [{ ...form.models[0]!, maxOutput: 200_000 }] })).toMatchObject({ ok: false, error: expect.stringContaining("Model 1") });
    expect(parseProviderModels({ ...form, models: [form.models[0], form.models[0]] })).toMatchObject({ ok: false, error: expect.stringContaining("twice") });
    expect(parseProviderModels({ ...form, url2: "filled" })).toMatchObject({ ok: false, bot: true });
    expect(parseProviderModels({ ...form, extra: 1 })).toMatchObject({ ok: false });
  });

  it("plans a new provider with its models offered from today, reusing a registered API address", () => {
    const parsed = parseProviderModels(form);
    if (!parsed.ok) throw new Error(parsed.error);
    const first = planApproval(config, parsed.value, "2026-11-06");
    expect(first).toMatchObject({ ok: true, providerId: "custom-acme-inference", secretName: "INCLUDED_AI_CUSTOM_ACME_INFERENCE_API_KEY", newProvider: true, modelIds: ["acme-inference-acme-coder-32b"] });
    if (!first.ok) return;
    expect(first.config.models.at(-1)).toMatchObject({ provider: "custom-acme-inference", upstreamModel: "acme-coder-32b", billing: "wallet", enabled: true, releaseDate: "2026-11-06" });
    const again = planApproval(first.config, parsed.value, "2026-11-07");
    expect(again).toMatchObject({ ok: true, providerId: "custom-acme-inference", newProvider: false, modelIds: ["acme-inference-acme-coder-32b-2"] });
    if (again.ok) expect(again.config.providers).toHaveLength(1);
  });

  it("refuses a submission the catalogue has no room for", () => {
    const parsed = parseProviderModels(form);
    if (!parsed.ok) throw new Error(parsed.error);
    const full = { ...config, models: Array.from({ length: 100 }, (_, index) => ({ ...config.models[0]!, id: `m${index}` })) };
    expect(planApproval(full, parsed.value, "2026-11-06")).toMatchObject({ ok: false });
  });
});

describe("provider model submission routes", () => {
  const encryptionKey = Buffer.alloc(32, 7).toString("base64");
  const verifier: TokenVerifier = { async verify(token) { return token === "admin" ? { uid: "admin-1", claims: { email: "admin@adcode.test", email_verified: true } } : token === "user" ? { uid: "user", claims: { email: "user@adcode.test", email_verified: true } } : null; } };
  let rows: Map<string, { submission: ProviderModelSubmission; key: EncryptedAdNetworkKey | null }>;
  let written: Map<string, string>;
  let upstream: ReturnType<typeof vi.fn<typeof fetch>>;
  let store: ReturnType<typeof createMemoryStore>;
  let handle: ReturnType<typeof createFetchHandler>;
  const submissions: ProviderModelStore = {
    async add(submission, key) { rows.set(submission.id, { submission, key }); },
    async list() { return [...rows.values()].map((row) => row.submission); },
    async get(id) { return rows.get(id) ?? null; },
    async decide(id, decision) {
      const row = rows.get(id);
      if (row === undefined || row.submission.status !== "pending") return false;
      rows.set(id, { submission: { ...row.submission, ...decision, hasKey: false }, key: null }); return true;
    },
  };
  const secrets: WorkerSecrets = { configured: () => true, async put(name, value) { written.set(name, value); return { ok: true }; }, async remove(name) { written.delete(name); return { ok: true }; } };
  const call = (path: string, token: string | undefined, data?: unknown, origin = "https://adcode.bluethenics.com") => handle(new Request(`https://adcode.bluethenics.com/v1${path}`, {
    method: data === undefined ? "GET" : "POST", headers: { "content-type": "application/json", origin, ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  }));

  beforeEach(async () => {
    vi.stubEnv("AD_NETWORK_ENCRYPTION_KEY", encryptionKey);
    rows = new Map(); written = new Map(); store = createMemoryStore();
    await store.addAdmin({ email: "admin@adcode.test", addedBy: "setup", addedAt: 0 });
    await store.putTagflowConfig({ config, updatedAt: 0, updatedBy: "setup" });
    upstream = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ choices: [{ message: { content: "ok" } }] }));
    handle = createFetchHandler({ store, verifier, siteOrigin: "https://adcode.bluethenics.com", providerModels: submissions, tagflow: { apiKey: "tagflow", fetchImpl: upstream, workerSecrets: secrets, encryptionKeys: () => [encryptionKey] } });
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("stores only an encrypted key, then approval writes it as the provider's secret and offers the models", async () => {
    const sent = await call("/provider-models", undefined, form);
    expect(sent.status).toBe(200);
    const { id } = await sent.json() as { id: string };
    const row = rows.get(id)!;
    expect(JSON.stringify(row)).not.toContain("sk-acme-0123456789");
    expect(row.submission).toMatchObject({ status: "pending", keyHint: "••••6789", hasKey: true });

    expect((await call("/admin/tagflow/submissions", "user")).status).toBe(403);
    const listed = await (await call("/admin/tagflow/submissions", "admin")).json() as { submissions: ProviderModelSubmission[] };
    expect(JSON.stringify(listed)).not.toContain("ciphertext");

    const tested = await (await call("/admin/tagflow/submissions/test", "admin", { id })).json();
    expect(tested).toMatchObject({ ok: true, reply: "ok", model: "acme-coder-32b" });
    expect(upstream.mock.calls[0]![0]).toBe("https://api.acme.ai/v1/chat/completions");
    expect((upstream.mock.calls[0]![1]!.headers as Record<string, string>)["authorization"]).toBe("Bearer sk-acme-0123456789");

    const approved = await call("/admin/tagflow/submissions/decide", "admin", { id, decision: "approve", note: "tested" });
    expect(await approved.json()).toMatchObject({ ok: true, providerId: "custom-acme-inference", keySaved: true });
    expect(written.get("INCLUDED_AI_CUSTOM_ACME_INFERENCE_API_KEY")).toBe("sk-acme-0123456789");
    expect((await store.getTagflowConfig())!.config.models.map((model) => model.id)).toContain("acme-inference-acme-coder-32b");
    expect(rows.get(id)).toMatchObject({ key: null, submission: { status: "approved", providerId: "custom-acme-inference" } });
    expect((await call("/admin/tagflow/submissions/decide", "admin", { id, decision: "decline" })).status).toBe(409);
  });

  it("declines without touching the catalogue or the secrets, and refuses other origins", async () => {
    expect((await call("/provider-models", undefined, form, "https://evil.example")).status).toBe(403);
    const { id } = await (await call("/provider-models", undefined, form)).json() as { id: string };
    expect(await (await call("/admin/tagflow/submissions/decide", "admin", { id, decision: "decline", note: "not now" })).json()).toMatchObject({ status: "declined" });
    expect(written.size).toBe(0);
    expect((await store.getTagflowConfig())!.config.models).toHaveLength(1);
    expect(rows.get(id)!.key).toBeNull();
  });

  it("cannot decrypt a key under another submission's ID", () => {
    const encrypted = encryptAdNetworkKey(submissionKeyId("a"), "secret-value", encryptionKey);
    expect(decryptAdNetworkKey(submissionKeyId("a"), encrypted, [encryptionKey])).toBe("secret-value");
    expect(() => decryptAdNetworkKey(submissionKeyId("b"), encrypted, [encryptionKey])).toThrow();
  });
});
