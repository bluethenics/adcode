/**
 * How agents look in the chat, read from Settings > Appearance.
 *
 * The built-in assistant's name and face, whether replies carry who wrote them, and how
 * replies sit on the page. Named agents keep the look their editor gives them; these rows
 * decide the assistant's own and the layout every reply shares.
 *
 * Pure apart from `watchChatAppearance`, which only subscribes to settings.
 */
import { MASCOT_COLORS, MASCOT_SHAPES, type MascotColor, type MascotLook, type MascotShape } from "../agents/mascotStyle.ts";

export const ASSISTANT_NAME_SETTING = "adcode.appearance.assistantName";
export const ASSISTANT_SHAPE_SETTING = "adcode.appearance.assistantShape";
export const ASSISTANT_COLOR_SETTING = "adcode.appearance.assistantColor";
export const AGENT_AVATARS_SETTING = "adcode.appearance.agentAvatars";
export const MESSAGE_STYLE_SETTING = "adcode.appearance.messageStyle";

export const DEFAULT_ASSISTANT_NAME = "Assistant";
export const DEFAULT_ASSISTANT_LOOK: MascotLook = { shape: "circle", color: "blue" };

export type MessageStyle = "document" | "bubbles" | "compact";

export interface ChatAppearance {
  readonly name: string;
  readonly look: MascotLook;
  /** Faces and names above replies, and on the "is writing" line. */
  readonly avatars: boolean;
  readonly style: MessageStyle;
}

/** A name fit to print: trimmed, one line, never empty. */
export function assistantName(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_ASSISTANT_NAME;
  const flat = value.replace(/\s+/g, " ").trim().slice(0, 40);
  return flat.length === 0 ? DEFAULT_ASSISTANT_NAME : flat;
}

export function chatAppearanceFrom(values: Readonly<Record<string, unknown>>): ChatAppearance {
  const shape = values[ASSISTANT_SHAPE_SETTING];
  const color = values[ASSISTANT_COLOR_SETTING];
  const style = values[MESSAGE_STYLE_SETTING];
  return {
    name: assistantName(values[ASSISTANT_NAME_SETTING]),
    look: {
      shape: MASCOT_SHAPES.includes(shape as MascotShape) ? (shape as MascotShape) : DEFAULT_ASSISTANT_LOOK.shape,
      color: MASCOT_COLORS.includes(color as MascotColor) ? (color as MascotColor) : DEFAULT_ASSISTANT_LOOK.color,
    },
    avatars: values[AGENT_AVATARS_SETTING] !== false,
    style: style === "bubbles" || style === "compact" ? style : "document",
  };
}

/** Call `listener` now with the current appearance and again whenever it changes. Returns the unsubscribe. */
export function watchChatAppearance(listener: (appearance: ChatAppearance) => void): () => void {
  const initial = chatAppearanceFrom({});
  let last = JSON.stringify(initial);
  const adopt = (values: Readonly<Record<string, unknown>>): void => {
    const next = chatAppearanceFrom(values);
    const key = JSON.stringify(next);
    if (key === last) return;
    last = key;
    listener(next);
  };
  listener(initial);
  void window.adcode.settings.read().then(adopt, () => undefined);
  return window.adcode.settings.onChanged(adopt);
}
