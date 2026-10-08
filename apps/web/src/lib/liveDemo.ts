/**
 * The homepage's "agents at work" demo, as a timeline.
 *
 * A pure function of time: given milliseconds since the loop began, what the three agents on
 * the stage are doing. Build writes `greet.ts` and tells Tests and Docs; Tests runs the suite;
 * Docs writes the README; the badges settle; the project memory they share comes up. The
 * component only draws frames, so the story is tested here rather than by watching it.
 *
 * Everything in it is something the desktop app's live agent view really shows - code typing
 * in, a message crossing between mascots, a check flipping a badge, a window that never ran a
 * check staying Unverified.
 */

export type DemoAgent = "build" | "tests" | "docs";
export type DemoStatus = "waiting" | "working" | "done";
export type DemoProof = "unverified" | "passed";

export interface DemoFrame {
  /** Which of the four points the stage is showing, 0-3. */
  readonly phase: number;
  readonly build: { readonly typed: number; readonly status: DemoStatus; readonly proof: DemoProof };
  readonly tests: { readonly lines: number; readonly status: DemoStatus; readonly proof: DemoProof };
  readonly docs: { readonly typed: number; readonly status: DemoStatus; readonly proof: DemoProof };
  /** A message crossing the strip, 0 to 1 of the way there; null when nobody is talking. */
  readonly bubble: { readonly from: DemoAgent; readonly to: DemoAgent; readonly text: string; readonly progress: number } | null;
  /** The last message sent, as the one-line log under the mascots. */
  readonly log: string | null;
  /** The shared memory card is up. */
  readonly memory: boolean;
}

export type DemoTone = "plain" | "keyword" | "string" | "comment" | "number";

/** `greet.ts`, pre-coloured, so typing can stop in the middle of any token. */
export const DEMO_CODE: readonly (readonly [string, DemoTone])[] = [
  ["// Greets a user by name", "comment"], ["\n", "plain"],
  ["export", "keyword"], [" ", "plain"], ["function", "keyword"], [" greet(name: ", "plain"], ["string", "keyword"], ["): ", "plain"], ["string", "keyword"], [" {\n", "plain"],
  ["  ", "plain"], ["const", "keyword"], [" clean = name.trim() || ", "plain"], ["\"friend\"", "string"], [";\n", "plain"],
  ["  ", "plain"], ["return", "keyword"], [" ", "plain"], ["`Hello, ${clean}!`", "string"], [";\n", "plain"],
  ["}\n", "plain"],
];

export const DEMO_README = "# greet\n\nSay hello to someone by name.\n\n    greet(\"Ada\")  // Hello, Ada!\n    greet(\"\")     // Hello, friend!\n";

export const DEMO_TEST_LINES: readonly string[] = [
  "❯ npm test",
  "",
  " ✓ greets by name",
  " ✓ trims spaces",
  " ✓ falls back to friend",
  " ✓ never returns empty",
  "",
  " Tests  4 passed (4)",
];

export const DEMO_CODE_LENGTH = DEMO_CODE.reduce((sum, [text]) => sum + text.length, 0);
export const DEMO_README_LENGTH = DEMO_README.length;

/** One loop. */
export const DEMO_MS = 14_000;

/** The four points beside the stage, and when the stage reaches each. */
export const DEMO_PHASES: readonly { readonly at: number; readonly title: string; readonly body: string }[] = [
  { at: 0, title: "Watch it being written", body: "Code types into each agent's window as the model writes it - not a spinner, then a finished diff." },
  { at: 4_000, title: "Agents that talk", body: "Teammates message each other mid-task: an API that is ready, a file to leave alone, a question." },
  { at: 7_600, title: "Proof, not promises", body: "A window says Checks passed only after the agent really ran the project's tests or typecheck. Anything else stays Unverified." },
  { at: 10_800, title: "One memory for every agent", body: "Decisions land in the project's memory, read by every agent - and by Claude Code or Codex in your terminal." },
];

const BUILD_TYPE = [300, 3_600] as const;
const TO_TESTS = [4_100, 5_300] as const;
const TO_DOCS = [5_500, 6_700] as const;
const TESTS_RUN = [5_400, 9_400] as const;
const DOCS_TYPE = [6_800, 10_200] as const;
const BUILD_DONE = 6_900;

function progress(at: number, [start, end]: readonly [number, number]): number {
  if (at <= start) return 0;
  if (at >= end) return 1;
  return (at - start) / (end - start);
}

export function demoFrame(ms: number): DemoFrame {
  const at = ((ms % DEMO_MS) + DEMO_MS) % DEMO_MS;
  let phase = 0;
  DEMO_PHASES.forEach((point, index) => { if (at >= point.at) phase = index; });

  const testsLines = Math.floor(progress(at, TESTS_RUN) * DEMO_TEST_LINES.length);
  const testsPassed = testsLines >= DEMO_TEST_LINES.length;
  const toTests = progress(at, TO_TESTS);
  const toDocs = progress(at, TO_DOCS);
  const bubble = toTests > 0 && toTests < 1
    ? { from: "build" as const, to: "tests" as const, text: "greet() is ready in greet.ts", progress: toTests }
    : toDocs > 0 && toDocs < 1
      ? { from: "build" as const, to: "docs" as const, text: "Please document greet(name)", progress: toDocs }
      : null;

  return {
    phase,
    build: {
      typed: Math.round(progress(at, BUILD_TYPE) * DEMO_CODE_LENGTH),
      status: at >= BUILD_DONE ? "done" : "working",
      // Build's own work is proven when the suite it handed over passes.
      proof: testsPassed ? "passed" : "unverified",
    },
    tests: {
      lines: testsLines,
      status: at < TO_TESTS[1] ? "waiting" : testsPassed ? "done" : "working",
      proof: testsPassed ? "passed" : "unverified",
    },
    docs: {
      typed: Math.round(progress(at, DOCS_TYPE) * DEMO_README_LENGTH),
      status: at < TO_DOCS[1] ? "waiting" : at >= DOCS_TYPE[1] ? "done" : "working",
      proof: "unverified",
    },
    bubble,
    log: at >= TO_DOCS[0] ? "Build → Docs: Please document greet(name)" : at >= TO_TESTS[0] ? "Build → Tests: greet() is ready in greet.ts" : null,
    memory: at >= DEMO_PHASES[3]!.at,
  };
}

/** The frame shown instead of the animation when motion is reduced: the whole story, still. */
export function demoRestFrame(): DemoFrame {
  return demoFrame(DEMO_MS - 1);
}
