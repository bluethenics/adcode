/**
 * The words on the chat's "working" line while the assistant thinks or writes.
 *
 * A bare "Thinking" for half a minute reads like a hang. A word that changes every few seconds
 * says the turn is alive, and gives the wait some character. Only the two open-ended phases
 * get them: a tool run or a limit pause keeps its plain, specific label, because that one
 * tells the person something real.
 */
export type WorkingPhase = "thinking" | "writing";

const WORDS: Readonly<Record<WorkingPhase, readonly string[]>> = {
  thinking: [
    "Pondering", "Mulling it over", "Vibing", "Connecting the dots", "Tinkering", "Brewing ideas",
    "Noodling", "Scheming", "Puzzling it out", "Sketching a plan", "Cooking", "Daydreaming in code",
    "Untangling", "Reading the room", "Chewing on it",
  ],
  writing: [
    "Making", "Creating", "Crafting", "Writing", "Shaping it", "Putting it together", "Polishing",
    "Spinning it up", "Building", "Wordsmithing",
  ],
};

/** Seconds each word stays before the next. */
export const WORDS_EVERY_S = 3;

/** A starting point, so two chats side by side do not say the same thing in step. */
export function workingWordSeed(): number {
  return Math.floor(Math.random() * 1_000);
}

/** The word for `phase` after `seconds` on it, from `seed`. Never two the same in a row. */
export function workingWord(phase: WorkingPhase, seconds: number, seed: number): string {
  const words = WORDS[phase];
  const step = Math.floor(Math.max(0, seconds) / WORDS_EVERY_S);
  return words[(seed + step) % words.length]!;
}
