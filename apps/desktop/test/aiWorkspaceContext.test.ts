import { describe, expect, it } from "vitest";
import { aiWorkspaceContext } from "../src/main/aiWorkspaceContext.ts";
import { localPreviewUrl } from "../src/renderer/ai/chatPreview.ts";

describe("assistant workspace context", () => {
  it("supplies the selected root and relative file tool instructions", () => {
    const context = aiWorkspaceContext("C:\\Projects\\my app", null);
    expect(context).toContain(JSON.stringify("C:\\Projects\\my app"));
    expect(context).toContain("Do not ask the user for its path");
    expect(context).toContain("propose_edit can create new files");
    expect(context).toContain("open_preview");
  });
  it("reports missing folders and actual file-tool blockers distinctly", () => {
    expect(aiWorkspaceContext(null, null)).toContain("no folder is open");
    const blocked = aiWorkspaceContext("/project", "Save open file changes.");
    expect(blocked).toContain("Save open file changes.");
    expect(blocked).not.toContain("File tools are available");
  });
});

describe("embedded preview URL boundary", () => {
  it.each(["http://localhost:3000/", "http://127.0.0.1:5173/app", "http://[::1]:8000/"])("accepts local server %s", url => {
    expect(localPreviewUrl(url)).toBe(url);
  });
  it.each([null, "javascript:alert(1)", "file:///etc/passwd", "https://example.com", "http://127.0.0.1:3000@evil.example", "http://user:pass@localhost:3000", "http://localhost.evil.example"])("rejects non-preview address %s", url => {
    expect(localPreviewUrl(url)).toBeNull();
  });
});
