import type { StaticImageData } from "next/image";
import lightScreenshot from "../../public/images/editor-light.png";
import darkScreenshot from "../../public/images/editor-dark.png";

/** Static imports keep the preview dimensions in sync when screenshots are replaced. */
export const showcase: { light: StaticImageData | null; dark: StaticImageData | null; alt: string } = {
  light: lightScreenshot,
  dark: darkScreenshot,
  alt: "ADCode editor with project files, code, and the earnings panel",
};
