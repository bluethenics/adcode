/**
 * Product screenshots for the landing showcase.
 *
 * Paths, not static imports: importing the PNGs needs the generated
 * `next-env.d.ts` image types, which do not exist on a fresh checkout until
 * Next.js runs - and the typecheck runs before that. Public paths work
 * everywhere with no generated files involved. Update the dimensions below
 * when replacing the screenshots; the frame ratio follows them.
 */
export interface ShowcaseImage {
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

const light: ShowcaseImage = { src: "/images/editor-light.png", width: 1917, height: 1020 };
const dark: ShowcaseImage = { src: "/images/editor-dark.png", width: 1917, height: 1012 };

export const showcase: { light: ShowcaseImage | null; dark: ShowcaseImage | null; alt: string } = {
  light,
  dark,
  alt: "ADCode editor with project files, code, and the earnings panel",
};
