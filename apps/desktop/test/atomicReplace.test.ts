import { describe, expect, it, vi } from "vitest";
import { atomicReplace } from "../src/main/atomicReplace.ts";

describe("Windows atomic file replacement", () => {
  it("keeps the original file intact while a transient sharing lock clears", async () => {
    const replace = vi.fn().mockRejectedValueOnce({ code: "EPERM" }).mockRejectedValueOnce({ code: "EACCES" }).mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    await atomicReplace("state.json.tmp", "state.json", { replace, wait });
    expect(replace).toHaveBeenCalledTimes(3);
    expect(replace).toHaveBeenLastCalledWith("state.json.tmp", "state.json");
    expect(wait).toHaveBeenCalledTimes(2);
  });
  it("bounds retries and immediately surfaces unrelated errors", async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    const locked = vi.fn().mockRejectedValue({ code: "EPERM" });
    await expect(atomicReplace("a", "b", { replace: locked, wait })).rejects.toMatchObject({ code: "EPERM" });
    expect(locked).toHaveBeenCalledTimes(6);
    const missing = vi.fn().mockRejectedValue({ code: "ENOENT" });
    await expect(atomicReplace("a", "b", { replace: missing, wait })).rejects.toMatchObject({ code: "ENOENT" });
    expect(missing).toHaveBeenCalledTimes(1);
  });
});
