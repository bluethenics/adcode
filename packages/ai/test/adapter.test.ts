import { describe, expect, it } from "vitest";
import { canAdapterAutoContinue, canAdapterReceiveSchedule, type AiAdapterSnapshot } from "@adcode/ai";

const snapshot = (overrides: Partial<AiAdapterSnapshot> = {}): AiAdapterSnapshot => ({
  id: "adapter:test",
  label: "Test adapter",
  kind: "api",
  connected: true,
  promptState: "ready",
  capabilities: { scheduledPrompts: true, cancellation: false, safeContinuation: false },
  ...overrides,
});

describe("external AI adapter capabilities", () => {
  it("schedules only into a connected, ready adapter that declares support", () => {
    expect(canAdapterReceiveSchedule(snapshot())).toBe(true);
    expect(canAdapterReceiveSchedule(snapshot({ connected: false }))).toBe(false);
    expect(canAdapterReceiveSchedule(snapshot({ promptState: "ambiguous" }))).toBe(false);
  });

  it("never guesses continuation capability", () => {
    expect(canAdapterAutoContinue(snapshot())).toBe(false);
    expect(
      canAdapterAutoContinue(
        snapshot({
          promptState: "limited",
          capabilities: { scheduledPrompts: true, cancellation: true, safeContinuation: true },
        }),
      ),
    ).toBe(true);
  });
});
