import { describe, expect, it } from "vitest";
import { shouldShowUsageSignalsNotice, USAGE_SIGNALS_NOTICE } from "../src/renderer/privacy/usageSignalsNotice.ts";

describe("the 2.6.3 usage-signals notice", () => {
  it("is shown once, and only while Help improve ADCode is on", () => {
    expect(shouldShowUsageSignalsNotice({ "adcode.privacy.usageStats": true }, false)).toBe(true);
    expect(shouldShowUsageSignalsNotice({}, false)).toBe(true);
    expect(shouldShowUsageSignalsNotice({ "adcode.privacy.usageStats": false }, false)).toBe(false);
    expect(shouldShowUsageSignalsNotice({ "adcode.privacy.usageStats": true }, true)).toBe(false);
  });

  it("says plainly what changed and what is never sent", () => {
    expect(USAGE_SIGNALS_NOTICE.body).toContain("linked to your account");
    expect(USAGE_SIGNALS_NOTICE.body).toContain("never your code, prompts, files, paths or chats");
    expect(USAGE_SIGNALS_NOTICE.turnOff).toBe("Turn off");
  });
});
