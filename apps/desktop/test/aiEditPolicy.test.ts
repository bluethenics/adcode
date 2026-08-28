import { describe, expect, it } from "vitest";
import { requiresTrustedEditConfirmation } from "../src/main/aiEditPolicy.ts";

describe("trusted edit policy confirmation", () => {
  it("requires native confirmation only when entering trusted mode", () => {
    expect(requiresTrustedEditConfirmation("adcode.ai.editPolicy", "trusted", "review")).toBe(true);
    expect(requiresTrustedEditConfirmation("adcode.ai.editPolicy", "trusted", "trusted")).toBe(false);
    expect(requiresTrustedEditConfirmation("adcode.ai.editPolicy", "review", "trusted")).toBe(false);
    expect(requiresTrustedEditConfirmation("adcode.ai.model", "trusted", "review")).toBe(false);
  });
});
