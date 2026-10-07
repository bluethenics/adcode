import { describe, expect, it } from "vitest";
import { installLinkFor, sendInstallLink } from "../src/lib/sendToDesktop";

/**
 * A phone cannot install a desktop editor, so the hero and the bar that follows the reader
 * down the page both offer to send the install link to the reader's computer - through the
 * share sheet where there is one, by copying it where there is not.
 */
describe("sendInstallLink", () => {
  const link = installLinkFor("https://adcode.example");

  it("points at every install option, tagged so the visits it brings are counted", () => {
    expect(link).toBe("https://adcode.example/versions?utm_source=send-to-desktop");
  });

  it("opens the share sheet where the phone has one", async () => {
    const shared: ShareData[] = [];
    const outcome = await sendInstallLink({ share: async (data) => { shared.push(data); } }, link);
    expect(outcome).toBe("shared");
    expect(shared[0]?.url).toBe(link);
  });

  it("copies the link where there is no share sheet", async () => {
    const copied: string[] = [];
    const outcome = await sendInstallLink({ clipboard: { writeText: async (text) => { copied.push(text); } } }, link);
    expect(outcome).toBe("copied");
    expect(copied).toEqual([link]);
  });

  it("treats closing the share sheet as a choice, not a failure", async () => {
    const outcome = await sendInstallLink({ share: async () => { throw new DOMException("Share canceled", "AbortError"); } }, link);
    expect(outcome).toBe("dismissed");
  });

  it("says so when neither works, so the page can offer email instead", async () => {
    expect(await sendInstallLink({ clipboard: { writeText: async () => { throw new Error("blocked"); } } }, link)).toBe("failed");
    expect(await sendInstallLink({}, link)).toBe("failed");
  });
});
