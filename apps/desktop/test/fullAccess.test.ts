import { describe, expect, it } from "vitest";
import { fullAccessApplies, inAgentTurn, isFullAccessOn, runAgentTurn } from "../src/main/fullAccess.ts";

describe("full access scope", () => {
  it("is only present inside an agent turn", () => {
    expect(inAgentTurn()).toBe(false);
    expect(runAgentTurn(() => inAgentTurn())).toBe(true);
    expect(inAgentTurn()).toBe(false);
  });

  it("follows awaits and tool work inside the turn", async () => {
    const seen: boolean[] = [];
    await runAgentTurn(async () => {
      seen.push(inAgentTurn());
      await new Promise((resolve) => setTimeout(resolve, 0));
      seen.push(inAgentTurn());
    });
    expect(seen).toEqual([true, true]);
  });

  it("does not leak into work running beside the turn", async () => {
    let inside = false;
    let outside: boolean | null = null;
    await Promise.all([
      runAgentTurn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        inside = inAgentTurn();
      }),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        outside = inAgentTurn();
      })(),
    ]);
    expect(inside).toBe(true);
    expect(outside).toBe(false);
  });

  it("reads only an explicit boolean true", () => {
    expect(isFullAccessOn({ "adcode.ai.fullAccess": true })).toBe(true);
    expect(isFullAccessOn({})).toBe(false);
    expect(isFullAccessOn({ "adcode.ai.fullAccess": false })).toBe(false);
    expect(isFullAccessOn({ "adcode.ai.fullAccess": "true" })).toBe(false);
    expect(isFullAccessOn({ "adcode.ai.fullAccess": 1 })).toBe(false);
  });

  it("needs both the setting and an agent turn", () => {
    const on = { "adcode.ai.fullAccess": true };
    expect(fullAccessApplies(on, true)).toBe(true);
    expect(fullAccessApplies(on, false)).toBe(false);
    expect(fullAccessApplies({}, true)).toBe(false);
    expect(fullAccessApplies(on)).toBe(false);
  });
});
