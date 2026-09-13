import type { AiAttachmentView } from "../shared/api.ts";

/**
 * Attachments crossing the assistant boundary, validated like every other input.
 *
 * The renderer is trusted to pick files but not to bound them: a dropped 200MB
 * video renamed to .png must die here, before base64 lands in a provider request
 * or a token reservation. Limits mirror the composer's own, with headroom - the
 * composer is the UX, this is the enforcement.
 */
const MAX_ATTACHMENTS = 5;
const MAX_IMAGE_BASE64 = 15_000_000;
const MAX_TEXT_CHARS = 100_000;
const MAX_NAME = 200;

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function parseAiAttachments(value: unknown): AiAttachmentView[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("AI attachments must be a list");
  if (value.length > MAX_ATTACHMENTS) throw new Error("Too many attachments");

  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("AI attachment must be an object");
    }
    const record = entry as Record<string, unknown>;
    const { name, kind, mediaType, data } = record;
    if (typeof name !== "string" || name.length === 0 || name.length > MAX_NAME) {
      throw new Error("AI attachment name is invalid");
    }
    if (kind !== "image" && kind !== "text") throw new Error("AI attachment kind is invalid");
    if (typeof mediaType !== "string" || mediaType.length === 0 || mediaType.length > 100) {
      throw new Error("AI attachment media type is invalid");
    }
    if (typeof data !== "string" || data.length === 0) {
      throw new Error("AI attachment data is empty");
    }
    if (kind === "image") {
      if (!IMAGE_TYPES.has(mediaType)) throw new Error("AI image type is not supported");
      if (data.length > MAX_IMAGE_BASE64) throw new Error("AI image is too large");
    } else if (data.length > MAX_TEXT_CHARS) {
      throw new Error("AI document text is too large");
    }
    return { name, kind, mediaType, data };
  });
}
