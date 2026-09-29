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
      "New versions download in the background. When one is ready, the status bar says Restart to update and a small card offers to restart now.",
    why: "So you are never out of date, and you always know when a new version is waiting - without a box that stops your work.",
    how: "On by default. While a new version downloads, the status bar shows its progress; when it is ready it reads Restart to update, and a card offers Restart now or Later - once per version, and only when you are not typing. Restart now keeps anything unsaved and offers it back when ADCode reopens - if crash recovery is off, it asks you to save first. Later, or ignoring it, installs the update the next time you close ADCode. On Linux the card simply says the update is ready, and it installs when you close ADCode. ADCode never restarts itself. Help → Check for Updates asks now and tells you where you stand, including when you are already on the latest version. If an update ever fails, Help → Report a Problem includes what the updater recorded. Turn this off to update by hand instead. If you installed ADCode from the Microsoft Store, or from a Linux package manager, that is what updates it and this setting does nothing - Settings says so rather than pretending to check.",
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
