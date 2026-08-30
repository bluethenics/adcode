/**
 * Git: source control, built in.
 *
 * The vocabulary is the hard part here. "Commit", "stage", and "branch" are words that
 * mean nothing until somebody explains them once, and almost no editor ever does - it
 * assumes you arrived already knowing. These entries assume the opposite.
 */
import type { HelpEntry } from "../types.ts";

export const GIT_ENTRIES: readonly HelpEntry[] = [
  {
    id: "adcode.git.gutterDiff",
    title: "Gutter diff decorations",
    plain:
      "Little coloured marks in the left margin show which lines you have changed since you last saved them into your project's history.",
    why: "It answers 'what have I actually touched here' without opening anything or comparing anything.",
    how: "On by default. Green means you added the line, blue means you changed it, and a small triangle means you deleted something there. Click a mark to see what was there before, and to undo just that change.",
    group: "git",
    settingIds: ["adcode.git.gutterDiff"],
    related: ["adcode.git.stageCommitUi", "adcode.git.fileTimeline"],
  },
  {
    id: "adcode.git.blame",
    title: "Blame",
    plain: "Shows who last changed each line, and which save it came from.",
    why: "The name is unfriendly and the feature is not: it is how you find the person or the note that explains why a line is the way it is.",
    how: "Off by default. Git → Blame This Line names the author, the commit and its message for the line the cursor is on, and says so plainly when the line is not committed yet. Turn the setting on and every line gets a faint note instead; click one to open the full description of that change.",
    group: "git",
    settingIds: ["adcode.git.blame"],
    related: ["adcode.editing.inlineGitBlame", "adcode.git.fileTimeline"],
  },
  {
    id: "adcode.git.stageCommitUi",
    title: "Stage, unstage, and commit",
    plain:
      "Pick which of your changes to keep as a set, write a note about them, and save that set into your project's history.",
    why: "This is the point of source control: your work gets saved in labelled steps you can go back to, rather than as one big pile of edits.",
    how: "On by default. Open the Source Control panel in the activity bar. Tick the changes you want in this set - that is 'staging' - write a short note saying what you did, and press Commit.",
    group: "git",
    settingIds: ["adcode.git.stageCommitUi"],
    related: ["adcode.git.gutterDiff", "adcode.git.branchSwitcher"],
  },
  {
    id: "adcode.git.branchSwitcher",
    title: "Branch switcher",
    plain:
      "Work on a separate copy of the project, so you can try something without disturbing the version that works.",
    why: "It is the safe way to attempt anything risky. If it goes badly you throw the copy away and nothing else was touched.",
    how: "On by default. The current branch name is at the bottom-left of the window; click it to switch to another or to start a new one. Git → Checkout Branch and Git → Create Branch do the same from the menu.",
    group: "git",
    settingIds: ["adcode.git.branchSwitcher"],
    related: ["adcode.git.stageCommitUi", "adcode.git.mergeConflict"],
  },
  {
    id: "adcode.git.mergeConflict",
    title: "Merge conflict resolution",
    plain:
      "When two people changed the same line, this shows you both versions side by side and lets you pick.",
    why: "A conflict is the one moment source control cannot decide for you, and the raw markers it leaves in the file are genuinely hard to read.",
    how: "On by default. Press Check Conflicts in the Source Control panel, or Git → Check Merge Conflicts, to list every file where both sides changed the same lines - it answers \"No merge conflicts\" when there are none, so you never have to guess. Open one of those files and each conflict gets Keep yours, Keep theirs, and Keep both above it; you can also edit the result by hand. Save the file to keep what you chose.",
    group: "git",
    settingIds: ["adcode.git.mergeConflict"],
    related: ["adcode.git.branchSwitcher"],
  },
  {
    id: "adcode.git.fileTimeline",
    title: "File timeline",
    plain: "Every past version of the file you are looking at, newest first, in a list you can open.",
    why: "It answers 'when did this break' and 'what did this look like last week' without leaving the editor.",
    how: "On by default. Git → File Timeline lists every commit that touched the file you are looking at, and says when none has yet. The Source Control panel shows the same list under Timeline; click any entry to see that version, and what changed in it.",
    group: "git",
    settingIds: ["adcode.git.fileTimeline"],
    related: ["adcode.session.localFileHistory", "adcode.git.blame"],
  },
];
