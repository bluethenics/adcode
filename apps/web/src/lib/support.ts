export type SupportKind = "bug" | "feature" | "help" | "other";

export interface SupportFormValues {
  kind: SupportKind;
  subject: string;
  message: string;
  reference: string;
  platform: string;
}

export interface SupportRequest {
  kind: SupportKind;
  title: string;
  body: string;
  appVersion: string;
  platform: string;
}

const LIMITS = { subject: 120, message: 4000, platform: 40 } as const;

export function buildSupportRequest(values: SupportFormValues): SupportRequest {
  const title = values.subject.trim();
  const message = values.message.trim();
  const reference = values.reference.trim();
  const platform = values.platform.trim().slice(0, LIMITS.platform) || "web";
  const body = reference.length > 0 ? `Reference: ${reference}\n\n${message}` : message;

  if (title.length === 0 || title.length > LIMITS.subject) throw new Error("subject must be between 1 and 120 characters");
  if (message.length === 0 || body.length > LIMITS.message) throw new Error("message must be between 1 and 4000 characters including its reference");

  return { kind: values.kind, title, body, appVersion: "website", platform };
}
