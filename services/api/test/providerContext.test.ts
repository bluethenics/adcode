import { describe, expect, it, vi } from "vitest";
import { createProviderContextSync, providerContextWindows } from "../src/providerContext.ts";
import { DEFAULT_TAGFLOW_CONFIG } from "../src/tagflowConfig.ts";
import type { TagflowConfig } from "../src/tagflowTypes.ts";

describe("provider context metadata", () => {
  it("reads provider-published windows and rejects guessed, missing and implausible values", () => {
    const parsed = providerContextWindows({ data: [{ id: "a", context_length: 1048576 }, { id: "b", input_modalities: [{ type: "text", supported_inputs: { max_context_length: { value: 524288 } } }] }, { id: "fake 1M" }, { id: "huge", context_length: 999999999 }, { id: "bad", context_length: "1M" }] });
    expect([...parsed]).toEqual([["a",1048576],["b",524288]]);
  });
  it("refreshes exact upstream IDs, preserves access/prices, and caches requests", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ id: "upstream", context_length: 1048576 }] }));
    const sync = createProviderContextSync(fetcher);
    const config: TagflowConfig = { ...DEFAULT_TAGFLOW_CONFIG, baseUrl:"https://api.tagflow-ai.com/v1",models:[{id:"client",upstreamModel:"upstream",name:"Model",contextWindow:262144,maxOutput:4096,inputPrice:1,outputPrice:2,enabled:false}] };
    const next = await sync(config, id => id === "tagflow" ? "secret" : "", 100);
    expect(next.models[0]).toEqual({...config.models[0],contextWindow:1048576});
    expect(next.maxInputTokens).toBe(1048576);
    expect(config.models[0]?.contextWindow).toBe(262144);
    await sync(config,id=>id==="tagflow"?"secret":"",200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });
  it("retains saved limits on missing metadata or a provider failure", async () => {
    const sync=createProviderContextSync(vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")));
    const config={...DEFAULT_TAGFLOW_CONFIG,baseUrl:"https://api.tagflow-ai.com/v1"};
    expect((await sync(config,id=>id==="tagflow"?"key":"",0)).models).toEqual(config.models);
  });
});
