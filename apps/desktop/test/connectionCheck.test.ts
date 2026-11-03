import { describe, expect, it } from "vitest";
import { explainConnectionFailure } from "../src/shared/connectionCheck.ts";

describe("custom connection failures", () => {
  it("names the address and the missing /v1 when the endpoint cannot be reached", () => {
    const text = explainConnectionFailure("fetch failed", "https://integrate.api.nvidia.com");
    expect(text).toContain("could not reach https://integrate.api.nvidia.com");
    expect(text).toContain("need /v1 at the end");
    expect(explainConnectionFailure("fetch failed", "https://integrate.api.nvidia.com/v1")).not.toContain("/v1 at the end");
  });
  it("points at the model name when the provider refuses the request", () => {
    expect(explainConnectionFailure("custom returned HTTP 400: upstream request failed", "https://api.example.com/v1")).toContain("The model name is the usual cause");
  });
  it("points at the key for an authentication refusal, and keeps unknown errors as they are", () => {
    expect(explainConnectionFailure("HTTP 401: Unauthorized", null)).toContain("did not accept this key");
    expect(explainConnectionFailure("Something unusual", null)).toBe("Something unusual");
  });
});
