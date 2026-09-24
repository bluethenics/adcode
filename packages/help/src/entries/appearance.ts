/**
 * Appearance: how much room things take, and whether it is light or dark.
 */
import type { HelpEntry } from "../types.ts";

export const APPEARANCE_ENTRIES: readonly HelpEntry[] = [
  {
    id: "adcode.appearance.density",
    title: "Density",
    plain: "How much space there is between things. Comfortable is roomier; compact fits more on screen.",
    why: "Generous spacing looks good on a large monitor and wastes a laptop screen.",
    how: "Pick Comfortable or Compact. It changes immediately, everywhere.",
    group: "appearance",
    settingIds: ["adcode.appearance.density"],
    related: ["adcode.appearance.theme"],
  },
  {
    id: "adcode.appearance.theme",
    title: "Appearance",
    plain: "Warm light, charcoal dark, or midnight. System follows your computer's appearance.",
    why: "Dark is easier at night, light is easier in daylight, and following the system means you never think about it.",
    how: "Light is the default for new installs. Choose Dark, Midnight, or System in Settings. Your explicit preference stays selected across modes.",
    group: "appearance",
    settingIds: ["adcode.appearance.theme"],
    related: ["adcode.appearance.density"],
  },
];
