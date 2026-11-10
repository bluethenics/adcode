/**
 * A conversation as a file: Markdown for people, JSON for anything that wants to read it back.
 *
 * Only what was said. Tool traces, file contents the assistant read and attachments are not
 * in a conversation's text, so they are not in the export either - which also means an export
 * is safe to paste somewhere without first checking what a tool happened to print.
 */
export type ExportFormat = "markdown" | "json";
export type ExportMessage = readonly ["user" | "assistant", string];

/** A file name from a title: readable, and safe on Windows, macOS and Linux. */
export function exportFileName(title: string, format: ExportFormat, when: Date): string {
  const stem = title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase().slice(0, 60).replace(/-+$/, "");
  const date = when.toISOString().slice(0, 10);
  return `${stem === "" ? "conversation" : stem}-${date}.${format === "json" ? "json" : "md"}`;
}

export function exportConversationText(title: string, messages: readonly ExportMessage[], format: ExportFormat, when: Date): { readonly text: string; readonly fileName: string } {
  const fileName = exportFileName(title, format, when);
  if (format === "json") {
    const body = { format: "adcode-conversation", version: 1, title, exportedAt: when.toISOString(), messages: messages.map(([role, text]) => ({ role, text })) };
    return { fileName, text: `${JSON.stringify(body, null, 2)}\n` };
  }
  const lines = [`# ${title}`, `_Exported from ADCode on ${when.toISOString().slice(0, 10)}_`];
  for (const [role, text] of messages) lines.push(`## ${role === "user" ? "You" : "ADCode"}\n\n${text.trim()}`);
  return { fileName, text: `${lines.join("\n\n")}\n` };
}
