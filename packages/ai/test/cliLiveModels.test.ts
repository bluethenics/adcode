import { describe, expect, it } from "vitest";
import { CLI_AGENTS, CLI_BRIDGE_TOKEN_ENV, cliArgs, cliEnv, codexPageRequest, createCliProvider, mergeCliModels, modelRequest, parseClaudeModels, parseCodexModels, type CliMcpServer, type CliProcess, type CliSpawn } from "../src/cliAgents.ts";
import type { ProviderRequest } from "../src/types.ts";

const spec = (id: string) => CLI_AGENTS.find((agent) => agent.id === id)!;
const bridge: CliMcpServer = { configPath: "C:/Users/me/AppData/adcode/tool-bridge-claude.json", server: "adcode", url: "http://127.0.0.1:4810/mcp", token: "secret-key", openCodeConfig: "C:/Users/me/AppData/adcode/tool-bridge-opencode.json" };

describe("live CLI models", () => {
  it("asks Claude Code with initialize and Codex with the app-server handshake", () => {
    expect(modelRequest("claude-initialize")).toEqual([{ type: "control_request", request_id: "adcode-models", request: { subtype: "initialize" } }]);
    const codex = modelRequest("codex-app-server") as { method?: string; id?: number }[];
    expect(codex.map((line) => line.method)).toEqual(["initialize", "initialized", "model/list"]);
    expect(codexPageRequest(3, "abc")).toEqual({ jsonrpc: "2.0", id: 3, method: "model/list", params: { cursor: "abc" } });
  });

  it("reads Claude Code's models, their names and reasoning levels", () => {
    const models = parseClaudeModels({ type: "control_response", response: { response: { models: [
      { value: "default", displayName: "Default (recommended)", description: "Fable 5.1", supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] },
      { value: "claude-fable-5-1[1m]", resolvedModel: "claude-fable-5-1-1m", displayName: "Fable 1M" },
      { value: "rm -rf /", displayName: "bad" },
      { value: "default", displayName: "duplicate" },
    ] } } });
    expect(models).toEqual([
      { id: "default", name: "Default (recommended)", description: "Fable 5.1", isDefault: true, efforts: ["low", "medium", "high", "xhigh", "max"] },
      { id: "claude-fable-5-1-1m", name: "Fable 1M" },
    ]);
    expect(parseClaudeModels({ type: "assistant" })).toBeNull();
  });

  it("reads Codex's page, skipping hidden models and handshake replies", () => {
    expect(parseCodexModels({ id: 1, result: {} })).toBeNull();
    const page = parseCodexModels({ id: 2, result: { nextCursor: "p2", data: [
      { id: "x", model: "gpt-6-codex", displayName: "GPT-6 Codex", isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }, { reasoningEffort: "NOT A WORD" }] },
      { model: "secret", hidden: true },
    ] } });
    expect(page).toEqual({ next: "p2", models: [{ id: "gpt-6-codex", name: "GPT-6 Codex", isDefault: true, efforts: ["low", "high"] }] });
  });

  it("shows what the CLI reported, and the built-in aliases only when it could not be asked", () => {
    const reported = mergeCliModels(spec("claude"), [{ id: "opus", name: "Opus" }, { id: "default", name: "Default", isDefault: true }]);
    expect(reported[0]?.id).toBe("default");
    expect(reported.map((model) => model.id)).toContain("opus");
    expect(mergeCliModels(spec("claude"), []).length).toBeGreaterThan(0);
  });
});

describe("reasoning level per CLI", () => {
  it("uses each CLI's own flag and drops anything that is not one plain word", () => {
    expect(cliArgs("claude", { model: "default", effort: "xhigh" })).toEqual(expect.arrayContaining(["--effort", "xhigh"]));
    expect(cliArgs("opencode", { model: "openai/gpt-6", effort: "high" })).toEqual(expect.arrayContaining(["--variant", "high"]));
    expect(cliArgs("codex", { model: "gpt-6-codex", effort: "low" })).toEqual(expect.arrayContaining(["-c", "model_reasoning_effort=low"]));
    expect(cliArgs("claude", { model: "default", effort: "high --dangerous" }).join(" ")).not.toContain("--effort");
    expect(cliArgs("claude", { model: "default" }).join(" ")).not.toContain("--effort");
  });

  it("maps the person's choice onto the nearest level this model has", async () => {
    let seen: readonly string[] = [];
    const quiet: CliProcess = { lines: (async function* () { yield "{\"type\":\"result\",\"usage\":{}}"; })(), exit: Promise.resolve(0), stderr: () => "", kill: () => undefined };
    const spawn: CliSpawn = (_command, args) => { seen = args; return quiet; };
    const provider = createCliProvider({ spec: spec("claude"), models: ["default"], modelEfforts: { default: ["low", "medium", "high", "xhigh", "max"] }, spawn, cwd: () => "." });
    const request: ProviderRequest = { model: "default", system: "", tools: [], maxTokens: 1000, effort: "max", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] };
    for await (const _event of provider.stream(request, new AbortController().signal)) { /* drain */ }
    expect(seen).toEqual(expect.arrayContaining(["--effort", "max"]));
  });
});

describe("ADCode's tools for each CLI", () => {
  it("gives Codex the bridge as -c overrides with the key only in the environment", () => {
    const args = cliArgs("codex", { model: "gpt-6-codex", mcp: bridge });
    expect(args).toEqual(expect.arrayContaining(["-c", "mcp_servers.adcode.url=http://127.0.0.1:4810/mcp", "-c", `mcp_servers.adcode.bearer_token_env_var=${CLI_BRIDGE_TOKEN_ENV}`]));
    expect(args.join(" ")).not.toContain("secret-key");
    expect(cliEnv("codex", bridge)).toEqual({ [CLI_BRIDGE_TOKEN_ENV]: "secret-key" });
  });

  it("points OpenCode at its config file and gives Claude Code nothing extra in the environment", () => {
    expect(cliEnv("opencode", bridge)).toEqual({ OPENCODE_CONFIG: bridge.openCodeConfig });
    expect(cliEnv("claude", bridge)).toEqual({});
    expect(cliEnv("opencode", null)).toEqual({});
  });
});
