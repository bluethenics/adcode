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
    how: "Off by default. Turn it on and each line gets a faint note; click one to open the full description of that change.",
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
    how: "On by default. The current branch name is at the bottom-left of the window; click it to switch to another or to start a new one.",
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
    how: "On by default. A conflicted file opens with both versions marked; press Keep yours, Keep theirs, or Keep both above each conflict, or edit the result by hand.",
    group: "git",
    settingIds: ["adcode.git.mergeConflict"],
    related: ["adcode.git.branchSwitcher"],
  },
  {
    id: "adcode.git.fileTimeline",
    title: "File timeline",
    plain: "Every past version of the file you are looking at, newest first, in a list you can open.",
    why: "It answers 'when did this break' and 'what did this look like last week' without leaving the editor.",
    how: "On by default. Open the Timeline view for the current file and click any entry to see that version, and what changed in it.",
    group: "git",
    settingIds: ["adcode.git.fileTimeline"],
    related: ["adcode.session.localFileHistory", "adcode.git.blame"],
  },
];
