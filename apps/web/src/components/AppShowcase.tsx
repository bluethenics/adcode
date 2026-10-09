import { HeroVideo } from "./HeroVideo";

/**
 * The hero's product shot: a recording of one Vibe turn in the real app, from the request to
 * the game running (`HeroVideo`, filmed by `scripts/record-hero.mjs`). The caption says how it
 * was made, because a scripted model is part of how it was made.
 */
export function AppShowcase() {
  return <figure className="app-showcase" id="product">
    <div className="showcase-stage">
      <HeroVideo />
    </div>
    <figcaption><span>One sentence in. A planned, written and running game out.</span><span>Recorded in ADCode - the model&apos;s replies were scripted for the recording.</span></figcaption>
  </figure>;
}
