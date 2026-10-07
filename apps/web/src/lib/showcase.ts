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

/*
 * Vibe, mid-build: the prompt, the finished plan and the game it made, running in the live
 * preview. Captured from the real app (a scripted local model calling the real tools), so
 * the picture under "Describe your idea and watch it get built" is that sentence happening.
 * The old shots showed the code editor and an earnings panel - true, but not the promise.
 */
const light: ShowcaseImage = { src: "/images/vibe-light.webp", width: 1920, height: 1200 };
const dark: ShowcaseImage = { src: "/images/vibe-dark.webp", width: 1920, height: 1200 };

export const showcase: { light: ShowcaseImage | null; dark: ShowcaseImage | null; alt: string } = {
  light,
  dark,
  alt: "ADCode in Vibe: a request for a snake game, the three-step plan it finished, and the game running in the live preview",
};
