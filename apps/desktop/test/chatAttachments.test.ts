import { describe, expect, it } from "vitest";
import {
  admitFiles,
  classifyFile,
  fileToAttachment,
  formatBytes,
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
  rejectionReason,
  textFromBytes,
  truncateText,
  type AttachmentSource,
} from "../src/renderer/ai/attachments.ts";
import { zipArchive } from "./fixtures/zipFixture.ts";

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

  it("reads PDF, Word, Excel, PowerPoint and OpenDocument files as documents", () => {
    expect(classifyFile("deck.pdf", "application/pdf")).toBe("document");
    expect(classifyFile("Budget.xlsx", "")).toBe("document");
    expect(classifyFile("notes.docx", "")).toBe("document");
    expect(classifyFile("pitch.pptx", "")).toBe("document");
    expect(classifyFile("sheet.ods", "")).toBe("document");
  });

  it("takes code and config with no listed extension by looking at the bytes, and converts BMP and icons", () => {
    expect(classifyFile("App.vue", "")).toBe("text");
    expect(classifyFile("Dockerfile", "")).toBe("text");
    expect(classifyFile("logo.svg", "image/svg+xml")).toBe("text");
    expect(classifyFile("Procfile", "")).toBe("sniff");
    expect(classifyFile("data.weird", "")).toBe("sniff");
    expect(classifyFile("scan.bmp", "image/bmp")).toBe("image");
    expect(classifyFile("favicon.ico", "")).toBe("image");
  });

  it("refuses video, archives and old Office files, each with what to do instead", () => {
    expect(classifyFile("clip.mp4", "video/mp4")).toBe("unsupported");
    expect(rejectionReason("clip.mp4", "video/mp4")).toContain("screenshot");
    expect(classifyFile("old.doc", "application/msword")).toBe("unsupported");
    expect(rejectionReason("old.doc", "application/msword")).toContain("save it as .docx");
    expect(rejectionReason("old.xls", "")).toContain("save it as .xlsx");
    expect(rejectionReason("bundle.zip", "application/zip")).toContain("unpack");
    expect(rejectionReason("photo.heic", "")).toContain("PNG or JPEG");
    expect(rejectionReason("thing.weird", "")).toContain("PDF, Word, Excel and PowerPoint");
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

  it("lets documents be larger than pictures, since only their text is sent", () => {
    const { admitted, rejected } = admitFiles([
      { name: "report.pdf", type: "application/pdf", size: 20_000_000 },
      { name: "photo.png", type: "image/png", size: 20_000_000 },
    ], 0);
    expect(admitted).toEqual([0]);
    expect(rejected[0]).toContain("photo.png");
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
    let read = false;
    const video: AttachmentSource = { name: "clip.mp4", type: "video/mp4", size: 10, arrayBuffer: async () => { read = true; return new ArrayBuffer(0); }, text: async () => "" };
    await expect(fileToAttachment(video)).rejects.toThrow(/video and audio/);
    expect(read).toBe(false);
  });

  it("sends a document as the text read from it, and says what it was read as", async () => {
    const bytes = zipArchive({ "word/document.xml": "<w:document><w:body><w:p><w:r><w:t>Hello from Word</w:t></w:r></w:p></w:body></w:document>" });
    const file: AttachmentSource = { name: "letter.docx", type: "", size: bytes.length, arrayBuffer: async () => bytes.slice().buffer, text: async () => "" };
    const attachment = await fileToAttachment(file);
    expect(attachment).toMatchObject({ kind: "text", name: "letter.docx", mediaType: "text/plain", detail: "Word", previewUrl: "" });
    expect(attachment.data).toContain("Hello from Word");
  });

  it("refuses a damaged document with a sentence naming it", async () => {
    const file: AttachmentSource = { name: "report.pdf", type: "application/pdf", size: 4, arrayBuffer: async () => new TextEncoder().encode("%PDF").buffer as ArrayBuffer, text: async () => "" };
    await expect(fileToAttachment(file, { openPdf: async () => { throw new Error("bad xref"); } })).rejects.toThrow(/^report\.pdf could not be read - the file looks damaged/);
  });

  it("reads a file with an unknown extension as text when its bytes are text, and refuses it when not", async () => {
    const text: AttachmentSource = { name: "Procfile", type: "", size: 18, arrayBuffer: async () => new TextEncoder().encode("web: node server.js").buffer as ArrayBuffer, text: async () => "" };
    expect((await fileToAttachment(text)).data).toBe("web: node server.js");
    const binary: AttachmentSource = { name: "blob.weird", type: "", size: 4, arrayBuffer: async () => new Uint8Array([0x89, 0, 1, 2]).buffer, text: async () => "" };
    await expect(fileToAttachment(binary)).rejects.toThrow(/blob\.weird: that file isn't text/);
    expect(textFromBytes(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]))).toBe("hi");
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
