/**
 * The hero's recordings.
 *
 * Paths, not static imports: importing media needs the generated `next-env.d.ts` types, which
 * do not exist on a fresh checkout until Next.js runs - and the typecheck runs before that.
 * Public paths work everywhere with no generated files involved.
 */
export interface ShowcaseVideo {
  /** The last frame - the game running - shown before playback and to reduced motion. */
  readonly poster: string;
  readonly webm: string;
  readonly mp4: string;
  readonly width: number;
  readonly height: number;
}

/*
 * Vibe, start to finish: the request typed in, the plan, the code typing into the live window
 * as the model writes it, and the game opening in the live preview and playing itself. Filmed
 * in the real app by `node scripts/record-hero.mjs` (a scripted local model calling the real
 * tools), once per theme, so the moving picture under "Describe your idea and watch it get
 * built" is that sentence happening. Re-record after the Vibe window's look changes.
 */
const take = (theme: "light" | "dark"): ShowcaseVideo => ({
  poster: `/videos/hero-${theme}.webp`,
  webm: `/videos/hero-${theme}.webm`,
  mp4: `/videos/hero-${theme}.mp4`,
  width: 1440,
  height: 900,
});

export const showcase: { light: ShowcaseVideo; dark: ShowcaseVideo; alt: string } = {
  light: take("light"),
  dark: take("dark"),
  alt: "Screen recording of ADCode in Vibe: a request for a snake game is typed in, a three-step plan appears, the code types into a live window as it is written, and the finished game opens in the live preview and plays",
};
