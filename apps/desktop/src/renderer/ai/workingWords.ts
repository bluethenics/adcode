/**
 * The words on the chat's "working" line while the assistant thinks or writes.
 *
 * A bare "Thinking" for half a minute reads like a hang. A word that changes every few seconds
 * says the turn is alive, and gives the wait some character. Only the two open-ended phases
 * get them: a tool run or a limit pause keeps its plain, specific label, because that one
 * tells the person something real.
 *
 * A hundred of them (sixty for thinking, forty for writing), each worn in one of six colours
 * that shimmer across the word, so a long turn keeps finding something new to say. The order
 * is shuffled per chat, never the same word twice in a row, and a word only comes back once
 * the whole list for its phase has been through.
 */
export type WorkingPhase = "thinking" | "writing";

const WORDS: Readonly<Record<WorkingPhase, readonly string[]>> = {
  thinking: [
    "Pondering", "Mulling it over", "Vibing", "Connecting the dots", "Tinkering", "Brewing ideas",
    "Noodling", "Scheming", "Puzzling it out", "Sketching a plan", "Cooking", "Daydreaming in code",
    "Untangling", "Reading the room", "Chewing on it", "Ruminating", "Percolating", "Marinating",
    "Simmering", "Cogitating", "Deliberating", "Contemplating", "Musing", "Hypothesizing",
    "Strategizing", "Brainstorming", "Investigating", "Sleuthing", "Spelunking", "Excavating",
    "Rummaging", "Triangulating", "Calibrating", "Extrapolating", "Deciphering", "Unraveling",
    "Decoding", "Mapping the maze", "Tracing the threads", "Following hunches", "Weighing options",
    "Crunching thoughts", "Joining the pieces", "Peeking under the hood", "Herding thoughts",
    "Juggling ideas", "Shuffling neurons", "Stirring the pot", "Warming up the gears",
    "Charting a course", "Consulting the rubber duck", "Sharpening pencils",
    "Reading between the lines", "Counting edge cases", "Squinting at it", "Hatching a plan",
    "Plotting", "Riddling it out", "Gathering wits", "Mind-melding",
  ],
  writing: [
    "Making", "Creating", "Crafting", "Writing", "Shaping it", "Putting it together", "Polishing",
    "Spinning it up", "Building", "Wordsmithing", "Forging", "Assembling", "Weaving", "Sculpting",
    "Composing", "Conjuring", "Whittling", "Tailoring", "Stitching it up", "Hammering it out",
    "Fine-tuning", "Buffing", "Smithing", "Bricklaying", "Knitting", "Brewing", "Baking",
    "Distilling", "Orchestrating", "Choreographing", "Engineering", "Architecting", "Refactoring",
    "Typesetting", "Inking", "Sprinkling magic", "Tightening bolts", "Laying track",
    "Painting pixels", "Shipping it",
  ],
};

/** Every working word, for tests and the docs: thinking first, then writing. */
export const ALL_WORKING_WORDS: readonly string[] = [...WORDS.thinking, ...WORDS.writing];

/** Seconds each word stays before the next. */
export const WORDS_EVERY_S = 3;

/** How many colours the words cycle through (`data-tone` 0 to TONES - 1 in ai.css). */
export const WORKING_TONES = 6;

/** A starting point, so two chats side by side do not say the same thing in step. */
export function workingWordSeed(): number {
  return Math.floor(Math.random() * 1_000);
}

/** Strides that share no factor with either list's length, so a walk visits every word once. */
const STRIDES = [1, 7, 11, 13, 17, 19, 23, 29, 31, 37] as const;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Where the walk for `seed` stands after `step` words: a fixed stride through the list, chosen
 * from the seed, so each chat has its own order and every word comes up once per lap.
 */
function index(length: number, step: number, seed: number): number {
  const candidates = STRIDES.filter((stride) => gcd(stride, length) === 1);
  const stride = candidates[Math.floor(seed / length) % candidates.length] ?? 1;
  return (seed + step * stride) % length;
}

const stepOf = (seconds: number): number => Math.floor(Math.max(0, seconds) / WORDS_EVERY_S);

/** The word for `phase` after `seconds` on it, from `seed`. Never two the same in a row. */
export function workingWord(phase: WorkingPhase, seconds: number, seed: number): string {
  const words = WORDS[phase];
  return words[index(words.length, stepOf(seconds), seed)]!;
}

/** The colour that word wears: changes with every word, so each one reads as new. */
export function workingTone(phase: WorkingPhase, seconds: number, seed: number): number {
  return (seed + stepOf(seconds) + (phase === "writing" ? 3 : 0)) % WORKING_TONES;
}

/**
 * What Buck is doing at the foot of a working turn, changing with each word: chin in hand,
 * peering about, typing, joining the brackets into a link - and now and then flipping his coin.
 * Writing is mostly typing; thinking is everything else. Never the same pose twice in a row.
 */
const MOODS: Readonly<Record<WorkingPhase, readonly WorkingMood[]>> = {
  thinking: ["thinking", "searching", "connecting", "thinking", "searching", "loading", "earning"],
  writing: ["working", "thinking", "working", "searching", "working", "connecting"],
};

/** The poses above, by the mascot's own mood names (styles/adcodeMascot.css). */
export type WorkingMood = "thinking" | "searching" | "connecting" | "loading" | "earning" | "working";

/** The pose that goes with the word for `phase` after `seconds` on it. */
export function workingMood(phase: WorkingPhase, seconds: number, seed: number): WorkingMood {
  const moods = MOODS[phase];
  return moods[(seed + stepOf(seconds)) % moods.length]!;
}
