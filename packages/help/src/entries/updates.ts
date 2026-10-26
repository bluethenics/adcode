/**
 * Updates.
 *
 * The rule this describes is the product's, not the platform's: ADCode never restarts
 * itself. When an update is ready it says so once, quietly, and restarts only if you
 * choose. The entry says so, because that is the part a reader actually wants promised.
 */
import type { HelpEntry } from "../types.ts";

export const UPDATES_ENTRIES: readonly HelpEntry[] = [
  {
    id: "adcode.updates.auto",
    title: "Install updates automatically",
    plain:
      "A small card tells you when a new version is available. Choose Update now to finish downloading and install it, or keep working and update later.",
    why: "So you are never out of date, and you always know when a new version is waiting - without a box that stops your work.",
    how: "On by default. A new-version card offers Update now or Later, once per version and only when you are not typing. Updates download in the background and the status bar shows progress. Choose Update now to install when the download finishes. On Windows ADCode protects unsaved work in every window, closes, shows installation progress, then opens the updated app automatically without another setup wizard. On Linux it closes to finish installing. If you keep working, a separate ready card offers Restart now or Close and update. Unsaved work is kept as a recovery draft; if crash recovery is off, ADCode asks you to save first. Ignoring the cards installs a downloaded update quietly the next time you close ADCode normally. Microsoft Store installations get an Update in Microsoft Store button; the Store decides when its update reaches your device. Portable installations get a Download update button for the official ADCode site so you can replace your portable copy. Help → Check for Updates asks now, even with automatic checks off. If an update fails, your current version stays usable and Help → Report a Problem includes the updater log. Linux packages managed by your operating system still update through that package manager.",
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
