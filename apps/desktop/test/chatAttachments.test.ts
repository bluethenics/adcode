import { describe, expect, it } from "vitest";
import {
  admitFiles,
  classifyFile,
  fileToAttachment,
  formatBytes,
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
  rejectionReason,
  truncateText,
  type AttachmentSource,
} from "../src/renderer/ai/attachments.ts";

const fakeText = (name: string, text: string, type = ""): AttachmentSource => ({
  name,
  type,
  size: text.length,
  arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
  text: async () => text,
});

describe("attachment classification", () => {
  it("accepts the four image MIME types", () => {
    for (const mime of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      expect(classifyFile("photo", mime)).toBe("image");
    }
  });

  it("accepts text by MIME or by extension, since the OS often reports neither", () => {
    expect(classifyFile("notes.txt", "text/plain")).toBe("text");
    expect(classifyFile("notes.md", "")).toBe("text");
    expect(classifyFile("data.JSON", "")).toBe("text");
    expect(classifyFile("app.ts", "")).toBe("text");
  });

  it("refuses everything else, with PDFs getting their own explanation", () => {
    expect(classifyFile("deck.pdf", "application/pdf")).toBe("unsupported");
    expect(classifyFile("clip.mp4", "video/mp4")).toBe("unsupported");
    expect(rejectionReason("deck.pdf", "application/pdf")).toContain("PDF");
    expect(rejectionReason("clip.mp4", "video/mp4")).toContain("Images and text documents");
  });
});

describe("admission limits", () => {
  const file = (name: string, size = 100) => ({ name, type: "image/png", size });

  it("caps files per message, counting what is already pending", () => {
    const { admitted, rejected } = admitFiles(
      [file("a.png"), file("b.png"), file("c.png")],
      MAX_ATTACHMENTS - 2,
    );
    expect(admitted).toEqual([0, 1]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toContain(String(MAX_ATTACHMENTS));
  });

  it("refuses oversized files with their size in the message", () => {
    const { admitted, rejected } = admitFiles([file("huge.png", MAX_FILE_BYTES + 1)], 0);
    expect(admitted).toEqual([]);
    expect(rejected[0]).toContain("huge.png");
  });

  it("admits a normal batch without complaint", () => {
    const { admitted, rejected } = admitFiles([file("a.png"), file("b.png")], 0);
    expect(admitted).toEqual([0, 1]);
    expect(rejected).toEqual([]);
  });
});

describe("document text", () => {
  it("reads text files into the IPC shape", async () => {
    const attachment = await fileToAttachment(fakeText("notes.md", "# hello", "text/markdown"));
    expect(attachment.kind).toBe("text");
    expect(attachment.name).toBe("notes.md");
    expect(attachment.data).toBe("# hello");
    expect(attachment.previewUrl).toBe("");
  });

  it("marks the cut when truncating long documents", async () => {
    const attachment = await fileToAttachment(fakeText("big.log", "x".repeat(60_000)));
    expect(attachment.data.length).toBeLessThan(60_000);
    expect(attachment.data).toContain("truncated");
  });

  it("rejects unsupported files before reading bytes", async () => {
    await expect(
      fileToAttachment(fakeText("deck.pdf", "%PDF", "application/pdf")),
    ).rejects.toThrow(/PDF/);
  });
});

describe("byte labels", () => {
  it("formats bytes, kilobytes and megabytes", () => {
    expect(formatBytes(18)).toBe("18 B");
    expect(formatBytes(18 * 1024)).toBe("18 KB");
    expect(formatBytes(2_400_000)).toContain("MB");
  });

  it("keeps truncation honest about where it cut", () => {
    expect(truncateText("short")).toBe("short");
  });
});
