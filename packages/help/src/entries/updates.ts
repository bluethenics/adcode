/**
 * Updates.
 *
 * The rule this describes is the product's, not the platform's: ADCode never restarts
 * itself and never interrupts to ask. The entry says so, because that is the part a
 * reader actually wants promised.
 */
import type { HelpEntry } from "../types.ts";

export const UPDATES_ENTRIES: readonly HelpEntry[] = [
  {
    id: "adcode.updates.auto",
    title: "Install updates automatically",
    plain:
      "New versions download quietly in the background and are in place the next time you open ADCode.",
    why: "So you are never out of date, and never stopped mid-thought by a box asking to restart.",
    how: "On by default. ADCode will not restart itself and will not interrupt you to ask - you close the editor when you are ready, and the new version is what opens next time. Turn this off to update by hand instead.",
    group: "updates",
    settingIds: ["adcode.updates.auto"],
    related: ["updates.whatsNew"],
  },
  {
    id: "updates.whatsNew",
    title: "Tell me what changed",
    plain: "Now and then, a small card tells you what changed in the version you just got.",
    why: "A feature nobody is told about may as well not exist. This is the one interruption ADCode allows itself, so it is kept rare.",
    how: "Four rules keep it quiet: you see a given version's note once on this machine and never again, it waits for a moment when you are not typing, not running a command, and not debugging, it only appears for releases worth reading - small fixes install silently - and it never appears on a brand new install. Dismiss it and it is gone for good. Turn this off and nothing ever pops up; Help > What's New still has every note. A security fix is the one thing that will not wait for a quiet moment, though even that respects the switch being off.",
    group: "updates",
    settingIds: ["adcode.updates.announce"],
    related: ["adcode.updates.auto"],
  },
];
