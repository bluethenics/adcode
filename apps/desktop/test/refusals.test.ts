import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * A refused action must say so where the eye already is.
 *
 * `resultDialog.ts` exists because git's heavyweight actions used to answer in the status
 * bar - "an 11px span in the far corner that erased itself after four seconds. The action
 * had reported, and nobody had read it, which is the same thing as not reporting." The
 * dialog fixed that for the actions that go through git, and left behind every refusal
 * caught *before* git is asked, which kept reporting the quiet way. Pressing Commit with
 * an empty message and pressing it with nothing staged are the same gesture refused for
 * two reasons, and only one of them was visible.
 *
 * These are the messages that answer a gesture by refusing it. They belong to
 * `reportResult` or `refuse`; `notify` is for news nobody is waiting on.
 */
const MUST_BE_MODAL = [
  "A commit needs a message.",
  "Nothing to stage.",
  "Nothing to unstage.",
  "No branches yet - make a commit first.",
  "Type something to search for first.",
  "That address cannot be used for a session.",
];

/**
 * The counterexamples, kept deliberately.
 *
 * These report a success or something incidental. A modal for succeeding is a punishment,
 * so this file has to assert the boundary in both directions or it just argues for making
 * everything a dialog.
 */
const MUST_STAY_QUIET = ["URL copied.", "Invite code copied. Send it to whoever is joining."];

const RENDERER = ["panels/sourceControl.ts", "panels/searchPanel.ts", "collab/collabPanel.ts", "panels/portsPanel.ts"];

const sources = RENDERER.map((name) => ({
  name,
  text: readFileSync(fileURLToPath(new URL(`../src/renderer/${name}`, import.meta.url)), "utf8"),
})); 

const whereverItLives = (message: string): { name: string; text: string } => {
  const found = sources.find((source) => source.text.includes(message));
  if (found === undefined) {
    throw new Error(
      `No renderer panel contains "${message}". If it was reworded, reword it here too - ` +
        `silently dropping it from this list is how the guard stops guarding.`,
    );
  }
  return found;
};

describe("a refused action is never reported only to the status bar", () => {
  for (const message of MUST_BE_MODAL) {
    it(`"${message}" goes to the dialog, not notify()`, () => {
      const { name, text } = whereverItLives(message);
      expect(text, `${name} must not send this refusal to the status bar`).not.toContain(
        `notify("${message}")`,
      );
    });
  }

  for (const message of MUST_STAY_QUIET) {
    it(`"${message}" stays in the status bar, because it is not a refusal`, () => {
      const { name, text } = whereverItLives(message);
      expect(text, `${name} should report this with notify()`).toContain(`notify("${message}")`);
    });
  }
});
